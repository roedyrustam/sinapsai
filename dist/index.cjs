'use strict';

/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/utils/stream.ts
var stream_exports = {};
__export(stream_exports, {
  parseSSE: () => parseSSE
});
async function* parseSSE(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent;
  const processLine = (line) => {
    if (!line.trim()) {
      currentEvent = void 0;
      return null;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      return null;
    }
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data === "[DONE]") return null;
      return { event: currentEvent, data };
    }
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const msg = processLine(line);
        if (msg) yield msg;
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        const msg = processLine(line);
        if (msg) yield msg;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
var init_stream = __esm({
  "src/utils/stream.ts"() {
  }
});

// src/utils/streamAccumulator.ts
async function accumulateStream(stream, options) {
  let id = "";
  let model = "";
  let content = "";
  let hasContent = false;
  let reasoningContent = "";
  let hasReasoning = false;
  let finishReason = "stop";
  let usage;
  const toolCallsMap = /* @__PURE__ */ new Map();
  for await (const chunk of stream) {
    options?.onChunk?.(chunk);
    if (!id && chunk.id) id = chunk.id;
    if (!model && chunk.model) model = chunk.model;
    if (chunk.usage) {
      usage = { ...chunk.usage };
    }
    const choice = chunk.choices?.[0];
    if (choice) {
      if (choice.finishReason) {
        finishReason = choice.finishReason;
      }
      const delta = choice.delta;
      if (delta) {
        if (delta.content !== void 0 && delta.content !== null) {
          content += delta.content;
          hasContent = true;
        }
        if (delta.reasoning_content !== void 0 && delta.reasoning_content !== null) {
          reasoningContent += delta.reasoning_content;
          hasReasoning = true;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || ""
              });
            } else {
              const existing = toolCallsMap.get(index);
              if (existing) {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              }
            }
          }
        }
      }
    }
  }
  let finalToolCalls;
  if (toolCallsMap.size > 0) {
    finalToolCalls = Array.from(toolCallsMap.entries()).sort(([a], [b]) => a - b).map(([_, tc], idx) => ({
      id: tc.id || `call_${Date.now()}_${idx}`,
      type: "function",
      function: {
        name: tc.name,
        arguments: tc.arguments
      }
    }));
  }
  return {
    id: id || `accumulated-${Date.now()}`,
    model: model || "unknown",
    choices: [
      {
        message: {
          role: "assistant",
          content: hasContent ? content : null,
          reasoning_content: hasReasoning ? reasoningContent : null,
          tool_calls: finalToolCalls
        },
        finishReason: finalToolCalls && finalToolCalls.length > 0 && finishReason === "stop" ? "tool_calls" : finishReason
      }
    ],
    usage
  };
}

// src/utils/structuredOutput.ts
function extractBalancedJson(text, openChar, closeChar) {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  return null;
}
function extractJsonFromText(text) {
  if (!text || typeof text !== "string") {
    throw new SyntaxError("Cannot extract JSON from empty or non-string input");
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_e) {
  }
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = trimmed.match(codeBlockRegex);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (_e) {
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const checkObjectFirst = firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);
  if (checkObjectFirst) {
    const balancedObj = extractBalancedJson(trimmed, "{", "}");
    if (balancedObj) {
      try {
        return JSON.parse(balancedObj);
      } catch (_e) {
      }
    }
    if (firstBracket !== -1) {
      const balancedArr = extractBalancedJson(trimmed, "[", "]");
      if (balancedArr) {
        try {
          return JSON.parse(balancedArr);
        } catch (_e) {
        }
      }
    }
  } else if (firstBracket !== -1) {
    const balancedArr = extractBalancedJson(trimmed, "[", "]");
    if (balancedArr) {
      try {
        return JSON.parse(balancedArr);
      } catch (_e) {
      }
    }
    if (firstBrace !== -1) {
      const balancedObj = extractBalancedJson(trimmed, "{", "}");
      if (balancedObj) {
        try {
          return JSON.parse(balancedObj);
        } catch (_e) {
        }
      }
    }
  }
  throw new SyntaxError(
    `Failed to extract valid JSON from response text: "${trimmed.slice(0, 100)}${trimmed.length > 100 ? "..." : ""}"`
  );
}
function tryExtractJson(text) {
  try {
    return extractJsonFromText(text);
  } catch {
    return null;
  }
}

// src/core/BatchExecutor.ts
var BatchExecutionError = class extends Error {
  results;
  cause;
  constructor(message, results, cause) {
    super(message);
    this.name = "BatchExecutionError";
    this.results = results;
    this.cause = cause;
  }
};
async function executeBatch(items, handler, options) {
  const startTime = Date.now();
  const total = items.length;
  if (total === 0) {
    return {
      results: [],
      total: 0,
      successful: 0,
      failed: 0,
      durationMs: 0
    };
  }
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, total));
  const stopOnError = options?.stopOnError ?? false;
  const signal = options?.signal;
  const results = new Array(total);
  let nextIndex = 0;
  let completed = 0;
  let successful = 0;
  let failed = 0;
  let shouldStop = false;
  let firstError;
  const updateProgress = () => {
    if (options?.onProgress) {
      const progress = {
        completed,
        total,
        percentage: Math.min(100, Math.round(completed / total * 100)),
        successful,
        failed
      };
      options.onProgress(progress);
    }
  };
  const worker = async () => {
    while (nextIndex < total && !shouldStop) {
      if (signal?.aborted) {
        shouldStop = true;
        break;
      }
      const currentIndex = nextIndex++;
      const item = items[currentIndex];
      try {
        const value = await handler(item, currentIndex);
        results[currentIndex] = {
          index: currentIndex,
          status: "fulfilled",
          value
        };
        successful++;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results[currentIndex] = {
          index: currentIndex,
          status: "rejected",
          error
        };
        failed++;
        if (stopOnError) {
          shouldStop = true;
          firstError = error;
          break;
        }
      } finally {
        completed++;
        updateProgress();
      }
    }
  };
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  if (shouldStop) {
    for (let i = 0; i < total; i++) {
      if (!results[i]) {
        results[i] = {
          index: i,
          status: "rejected",
          error: signal?.aborted ? new Error("Batch execution aborted by caller") : firstError ?? new Error("Batch execution stopped due to previous error")
        };
        failed++;
        completed++;
      }
    }
  }
  const durationMs = Date.now() - startTime;
  if (stopOnError && firstError) {
    throw new BatchExecutionError(
      `Batch execution failed at index ${results.findIndex((r) => r.status === "rejected")}: ${firstError.message}`,
      results,
      firstError
    );
  }
  return {
    results,
    total,
    successful,
    failed,
    durationMs
  };
}

// src/core/CircuitBreaker.ts
var CircuitBreaker = class {
  storage;
  failureThreshold;
  recoverySuccessThreshold;
  resetTimeoutMs;
  onCircuitOpen;
  onCircuitClose;
  constructor(storage, options = {}) {
    this.storage = storage;
    this.failureThreshold = options.failureThreshold || 3;
    this.recoverySuccessThreshold = options.recoverySuccessThreshold || 1;
    this.resetTimeoutMs = options.resetTimeoutMs || 3e4;
    this.onCircuitOpen = options.onCircuitOpen;
    this.onCircuitClose = options.onCircuitClose;
  }
  async isAvailable(providerId) {
    try {
      const state = await this.storage.get(`cb:state:${providerId}`);
      if (state === "OPEN") {
        return false;
      }
      const failures = await this.storage.get(
        `cb:failures:${providerId}`
      );
      if (failures !== null && failures >= this.failureThreshold) {
        const probing = await this.storage.get(
          `cb:probe:${providerId}`
        );
        if (probing !== null && probing > 0) {
          return false;
        }
      }
      return true;
    } catch (_error) {
      return true;
    }
  }
  async recordSuccess(providerId) {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      const failures = await this.storage.get(
        `cb:failures:${providerId}`
      );
      const state = await this.storage.get(`cb:state:${providerId}`);
      if (state === "OPEN" || failures !== null && failures >= this.failureThreshold) {
        const successes = await this.storage.increment(
          `cb:successes:${providerId}`
        );
        if (successes >= this.recoverySuccessThreshold) {
          await this.storage.delete(`cb:failures:${providerId}`);
          await this.storage.delete(`cb:successes:${providerId}`);
          await this.storage.set(`cb:state:${providerId}`, "CLOSED");
          this.onCircuitClose?.(providerId);
        }
      } else {
        await this.storage.delete(`cb:failures:${providerId}`);
        await this.storage.delete(`cb:successes:${providerId}`);
        await this.storage.set(`cb:state:${providerId}`, "CLOSED");
      }
    } catch (_error) {
    }
  }
  async recordFailure(providerId) {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      await this.storage.delete(`cb:successes:${providerId}`);
      const failures = await this.storage.increment(
        `cb:failures:${providerId}`
      );
      if (failures >= this.failureThreshold) {
        await this.storage.set(
          `cb:state:${providerId}`,
          "OPEN",
          this.resetTimeoutMs / 1e3
        );
        if (failures === this.failureThreshold) {
          this.onCircuitOpen?.(providerId);
        }
      }
    } catch (_error) {
    }
  }
  async getStatus(providerId) {
    try {
      const rawState = await this.storage.get(`cb:state:${providerId}`) || "CLOSED";
      const failures = await this.storage.get(`cb:failures:${providerId}`) || 0;
      const successes = await this.storage.get(`cb:successes:${providerId}`) || 0;
      let state = "CLOSED";
      if (rawState === "OPEN") {
        state = "OPEN";
      } else if (failures >= this.failureThreshold) {
        state = "HALF_OPEN";
      }
      return {
        state,
        failures,
        successes
      };
    } catch (_error) {
      return {
        state: "CLOSED",
        failures: 0,
        successes: 0
      };
    }
  }
  async reset(providerId) {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      await this.storage.delete(`cb:failures:${providerId}`);
      await this.storage.delete(`cb:successes:${providerId}`);
      await this.storage.set(`cb:state:${providerId}`, "CLOSED");
      this.onCircuitClose?.(providerId);
    } catch (_error) {
    }
  }
  async execute(provider, request) {
    if (!await this.isAvailable(provider.id)) {
      throw new Error(`Circuit breaker is OPEN for provider: ${provider.id}`);
    }
    try {
      const failures = await this.storage.get(
        `cb:failures:${provider.id}`
      );
      if (failures !== null && failures >= this.failureThreshold) {
        await this.storage.set(
          `cb:probe:${provider.id}`,
          1,
          Math.max(1, Math.ceil(this.resetTimeoutMs / 1e3))
        );
      }
    } catch (_error) {
    }
    try {
      const response = await provider.generateContent(request);
      if (response != null && typeof response === "object" && Symbol.asyncIterator in response) {
        const iterable = response;
        const iterator = iterable[Symbol.asyncIterator]();
        let firstResult;
        try {
          firstResult = await iterator.next();
        } catch (error) {
          const isAbort = request.signal?.aborted || error?.name === "AbortError" || error?.message?.toLowerCase().includes("aborted");
          if (!isAbort) {
            await this.recordFailure(provider.id);
          } else {
            try {
              await this.storage.delete(`cb:probe:${provider.id}`);
            } catch (_e) {
            }
          }
          throw error;
        }
        const self = this;
        return (async function* () {
          try {
            if (!firstResult.done) {
              yield firstResult.value;
              let nextResult;
              nextResult = await iterator.next();
              while (!nextResult.done) {
                yield nextResult.value;
                nextResult = await iterator.next();
              }
            }
            await self.recordSuccess(provider.id);
          } catch (streamError) {
            const isAbort = request.signal?.aborted || streamError?.name === "AbortError" || streamError?.message?.toLowerCase().includes("aborted");
            if (!isAbort) {
              await self.recordFailure(provider.id);
            } else {
              try {
                await self.storage.delete(`cb:probe:${provider.id}`);
              } catch (_e) {
              }
            }
            throw streamError;
          } finally {
            try {
              await self.storage.delete(`cb:probe:${provider.id}`);
            } catch (_e) {
            }
          }
        })();
      }
      await this.recordSuccess(provider.id);
      return response;
    } catch (error) {
      const isAbort = request.signal?.aborted || error?.name === "AbortError" || error?.message?.toLowerCase().includes("aborted");
      if (!isAbort) {
        await this.recordFailure(provider.id);
      } else {
        try {
          await this.storage.delete(`cb:probe:${provider.id}`);
        } catch (_e) {
        }
      }
      throw error;
    }
  }
};

// src/core/ContextCompressor.ts
function estimateMessageTokens(msg) {
  let chars = 16;
  if (typeof msg.content === "string") {
    chars += msg.content.length;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "text") {
        chars += part.text.length;
      } else {
        chars += 1024;
      }
    }
  }
  if (msg.reasoning_content) {
    chars += msg.reasoning_content.length;
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      chars += tc.function.name.length + tc.function.arguments.length + 24;
    }
  }
  return Math.ceil(chars / 4);
}
function estimateTotalTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageTokens(m);
  }
  return total;
}
function groupAtomicUnits(messages) {
  const units = [];
  let i = 0;
  while (i < messages.length) {
    const current = messages[i];
    if (current.role === "assistant" && current.tool_calls && current.tool_calls.length > 0) {
      const group = [current];
      i++;
      while (i < messages.length && messages[i].role === "tool") {
        group.push(messages[i]);
        i++;
      }
      units.push(group);
    } else {
      units.push([current]);
      i++;
    }
  }
  return units;
}
var ContextCompressor = class {
  options;
  constructor(options) {
    this.options = {
      maxPromptTokens: options.maxPromptTokens,
      strategy: options.strategy ?? "sliding-window",
      preserveSystemMessages: options.preserveSystemMessages ?? true
    };
  }
  compress(messages) {
    const originalTokens = estimateTotalTokens(messages);
    if (originalTokens <= this.options.maxPromptTokens || messages.length <= 1) {
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        droppedCount: 0
      };
    }
    const systemMsgs = [];
    const conversationMsgs = [];
    for (const m of messages) {
      if (this.options.preserveSystemMessages && m.role === "system") {
        systemMsgs.push(m);
      } else {
        conversationMsgs.push(m);
      }
    }
    const systemTokens = estimateTotalTokens(systemMsgs);
    const availableBudget = Math.max(
      0,
      this.options.maxPromptTokens - systemTokens
    );
    const units = groupAtomicUnits(conversationMsgs);
    const unitTokens = units.map((u) => estimateTotalTokens(u));
    if (this.options.strategy === "middle-out" && units.length > 2) {
      const firstUnit = units[0];
      const firstUnitCost = unitTokens[0];
      const keptTailUnits = [];
      let currentBudget = availableBudget - firstUnitCost;
      for (let idx = units.length - 1; idx >= 1; idx--) {
        if (currentBudget >= unitTokens[idx] || keptTailUnits.length === 0) {
          keptTailUnits.unshift(units[idx]);
          currentBudget -= unitTokens[idx];
        } else {
          break;
        }
      }
      const finalMessages2 = [
        ...systemMsgs,
        ...firstUnitCost <= availableBudget ? firstUnit : [],
        ...keptTailUnits.flat()
      ];
      return {
        messages: finalMessages2,
        originalTokens,
        compressedTokens: estimateTotalTokens(finalMessages2),
        droppedCount: messages.length - finalMessages2.length
      };
    }
    const keptUnits = [];
    let usedTokens = 0;
    for (let idx = units.length - 1; idx >= 0; idx--) {
      const cost = unitTokens[idx];
      if (usedTokens + cost <= availableBudget || keptUnits.length === 0) {
        keptUnits.unshift(units[idx]);
        usedTokens += cost;
      } else {
        break;
      }
    }
    const finalMessages = [...systemMsgs, ...keptUnits.flat()];
    return {
      messages: finalMessages,
      originalTokens,
      compressedTokens: estimateTotalTokens(finalMessages),
      droppedCount: messages.length - finalMessages.length
    };
  }
};

// src/core/InMemoryStorage.ts
var InMemoryStorage = class {
  store = /* @__PURE__ */ new Map();
  sweepInterval;
  constructor(options) {
    const sweepIntervalMs = typeof options === "number" ? options : options?.sweepIntervalMs ?? 6e4;
    const autoSweep = typeof options === "object" ? options?.autoSweep ?? true : true;
    if (autoSweep && typeof setInterval !== "undefined") {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
      if (this.sweepInterval && typeof this.sweepInterval.unref === "function") {
        this.sweepInterval.unref?.();
      }
    }
  }
  sweep() {
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (item.expiresAt !== null && now > item.expiresAt) {
        this.store.delete(key);
      }
    }
  }
  async get(key) {
    const item = this.store.get(key);
    if (!item) {
      return null;
    }
    if (item.expiresAt !== null && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }
  async set(key, value, ttlSeconds) {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1e3 : null;
    this.store.set(key, { value, expiresAt });
  }
  async delete(key) {
    this.store.delete(key);
  }
  async increment(key) {
    const item = this.store.get(key);
    let currentValue = 0;
    if (item) {
      if (item.expiresAt !== null && Date.now() > item.expiresAt) {
        this.store.delete(key);
      } else {
        currentValue = item.value || 0;
      }
    }
    const newValue = currentValue + 1;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: newValue,
      expiresAt: existing?.expiresAt ?? null
    });
    return newValue;
  }
  async clear() {
    this.store.clear();
  }
  destroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
  }
};

// src/core/McpBridge.ts
var McpToolBridge = class _McpToolBridge {
  tools = /* @__PURE__ */ new Map();
  constructor(tools) {
    if (tools && Array.isArray(tools)) {
      for (const t of tools) {
        this.registerTool(t);
      }
    }
  }
  /**
   * Registers a new in-process MCP tool with its execution handler.
   */
  // biome-ignore lint/suspicious/noExplicitAny: generic registerTool
  registerTool(tool) {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error("Tool definition must include a valid non-empty name.");
    }
    if (typeof tool.handler !== "function") {
      throw new Error(
        `Tool '${tool.name}' must provide an executable handler function.`
      );
    }
    const inputSchema = tool.inputSchema || {
      type: "object",
      properties: {}
    };
    this.tools.set(tool.name, {
      ...tool,
      inputSchema
    });
    return this;
  }
  /**
   * Registers multiple MCP tools in bulk.
   */
  registerTools(tools) {
    if (Array.isArray(tools)) {
      for (const t of tools) {
        this.registerTool(t);
      }
    }
    return this;
  }
  /**
   * Returns the count of registered tools.
   */
  get size() {
    return this.tools.size;
  }
  /**
   * Unregisters a previously registered tool by name.
   */
  unregisterTool(name) {
    return this.tools.delete(name);
  }
  /**
   * Checks if a tool is registered.
   */
  hasTool(name) {
    return this.tools.has(name);
  }
  /**
   * Gets a registered tool definition by name.
   */
  getTool(name) {
    return this.tools.get(name);
  }
  /**
   * Returns a list of all registered tools in MCP standard format.
   */
  listTools() {
    return Array.from(this.tools.values()).map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      })
    );
  }
  /**
   * Clears all registered tools from the bridge.
   */
  clear() {
    this.tools.clear();
  }
  /**
   * Converts all registered tools into OpenAI / Unified standard ToolDefinition[] format.
   * Can be passed directly into client.chat.completions.create({ tools: bridge.getTools() }).
   */
  toUnifiedTools() {
    return Array.from(this.tools.values()).map(
      (tool) => _McpToolBridge.toToolDefinition(tool)
    );
  }
  /**
   * Alias for toUnifiedTools().
   */
  getTools() {
    return this.toUnifiedTools();
  }
  /**
   * Static helper: converts an MCP Tool to an OpenAI / Unified ToolDefinition.
   */
  static toToolDefinition(mcpTool) {
    return {
      type: "function",
      function: {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema
      }
    };
  }
  /**
   * Static helper: converts an OpenAI / Unified ToolDefinition to an MCP Tool.
   */
  static fromToolDefinition(tool) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters || {
        type: "object",
        properties: {}
      }
    };
  }
  /**
   * Safely formats any raw handler return value into standard McpContent[].
   */
  // biome-ignore lint/suspicious/noExplicitAny: raw format helper
  formatContentResult(rawResult) {
    if (rawResult === null || rawResult === void 0) {
      return [{ type: "text", text: "" }];
    }
    if (typeof rawResult === "string") {
      return [{ type: "text", text: rawResult }];
    }
    if (typeof rawResult === "object" && Array.isArray(rawResult.content) && rawResult.content.every(
      (c) => typeof c?.type === "string"
    )) {
      return rawResult.content;
    }
    if (typeof rawResult === "object" && typeof rawResult.type === "string" && (rawResult.type === "text" || rawResult.type === "image" || rawResult.type === "resource")) {
      return [rawResult];
    }
    return [{ type: "text", text: JSON.stringify(rawResult, null, 2) }];
  }
  /**
   * Executes a single ToolCall returned by an LLM.
   * Handles JSON argument parsing, handler invocation, and catches errors gracefully.
   */
  async executeToolCall(call, context) {
    const toolName = call.function?.name;
    const rawArgs = call.function?.arguments;
    const toolDef = this.tools.get(toolName);
    if (!toolDef) {
      return {
        content: [
          {
            type: "text",
            text: `Tool '${toolName}' is not registered on this MCP bridge.`
          }
        ],
        isError: true
      };
    }
    let parsedArgs = {};
    if (rawArgs && typeof rawArgs === "string" && rawArgs.trim().length > 0) {
      try {
        parsedArgs = extractJsonFromText(rawArgs);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid JSON arguments for tool '${toolName}': ${err.message}`
            }
          ],
          isError: true
        };
      }
    } else if (typeof rawArgs === "object" && rawArgs !== null) {
      parsedArgs = rawArgs;
    }
    if (context?.signal?.aborted) {
      return {
        content: [
          {
            type: "text",
            text: `Tool '${toolName}' execution aborted by client signal.`
          }
        ],
        isError: true
      };
    }
    try {
      const mergedContext = {
        ...context,
        toolCallId: call.id
      };
      const timeoutMs = toolDef.timeoutMs ?? context?.timeoutMs;
      let rawResult;
      if (timeoutMs && timeoutMs > 0) {
        let timer;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms.`)
              );
            }, timeoutMs);
          });
          rawResult = await Promise.race([
            toolDef.handler(parsedArgs, mergedContext),
            timeoutPromise
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        rawResult = await toolDef.handler(parsedArgs, mergedContext);
      }
      const isError = typeof rawResult === "object" && rawResult !== null ? rawResult.isError === true : false;
      return {
        content: this.formatContentResult(rawResult),
        isError,
        _raw: rawResult
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${toolName}': ${err.message}`
          }
        ],
        isError: true,
        _raw: err
      };
    }
  }
  /**
   * Executes an array of ToolCalls concurrently and maps them directly into
   * standard OpenAI-compatible ChatMessage[] objects with role: 'tool'.
   */
  async executeToolCalls(calls, context) {
    if (!calls || calls.length === 0) return [];
    const results = await Promise.all(
      calls.map(async (call) => {
        const result = await this.executeToolCall(call, context);
        const textContent = result.content.map((part) => {
          if (part.type === "text") return part.text;
          if (part.type === "image") return `[Image: ${part.mimeType}]`;
          if (part.type === "resource")
            return `[Resource: ${part.resource.uri}]`;
          return JSON.stringify(part);
        }).join("\n");
        const message = {
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content: textContent
        };
        return message;
      })
    );
    return results;
  }
  /**
   * Processes a standard Model Context Protocol (MCP) JSON-RPC 2.0 request.
   * Supports:
   * - 'tools/list': lists registered tools
   * - 'tools/call': executes a tool by name with arguments
   * - 'ping': liveness probe
   */
  async handleJsonRpc(request) {
    let req;
    if (typeof request === "string") {
      try {
        req = JSON.parse(request);
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`
          }
        };
      }
    } else {
      req = request;
    }
    if (req?.jsonrpc !== "2.0" || !req?.method) {
      return {
        jsonrpc: "2.0",
        id: req?.id ?? null,
        error: {
          code: -32600,
          message: "Invalid Request: missing jsonrpc 2.0 or method."
        }
      };
    }
    const { id, method, params } = req;
    switch (method) {
      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {}
        };
      }
      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: this.listTools()
          }
        };
      }
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "sinapsai-mcp",
              version: "2.8.0"
            }
          }
        };
      }
      case "notifications/initialized": {
        return {
          jsonrpc: "2.0",
          id: id ?? null,
          result: {}
        };
      }
      case "tools/call": {
        const name = params?.name;
        const toolDef = this.tools.get(name);
        if (!name || !toolDef) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method or tool not found: ${name}`
            }
          };
        }
        const args = params?.arguments || {};
        const call = {
          id: String(id ?? Date.now()),
          type: "function",
          function: {
            name,
            arguments: typeof args === "string" ? args : JSON.stringify(args)
          }
        };
        const result = await this.executeToolCall(call, {
          meta: params?.meta
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: result.content,
            isError: result.isError
          }
        };
      }
      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }
    }
  }
};

// src/core/PIIGuardrails.ts
var PATTERNS = {
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  phone: /(?:\+?\d{1,4}[\s\-.]?)?\(?\d{1,4}\)?[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}(?:[\s\-.]?\d{1,4})?\b/g,
  credit_card: /\b(?:(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[\s\-.]?\d{4}[\s\-.]?\d{4}[\s\-.]?\d{4}|3[47]\d{2}[\s\-.]?\d{6}[\s\-.]?\d{5})\b/g,
  ssn: /\b\d{3}[\s\-.]?\d{2}[\s\-.]?\d{4}\b/g,
  ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\b/g,
  iban: /\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?(?:[A-Z0-9]{4}[\s]?){1,7}[A-Z0-9]{1,4}\b/g,
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  date_of_birth: /\b(?:0[1-9]|[12]\d|3[01])[/\-.](?:0[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g,
  url: /https?:\/\/[^\s<>"')\]]+/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
};
var CATEGORY_PRIORITY = {
  jwt: 100,
  credit_card: 90,
  iban: 85,
  passport: 80,
  ssn: 75,
  ip_address: 70,
  email: 65,
  date_of_birth: 60,
  url: 50,
  phone: 40,
  custom: 30
};
function isValidLuhn(digits) {
  const cleaned = digits.replace(/[\s\-.]/g, "");
  if (cleaned.length < 13 || cleaned.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = Number.parseInt(cleaned[i], 10);
    if (Number.isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}
var PIIGuardrails = class {
  patterns;
  redactionFormat;
  tokenFormat;
  enabled;
  onPIIDetected;
  allowlist;
  constructor(options) {
    const categories = options?.categories ?? [
      "email",
      "phone",
      "credit_card",
      "ssn",
      "ip_address"
    ];
    this.redactionFormat = options?.redactionFormat ?? "[{category}]";
    this.tokenFormat = options?.tokenFormat ?? "{{PII_{category}_{index}}}";
    this.enabled = options?.enabled ?? true;
    this.onPIIDetected = options?.onPIIDetected;
    this.allowlist = new Set(options?.allowlist ?? []);
    this.patterns = [];
    for (const cat of categories) {
      const pattern = PATTERNS[cat];
      if (pattern) {
        this.patterns.push({
          category: cat,
          regex: new RegExp(pattern.source, pattern.flags)
        });
      }
    }
    if (options?.customPatterns) {
      for (const [category, regex] of Object.entries(options.customPatterns)) {
        this.patterns.push({
          category,
          regex: new RegExp(regex.source, regex.flags || "g")
        });
      }
    }
  }
  /**
   * Detects all PII matches in the given text without modifying it.
   */
  detect(text) {
    if (!this.enabled || !text) return [];
    const matches = [];
    for (const entry of this.patterns) {
      const regex = new RegExp(entry.regex.source, entry.regex.flags);
      let match = regex.exec(text);
      while (match !== null) {
        const original = match[0];
        const matchIndex = match.index;
        match = regex.exec(text);
        if (this.allowlist.has(original)) continue;
        if (entry.category === "credit_card" && !isValidLuhn(original)) {
          continue;
        }
        if (entry.category === "phone") {
          const digitCount = original.replace(/\D/g, "").length;
          if (digitCount < 7 || digitCount > 15) continue;
        }
        const redacted = this.formatRedaction(entry.category);
        matches.push({
          category: entry.category,
          original,
          redacted,
          startIndex: matchIndex,
          endIndex: matchIndex + original.length
        });
      }
    }
    matches.sort((a, b) => {
      const lenDiff = b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
      if (lenDiff !== 0) return lenDiff;
      const prioA = CATEGORY_PRIORITY[a.category] ?? 30;
      const prioB = CATEGORY_PRIORITY[b.category] ?? 30;
      return prioB - prioA;
    });
    const deduped = [];
    for (const m of matches) {
      const overlaps = deduped.some(
        (existing) => m.startIndex < existing.endIndex && m.endIndex > existing.startIndex
      );
      if (!overlaps) {
        deduped.push(m);
      }
    }
    deduped.sort((a, b) => b.startIndex - a.startIndex);
    return deduped;
  }
  /**
   * Redacts all detected PII from the given text and returns
   * the sanitized string.
   */
  redact(text) {
    if (!this.enabled || !text) return text;
    const matches = this.detect(text);
    if (matches.length === 0) return text;
    if (this.onPIIDetected) {
      this.onPIIDetected(matches);
    }
    let result = text;
    for (const match of matches) {
      result = result.slice(0, match.startIndex) + match.redacted + result.slice(match.endIndex);
    }
    return result;
  }
  /**
   * Redacts PII from all string content within a ChatMessage array.
   * Handles both string content and ContentPart[] arrays.
   */
  redactMessages(messages) {
    if (!this.enabled) return messages;
    return messages.map((msg) => {
      const cleaned = { ...msg };
      if (typeof cleaned.content === "string") {
        cleaned.content = this.redact(cleaned.content);
      } else if (Array.isArray(cleaned.content)) {
        cleaned.content = cleaned.content.map(
          (part) => {
            if (part.type === "text" && typeof part.text === "string") {
              return { ...part, text: this.redact(part.text) };
            }
            return part;
          }
        );
      }
      return cleaned;
    });
  }
  /**
   * Returns the total count of PII instances detected in text.
   */
  count(text) {
    return this.detect(text).length;
  }
  /**
   * Returns true if any PII is detected in the given text.
   */
  hasPII(text) {
    return this.detect(text).length > 0;
  }
  /**
   * Reversibly tokenizes all detected PII in text using unique surrogate tokens.
   * Returns the tokenized text and a key-value vault map of tokens to original values.
   */
  tokenize(text, existingVault) {
    const vault = existingVault || /* @__PURE__ */ new Map();
    if (!this.enabled || !text) return { text, vault };
    const matches = this.detect(text);
    if (matches.length === 0) return { text, vault };
    if (this.onPIIDetected) {
      this.onPIIDetected(matches);
    }
    const originalToToken = /* @__PURE__ */ new Map();
    for (const [token, orig] of vault.entries()) {
      originalToToken.set(orig, token);
    }
    let result = text;
    let nextIndex = vault.size + 1;
    for (const match of matches) {
      let token = originalToToken.get(match.original);
      if (!token) {
        token = this.tokenFormat.replace("{category}", match.category.toUpperCase()).replace("{index}", String(nextIndex++));
        vault.set(token, match.original);
        originalToToken.set(match.original, token);
      }
      result = result.slice(0, match.startIndex) + token + result.slice(match.endIndex);
    }
    return { text: result, vault };
  }
  /**
   * Restores original PII values into text that contains surrogate tokens
   * generated by `tokenize()`.
   */
  restore(text, vault) {
    if (!text || !vault) return text;
    let restored = text;
    const entries = vault instanceof Map ? vault.entries() : Object.entries(vault);
    for (const [token, original] of entries) {
      if (restored.includes(token)) {
        restored = restored.replaceAll(token, original);
      }
    }
    return restored;
  }
  /**
   * Reversibly tokenizes an array of chat messages, collecting all PII into a single vault.
   */
  tokenizeMessages(messages, existingVault) {
    const vault = existingVault || /* @__PURE__ */ new Map();
    if (!this.enabled) return { messages, vault };
    const tokenizedMessages = messages.map((msg) => {
      const cleaned = { ...msg };
      if (typeof cleaned.content === "string") {
        const res = this.tokenize(cleaned.content, vault);
        cleaned.content = res.text;
      } else if (Array.isArray(cleaned.content)) {
        cleaned.content = cleaned.content.map(
          (part) => {
            if (part.type === "text" && typeof part.text === "string") {
              const res = this.tokenize(part.text, vault);
              return { ...part, text: res.text };
            }
            return part;
          }
        );
      }
      return cleaned;
    });
    return { messages: tokenizedMessages, vault };
  }
  /**
   * Restores original PII values in a UnifiedApiResponse (content, reasoning, and tool call arguments).
   */
  restoreResponse(response, vault) {
    if (!response || !vault) return response;
    const restoredChoices = response.choices.map((choice) => {
      const msg = { ...choice.message };
      if (typeof msg.content === "string") {
        msg.content = this.restore(msg.content, vault);
      }
      if (typeof msg.reasoning_content === "string") {
        msg.reasoning_content = this.restore(msg.reasoning_content, vault);
      }
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            arguments: this.restore(tc.function.arguments, vault)
          }
        }));
      }
      return {
        ...choice,
        message: msg
      };
    });
    return {
      ...response,
      choices: restoredChoices
    };
  }
  formatRedaction(category) {
    return this.redactionFormat.replace("{category}", category.toUpperCase());
  }
};

// src/core/RateLimiter.ts
var GatewayRateLimitError = class extends Error {
  violation;
  key;
  limitType;
  limit;
  current;
  resetMs;
  retryAfterSec;
  constructor(message, violation) {
    super(message);
    this.name = "GatewayRateLimitError";
    this.violation = violation;
    this.key = violation.key;
    this.limitType = violation.limitType;
    this.limit = violation.limit;
    this.current = violation.current;
    this.resetMs = violation.resetMs;
    this.retryAfterSec = violation.retryAfterSec;
  }
};
var GatewayRateLimiter = class {
  storage;
  options;
  action;
  constructor(storage, options = {}) {
    this.storage = storage;
    this.options = options;
    this.action = options.action || "block";
  }
  /**
   * Resolves the matching rate limit rule for a request based on:
   * 1. Model-specific rule (options.modelRules[model])
   * 2. Provider-specific rule (options.providerRules[providerId])
   * 3. Default rule (options.defaultRule)
   */
  resolveRule(model, providerId) {
    if (model && this.options.modelRules?.[model]) {
      return this.options.modelRules[model];
    }
    if (providerId && this.options.providerRules?.[providerId]) {
      return this.options.providerRules[providerId];
    }
    return this.options.defaultRule;
  }
  /**
   * Generates the partition key for tracking rate limits.
   */
  getKey(request) {
    if (this.options.keyGenerator) {
      return this.options.keyGenerator(request) || "global";
    }
    if (request.user) {
      return `user:${request.user}`;
    }
    return "global";
  }
  /**
   * Estimates the token requirement for an incoming request.
   */
  estimateTokens(request) {
    let tokens = 0;
    if (request.messages) {
      for (const msg of request.messages) {
        tokens += estimateMessageTokens(msg);
      }
    }
    tokens += Math.min(request.maxTokens ?? 256, 1024);
    return Math.max(1, tokens);
  }
  /**
   * Checks whether the request is within limits and consumes the quota.
   */
  async check(request, checkOptions) {
    const rule = this.resolveRule(request.model, checkOptions?.providerId);
    if (!rule) {
      return { allowed: true, resetMs: 0 };
    }
    const windowMs = rule.windowMs || 6e4;
    const now = Date.now();
    const currentWindowId = Math.floor(now / windowMs);
    const elapsedInWindow = now % windowMs;
    const weight = 1 - elapsedInWindow / windowMs;
    const ttlSeconds = Math.ceil(windowMs * 2 / 1e3);
    const resetMs = Math.max(0, windowMs - elapsedInWindow);
    const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1e3));
    const baseKey = this.getKey(request);
    const scope = this.options.modelRules?.[request.model] ? "model" : checkOptions?.providerId && this.options.providerRules?.[checkOptions.providerId] ? "provider" : baseKey.startsWith("user:") ? "user" : "global";
    const scopeKey = scope === "model" ? `${baseKey}:m:${request.model}` : scope === "provider" && checkOptions?.providerId ? `${baseKey}:p:${checkOptions.providerId}` : baseKey;
    let currReqCount = 0;
    let estimatedReqs = 0;
    const reqKeyCurrent = `gw:rl:req:${scopeKey}:${currentWindowId}`;
    const reqKeyPrev = `gw:rl:req:${scopeKey}:${currentWindowId - 1}`;
    if (rule.requestsPerMinute !== void 0) {
      const reqLimit = rule.requestsPerMinute;
      currReqCount = await this.storage.get(reqKeyCurrent) || 0;
      const prevReqCount = await this.storage.get(reqKeyPrev) || 0;
      estimatedReqs = Math.floor(prevReqCount * weight) + currReqCount;
      if (estimatedReqs >= reqLimit) {
        const violation = {
          key: baseKey,
          scope,
          limitType: "requests",
          limit: reqLimit,
          current: estimatedReqs,
          resetMs,
          retryAfterSec,
          model: request.model,
          providerId: checkOptions?.providerId
        };
        this.options.onRateLimitExceeded?.(violation);
        return {
          allowed: false,
          violation,
          remainingRequests: 0,
          resetMs
        };
      }
    }
    let currTokCount = 0;
    let estimatedToks = 0;
    const tokCost = checkOptions?.estimatedTokens ?? this.estimateTokens(request);
    const tokKeyCurrent = `gw:rl:tok:${scopeKey}:${currentWindowId}`;
    const tokKeyPrev = `gw:rl:tok:${scopeKey}:${currentWindowId - 1}`;
    if (rule.tokensPerMinute !== void 0) {
      const tokLimit = rule.tokensPerMinute;
      currTokCount = await this.storage.get(tokKeyCurrent) || 0;
      const prevTokCount = await this.storage.get(tokKeyPrev) || 0;
      estimatedToks = Math.floor(prevTokCount * weight) + currTokCount;
      if (estimatedToks + tokCost > tokLimit) {
        const violation = {
          key: baseKey,
          scope,
          limitType: "tokens",
          limit: tokLimit,
          current: estimatedToks,
          resetMs,
          retryAfterSec,
          model: request.model,
          providerId: checkOptions?.providerId
        };
        this.options.onRateLimitExceeded?.(violation);
        return {
          allowed: false,
          violation,
          remainingRequests: rule.requestsPerMinute !== void 0 ? Math.max(0, rule.requestsPerMinute - estimatedReqs) : void 0,
          remainingTokens: Math.max(0, tokLimit - estimatedToks),
          resetMs
        };
      }
    }
    const shouldConsume = checkOptions?.consume !== false;
    if (shouldConsume) {
      if (rule.requestsPerMinute !== void 0) {
        await this.storage.increment(reqKeyCurrent);
        if (currReqCount === 0) {
          await this.storage.set(reqKeyCurrent, 1, ttlSeconds);
        }
      }
      if (rule.tokensPerMinute !== void 0) {
        const newTokens = currTokCount + tokCost;
        await this.storage.set(tokKeyCurrent, newTokens, ttlSeconds);
      }
    }
    const remainingRequests = rule.requestsPerMinute !== void 0 ? Math.max(0, rule.requestsPerMinute - (estimatedReqs + 1)) : void 0;
    const remainingTokens = rule.tokensPerMinute !== void 0 ? Math.max(0, rule.tokensPerMinute - (estimatedToks + tokCost)) : void 0;
    return {
      allowed: true,
      remainingRequests,
      remainingTokens,
      resetMs
    };
  }
  /**
   * Adjusts the token counter after a response completes if the actual
   * tokens consumed differs from the initial estimate.
   */
  async adjustTokens(request, actualTokens, estimatedTokens, providerId) {
    const delta = actualTokens - estimatedTokens;
    if (delta === 0) return;
    const rule = this.resolveRule(request.model, providerId);
    if (!rule || rule.tokensPerMinute === void 0) return;
    const baseKey = this.getKey(request);
    const scope = this.options.modelRules?.[request.model] ? "model" : providerId && this.options.providerRules?.[providerId] ? "provider" : baseKey.startsWith("user:") ? "user" : "global";
    const scopeKey = scope === "model" ? `${baseKey}:m:${request.model}` : scope === "provider" && providerId ? `${baseKey}:p:${providerId}` : baseKey;
    const windowMs = rule.windowMs || 6e4;
    const currentWindowId = Math.floor(Date.now() / windowMs);
    const tokKeyCurrent = `gw:rl:tok:${scopeKey}:${currentWindowId}`;
    const curr = await this.storage.get(tokKeyCurrent) || 0;
    const updated = Math.max(0, curr + delta);
    const ttlSeconds = Math.ceil(windowMs * 2 / 1e3);
    await this.storage.set(tokKeyCurrent, updated, ttlSeconds);
  }
};

// src/types/index.ts
var BudgetExceededError = class extends Error {
  currentCostUsd;
  limitUsd;
  currentTotalTokens;
  limitTokens;
  constructor(message, details) {
    super(message);
    this.name = "BudgetExceededError";
    this.currentCostUsd = details?.currentCostUsd;
    this.limitUsd = details?.limitUsd;
    this.currentTotalTokens = details?.currentTotalTokens;
    this.limitTokens = details?.limitTokens;
  }
};

// src/utils/metricsExporter.ts
function escapePrometheusLabelValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
function formatPrometheusLabels(labels, extraLabels) {
  const merged = { ...labels, ...extraLabels };
  const entries = Object.entries(merged);
  if (entries.length === 0) return "";
  const formatted = entries.map(([k, v]) => `${k}="${escapePrometheusLabelValue(String(v))}"`).join(",");
  return `{${formatted}}`;
}
function formatPrometheusMetrics(metrics, options = {}) {
  const prefix = options.prefix ?? "sinaps_";
  const baseLabels = options.labels || {};
  const timestampSuffix = options.includeTimestamps ? ` ${Date.now()}` : "";
  const lines = [];
  lines.push(
    `# HELP ${prefix}requests_total Total number of LLM requests handled by SinapsAI gateway`,
    `# TYPE ${prefix}requests_total counter`,
    `${prefix}requests_total${formatPrometheusLabels(baseLabels)} ${metrics.totalRequests}${timestampSuffix}`
  );
  lines.push(
    `# HELP ${prefix}requests_by_status_total Requests broken down by status`,
    `# TYPE ${prefix}requests_by_status_total counter`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: "success" })} ${metrics.successfulRequests}${timestampSuffix}`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: "failure" })} ${metrics.failedRequests}${timestampSuffix}`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: "cached" })} ${metrics.cachedRequests}${timestampSuffix}`
  );
  lines.push(
    `# HELP ${prefix}tokens_total Total tokens processed across all requests`,
    `# TYPE ${prefix}tokens_total counter`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: "prompt" })} ${metrics.totalPromptTokens}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: "completion" })} ${metrics.totalCompletionTokens}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: "cached_prompt" })} ${metrics.totalCachedPromptTokens ?? 0}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: "total" })} ${metrics.totalTokens}${timestampSuffix}`
  );
  lines.push(
    `# HELP ${prefix}estimated_cost_usd Cumulative estimated LLM provider cost in USD`,
    `# TYPE ${prefix}estimated_cost_usd counter`,
    `${prefix}estimated_cost_usd${formatPrometheusLabels(baseLabels)} ${Number(metrics.estimatedCostUsd.toFixed(6))}${timestampSuffix}`
  );
  const providers = Object.entries(metrics.providerMetrics || {});
  if (providers.length > 0) {
    lines.push(
      `# HELP ${prefix}provider_requests_total Total requests dispatched per provider`,
      `# TYPE ${prefix}provider_requests_total counter`
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_requests_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.requests}${timestampSuffix}`
      );
    }
    lines.push(
      `# HELP ${prefix}provider_successes_total Total successful requests per provider`,
      `# TYPE ${prefix}provider_successes_total counter`
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_successes_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.successes}${timestampSuffix}`
      );
    }
    lines.push(
      `# HELP ${prefix}provider_failures_total Total failed requests per provider`,
      `# TYPE ${prefix}provider_failures_total counter`
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_failures_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.failures}${timestampSuffix}`
      );
    }
    lines.push(
      `# HELP ${prefix}provider_tokens_total Total tokens processed per provider by type`,
      `# TYPE ${prefix}provider_tokens_total counter`
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: "prompt" })} ${pm.promptTokens}${timestampSuffix}`,
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: "completion" })} ${pm.completionTokens}${timestampSuffix}`,
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: "cached_prompt" })} ${pm.cachedPromptTokens ?? 0}${timestampSuffix}`
      );
    }
    lines.push(
      `# HELP ${prefix}provider_latency_avg_ms Running average latency per provider in milliseconds`,
      `# TYPE ${prefix}provider_latency_avg_ms gauge`
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_latency_avg_ms${formatPrometheusLabels(baseLabels, { provider: id })} ${Number(pm.averageLatencyMs.toFixed(2))}${timestampSuffix}`
      );
    }
  }
  return `${lines.join("\n")}
`;
}
function formatOtelMetrics(metrics, options = {}) {
  const serviceName = options.serviceName || "sinapsai-gateway";
  const serviceVersion = options.serviceVersion || "2.8.0";
  const nowNano = `${Date.now()}000000`;
  const resourceAttrs = [
    { key: "service.name", value: { stringValue: serviceName } },
    { key: "service.version", value: { stringValue: serviceVersion } }
  ];
  if (options.resourceAttributes) {
    for (const [k, v] of Object.entries(options.resourceAttributes)) {
      if (typeof v === "string") {
        resourceAttrs.push({ key: k, value: { stringValue: v } });
      } else if (typeof v === "number") {
        if (Number.isInteger(v)) {
          resourceAttrs.push({ key: k, value: { intValue: v } });
        } else {
          resourceAttrs.push({ key: k, value: { doubleValue: v } });
        }
      } else if (typeof v === "boolean") {
        resourceAttrs.push({ key: k, value: { boolValue: v } });
      }
    }
  }
  const createSumMetric = (name, description, unit, dataPoints) => ({
    name,
    description,
    unit,
    sum: {
      aggregationTemporality: 2,
      // CUMULATIVE
      isMonotonic: true,
      dataPoints: dataPoints.map((dp) => ({
        asInt: dp.asInt,
        asDouble: dp.asDouble,
        timeUnixNano: nowNano,
        attributes: Object.entries(dp.attributes || {}).map(([k, v]) => ({
          key: k,
          value: { stringValue: v }
        }))
      }))
    }
  });
  const createGaugeMetric = (name, description, unit, dataPoints) => ({
    name,
    description,
    unit,
    gauge: {
      dataPoints: dataPoints.map((dp) => ({
        asDouble: dp.asDouble,
        timeUnixNano: nowNano,
        attributes: Object.entries(dp.attributes || {}).map(([k, v]) => ({
          key: k,
          value: { stringValue: v }
        }))
      }))
    }
  });
  const otelMetrics = [
    createSumMetric(
      "sinaps.requests.total",
      "Total number of LLM requests handled by SinapsAI gateway",
      "{requests}",
      [{ asInt: metrics.totalRequests }]
    ),
    createSumMetric(
      "sinaps.requests.by_status",
      "Requests broken down by completion status",
      "{requests}",
      [
        {
          asInt: metrics.successfulRequests,
          attributes: { status: "success" }
        },
        { asInt: metrics.failedRequests, attributes: { status: "failure" } },
        { asInt: metrics.cachedRequests, attributes: { status: "cached" } }
      ]
    ),
    createSumMetric(
      "sinaps.tokens.total",
      "Total tokens processed across all requests",
      "{tokens}",
      [
        { asInt: metrics.totalPromptTokens, attributes: { type: "prompt" } },
        {
          asInt: metrics.totalCompletionTokens,
          attributes: { type: "completion" }
        },
        {
          asInt: metrics.totalCachedPromptTokens ?? 0,
          attributes: { type: "cached_prompt" }
        },
        { asInt: metrics.totalTokens, attributes: { type: "total" } }
      ]
    ),
    createSumMetric(
      "sinaps.cost.usd",
      "Cumulative estimated LLM provider cost in USD",
      "USD",
      [{ asDouble: Number(metrics.estimatedCostUsd.toFixed(6)) }]
    )
  ];
  const providers = Object.entries(metrics.providerMetrics || {});
  if (providers.length > 0) {
    otelMetrics.push(
      createSumMetric(
        "sinaps.provider.requests",
        "Total requests dispatched per provider",
        "{requests}",
        providers.map(([id, pm]) => ({
          asInt: pm.requests,
          attributes: { provider: id }
        }))
      ),
      createSumMetric(
        "sinaps.provider.successes",
        "Total successful requests per provider",
        "{requests}",
        providers.map(([id, pm]) => ({
          asInt: pm.successes,
          attributes: { provider: id }
        }))
      ),
      createSumMetric(
        "sinaps.provider.failures",
        "Total failed requests per provider",
        "{requests}",
        providers.map(([id, pm]) => ({
          asInt: pm.failures,
          attributes: { provider: id }
        }))
      ),
      createGaugeMetric(
        "sinaps.provider.latency.average",
        "Running average latency per provider in milliseconds",
        "ms",
        providers.map(([id, pm]) => ({
          asDouble: Number(pm.averageLatencyMs.toFixed(2)),
          attributes: { provider: id }
        }))
      )
    );
  }
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: resourceAttrs
        },
        scopeMetrics: [
          {
            scope: {
              name: "sinapsai",
              version: serviceVersion
            },
            metrics: otelMetrics
          }
        ]
      }
    ]
  };
}

// src/utils/similarity.ts
function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return Math.min(1, Math.max(-1, dotProduct / denominator));
}
function extractPromptText(messages) {
  if (!messages || messages.length === 0) {
    return "";
  }
  return messages.map((m) => {
    let contentStr = "";
    if (typeof m.content === "string") {
      contentStr = m.content;
    } else if (Array.isArray(m.content)) {
      contentStr = m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
    }
    return `${m.role}: ${contentStr.trim()}`;
  }).join("\n");
}

// src/core/HedgedExecutor.ts
var HedgedExecutor = class {
  options;
  constructor(options = {}) {
    this.options = {
      ...options,
      enabled: options.enabled ?? true,
      delayMs: options.delayMs ?? 1500,
      maxHedges: options.maxHedges ?? 1
    };
  }
  /**
   * Executes a request against the primary provider and races up to `maxHedges`
   * secondary providers if the primary exceeds `delayMs`.
   * Automatically aborts all losing in-flight requests once a winner resolves.
   */
  async execute(providers, request, dispatcher) {
    if (providers.length === 0) {
      throw new Error(
        "HedgedExecutor: No available providers to execute request."
      );
    }
    const startTime = Date.now();
    if (!this.options.enabled || request.stream || providers.length === 1) {
      const primary = providers[0];
      const response = await dispatcher(primary, request);
      return {
        response,
        winnerProvider: primary,
        wasHedged: false,
        elapsedMs: Date.now() - startTime
      };
    }
    const candidateCount = Math.min(
      providers.length,
      1 + Math.max(1, this.options.maxHedges)
    );
    const selectedProviders = providers.slice(0, candidateCount);
    const controllers = [];
    const timers = [];
    let settled = false;
    const cleanup = (winnerIndex) => {
      for (const t of timers) {
        clearTimeout(t);
      }
      controllers.forEach((ctrl, idx) => {
        if (idx !== winnerIndex && !ctrl.signal.aborted) {
          ctrl.abort();
        }
      });
    };
    if (request.signal) {
      if (request.signal.aborted) {
        throw new Error("Request aborted by caller");
      }
      request.signal.addEventListener(
        "abort",
        () => {
          settled = true;
          cleanup();
        },
        { once: true }
      );
    }
    return new Promise((resolve, reject) => {
      const errors = [];
      let completedCount = 0;
      const launchAttempt = (provider, index) => {
        if (settled) return;
        const ctrl = new AbortController();
        controllers[index] = ctrl;
        const hedgedReq = {
          ...request,
          signal: ctrl.signal
        };
        dispatcher(provider, hedgedReq).then((response) => {
          if (settled) return;
          settled = true;
          const elapsedMs = Date.now() - startTime;
          cleanup(index);
          if (index > 0) {
            this.options.onHedgeWon?.(provider, elapsedMs);
          }
          resolve({
            response,
            winnerProvider: provider,
            wasHedged: index > 0,
            elapsedMs
          });
        }).catch((err) => {
          if (settled) return;
          errors.push(err instanceof Error ? err : new Error(String(err)));
          completedCount++;
          if (completedCount >= selectedProviders.length) {
            settled = true;
            cleanup();
            reject(
              errors[0] || new Error("All hedged provider attempts failed.")
            );
          }
        });
      };
      launchAttempt(selectedProviders[0], 0);
      for (let i = 1; i < selectedProviders.length; i++) {
        const delay = this.options.delayMs * i;
        const timer = setTimeout(() => {
          if (!settled) {
            this.options.onHedgeFired?.(
              selectedProviders[0],
              selectedProviders[i],
              delay
            );
            launchAttempt(selectedProviders[i], i);
          }
        }, delay);
        timers.push(timer);
      }
    });
  }
};

// src/core/Router.ts
var Router = class {
  providers;
  strategy;
  circuitBreaker;
  hooks;
  fallbackModels;
  currentProviderIndex = 0;
  retries;
  retryDelayMs;
  cacheOptions;
  storage;
  budgetOptions;
  hedgingOptions;
  hedgedExecutor;
  semanticEntries = [];
  metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cachedRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    providerMetrics: {}
  };
  constructor(providers, circuitBreaker, options = {}) {
    if (!providers || providers.length === 0) {
      throw new Error("At least one provider must be configured");
    }
    this.providers = providers;
    this.strategy = options.strategy || "failover";
    this.circuitBreaker = circuitBreaker;
    this.hooks = options.hooks;
    this.fallbackModels = options.fallbackModels;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.cacheOptions = options.cache;
    this.storage = options.storage;
    this.budgetOptions = options.budget;
    this.hedgingOptions = options.hedging;
    if (options.hedging && options.hedging.enabled !== false) {
      this.hedgedExecutor = new HedgedExecutor({
        ...options.hedging,
        onHedgeFired: options.hedging.onHedgeFired || options.hooks?.onHedgeFired,
        onHedgeWon: options.hedging.onHedgeWon || options.hooks?.onHedgeWon
      });
    }
  }
  getProviderById(id) {
    return this.providers.find((p) => p.id === id);
  }
  getProviders() {
    return [...this.providers];
  }
  getHedgedExecutor() {
    return this.hedgedExecutor;
  }
  getMetrics() {
    return {
      ...this.metrics,
      providerMetrics: Object.fromEntries(
        Object.entries(this.metrics.providerMetrics).map(([k, v]) => [
          k,
          { ...v }
        ])
      )
    };
  }
  async getCircuitBreakerStatus() {
    const statuses = {};
    for (const p of this.providers) {
      statuses[p.id] = await this.circuitBreaker.getStatus(p.id);
    }
    return statuses;
  }
  async resetCircuitBreaker(providerId) {
    if (providerId) {
      await this.circuitBreaker.reset(providerId);
    } else {
      for (const p of this.providers) {
        await this.circuitBreaker.reset(p.id);
      }
    }
  }
  async clearCache() {
    if (this.storage && typeof this.storage.clear === "function") {
      await this.storage.clear();
    }
    this.semanticEntries = [];
  }
  /**
   * Evaluates health and liveness across all configured providers.
   * Performs passive inspection of circuit states and metrics by default,
   * or active probe pings if options.ping is true.
   */
  async checkHealth(options = {}) {
    const providerHealthList = [];
    for (const p of this.providers) {
      const cbStatus = await this.circuitBreaker.getStatus(p.id);
      const metric = this.metrics.providerMetrics[p.id];
      const totalReqs = metric ? metric.requests : 0;
      const successes = metric ? metric.successes : 0;
      const successRate = totalReqs > 0 ? successes / totalReqs : 1;
      let status = "healthy";
      if (cbStatus.state === "OPEN") {
        status = "unhealthy";
      } else if (cbStatus.state === "HALF_OPEN" || totalReqs >= 5 && successRate < 0.6) {
        status = "degraded";
      }
      let latencyMs = metric?.averageLatencyMs;
      let error;
      if (options.ping) {
        const start = Date.now();
        try {
          const timeoutMs = options.timeoutMs ?? 3e3;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          await p.generateContent({
            model: p.defaultModel || (p.resolveModel ? p.resolveModel("default") : "default"),
            messages: [{ role: "user", content: "ping" }],
            maxTokens: 1,
            signal: controller.signal
          });
          clearTimeout(timer);
          latencyMs = Date.now() - start;
        } catch (err) {
          const e = err;
          error = e?.message || "Health probe failed";
          status = "unhealthy";
        }
      }
      providerHealthList.push({
        id: p.id,
        status,
        circuitState: cbStatus.state,
        latencyMs,
        error,
        successRate: Number(successRate.toFixed(4))
      });
    }
    const allUnhealthy = providerHealthList.every(
      (ph) => ph.status === "unhealthy"
    );
    const allHealthy = providerHealthList.every(
      (ph) => ph.status === "healthy"
    );
    const overallStatus = allUnhealthy ? "unhealthy" : allHealthy ? "healthy" : "degraded";
    return {
      status: overallStatus,
      timestamp: Date.now(),
      providers: providerHealthList
    };
  }
  recordMetrics(providerId, success, latencyMs, promptTokens = 0, completionTokens = 0, costUsd = 0, cachedPromptTokens = 0) {
    if (!this.metrics.providerMetrics[providerId]) {
      this.metrics.providerMetrics[providerId] = {
        requests: 0,
        successes: 0,
        failures: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySumMs: 0,
        averageLatencyMs: 0
      };
    }
    const pm = this.metrics.providerMetrics[providerId];
    pm.requests++;
    if (success) {
      pm.successes++;
      this.metrics.successfulRequests++;
      pm.latencySumMs += latencyMs;
      pm.averageLatencyMs = Math.round(pm.latencySumMs / pm.successes);
    } else {
      pm.failures++;
      this.metrics.failedRequests++;
    }
    pm.promptTokens += promptTokens;
    pm.completionTokens += completionTokens;
    this.metrics.totalPromptTokens += promptTokens;
    this.metrics.totalCompletionTokens += completionTokens;
    this.metrics.totalTokens += promptTokens + completionTokens;
    if (cachedPromptTokens > 0) {
      this.metrics.totalCachedPromptTokens = (this.metrics.totalCachedPromptTokens || 0) + cachedPromptTokens;
      pm.cachedPromptTokens = (pm.cachedPromptTokens || 0) + cachedPromptTokens;
    }
    this.metrics.estimatedCostUsd = Number(
      (this.metrics.estimatedCostUsd + costUsd).toFixed(6)
    );
    if (this.budgetOptions?.action === "warn" && this.budgetOptions.onBudgetWarning) {
      const costExceeded = this.budgetOptions.maxCostUsd !== void 0 && this.metrics.estimatedCostUsd >= this.budgetOptions.maxCostUsd;
      const tokensExceeded = this.budgetOptions.maxTotalTokens !== void 0 && this.metrics.totalTokens >= this.budgetOptions.maxTotalTokens;
      if (costExceeded || tokensExceeded) {
        this.budgetOptions.onBudgetWarning(
          this.metrics.estimatedCostUsd,
          this.budgetOptions.maxCostUsd ?? 0
        );
      }
    }
  }
  checkBudget() {
    if (!this.budgetOptions) return;
    const {
      maxCostUsd,
      maxTotalTokens,
      action = "block",
      onBudgetWarning
    } = this.budgetOptions;
    const costExceeded = maxCostUsd !== void 0 && this.metrics.estimatedCostUsd >= maxCostUsd;
    const tokensExceeded = maxTotalTokens !== void 0 && this.metrics.totalTokens >= maxTotalTokens;
    if (costExceeded || tokensExceeded) {
      if (action === "warn") {
        if (onBudgetWarning) {
          onBudgetWarning(this.metrics.estimatedCostUsd, maxCostUsd ?? 0);
        }
      } else {
        const reason = costExceeded ? `Budget cost limit exceeded: $${this.metrics.estimatedCostUsd} >= $${maxCostUsd}` : `Budget token limit exceeded: ${this.metrics.totalTokens} >= ${maxTotalTokens} tokens`;
        throw new BudgetExceededError(reason, {
          currentCostUsd: this.metrics.estimatedCostUsd,
          limitUsd: maxCostUsd,
          currentTotalTokens: this.metrics.totalTokens,
          limitTokens: maxTotalTokens
        });
      }
    }
  }
  estimateRequestCost(provider, request) {
    if (provider.promptCostPer1k !== void 0 && provider.completionCostPer1k !== void 0) {
      let totalChars = 0;
      if (Array.isArray(request.messages)) {
        for (const msg of request.messages) {
          if (typeof msg.content === "string") {
            totalChars += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text") {
                totalChars += part.text.length;
              } else if (part.type === "image_url") {
                totalChars += 1600;
              } else if (part.type === "input_audio") {
                totalChars += 2e3;
              }
            }
          }
        }
      }
      const estimatedPromptTokens = Math.max(1, Math.ceil(totalChars / 4));
      const estimatedCompletionTokens = request.maxTokens ?? 500;
      return estimatedPromptTokens / 1e3 * provider.promptCostPer1k + estimatedCompletionTokens / 1e3 * provider.completionCostPer1k;
    }
    return provider.costPer1kTokens ?? Number.POSITIVE_INFINITY;
  }
  calculateAdaptiveScore(provider, request) {
    const pm = this.metrics.providerMetrics[provider.id];
    if (!pm || pm.requests === 0) {
      return 100;
    }
    const successRate = (pm.successes + 1) / (pm.requests + 2);
    const rawLatency = pm.averageLatencyMs !== void 0 ? pm.averageLatencyMs : 200;
    const avgLatency = Math.max(30, rawLatency);
    const latencyScore = 1e3 / avgLatency;
    let costFactor = 1;
    if (request) {
      const estimatedCost = this.estimateRequestCost(provider, request);
      if (estimatedCost === 0) {
        costFactor = 1.5;
      } else if (Number.isFinite(estimatedCost) && estimatedCost > 0) {
        costFactor = 1 / (1 + estimatedCost * 50);
      }
    }
    return successRate ** 2 * latencyScore * costFactor * 100;
  }
  computeCacheKey(request) {
    const raw = JSON.stringify({
      m: request.model,
      msgs: request.messages,
      t: request.temperature,
      max: request.maxTokens
    });
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = hash * 33 ^ raw.charCodeAt(i);
    }
    return `cache:${request.model}:${(hash >>> 0).toString(16)}`;
  }
  isRetryableError(error) {
    const status = error.status;
    if (status) {
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return false;
      }
      return true;
    }
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("not found") || msg.includes("permission denied")) {
      return false;
    }
    return true;
  }
  getCandidateModels(provider, request) {
    const list = [];
    if (request.model) {
      list.push(request.model);
    }
    if (provider.fallbackModels && Array.isArray(provider.fallbackModels)) {
      for (const m of provider.fallbackModels) {
        if (m && !list.includes(m)) {
          list.push(m);
        }
      }
    }
    const requestFallbacks = request.fallbackModels ?? this.fallbackModels ?? [];
    for (const m of requestFallbacks) {
      if (m && !list.includes(m)) {
        list.push(m);
      }
    }
    return list.length > 0 ? list : ["default"];
  }
  getSemanticCacheConfig() {
    if (!this.cacheOptions?.semantic) {
      return null;
    }
    if (typeof this.cacheOptions.semantic === "boolean") {
      return this.cacheOptions.semantic ? { enabled: true } : null;
    }
    return {
      enabled: this.cacheOptions.semantic.enabled !== false,
      ...this.cacheOptions.semantic
    };
  }
  async getEmbeddingForText(text, config) {
    try {
      if (typeof config.customEmbed === "function") {
        return await config.customEmbed(text);
      }
      const hasEmbeddingProvider = this.providers.some(
        (p) => typeof p.generateEmbedding === "function"
      );
      if (!hasEmbeddingProvider) {
        return null;
      }
      const res = await this.executeEmbedding({
        model: config.embeddingModel || "default",
        input: text
      });
      return res.data[0]?.embedding ?? null;
    } catch (_error) {
      return null;
    }
  }
  async execute(request) {
    this.checkBudget();
    this.metrics.totalRequests++;
    if (this.cacheOptions?.enabled && !request.stream && this.storage) {
      try {
        const cacheKey = this.computeCacheKey(request);
        const cached = await this.storage.get(cacheKey);
        if (cached) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
          return cached;
        }
      } catch (_e) {
      }
    }
    let queryEmbedding = null;
    const semanticConfig = this.getSemanticCacheConfig();
    if (this.cacheOptions?.enabled && semanticConfig?.enabled && !request.stream) {
      const promptText = extractPromptText(request.messages);
      queryEmbedding = await this.getEmbeddingForText(
        promptText,
        semanticConfig
      );
      if (queryEmbedding && queryEmbedding.length > 0) {
        const now = Date.now();
        this.semanticEntries = this.semanticEntries.filter(
          (e) => e.expiresAt > now
        );
        let bestMatch = null;
        let bestSim = -1;
        for (const entry of this.semanticEntries) {
          if (entry.model === request.model) {
            const sim = cosineSimilarity(queryEmbedding, entry.embedding);
            if (sim > bestSim) {
              bestSim = sim;
              bestMatch = entry;
            }
          }
        }
        const threshold = semanticConfig.similarityThreshold ?? 0.9;
        if (bestMatch && bestSim >= threshold) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
          this.hooks?.onSemanticCacheHit?.(
            request,
            bestMatch.response,
            bestSim
          );
          return bestMatch.response;
        }
      }
    }
    let providersList = this.providers;
    if (this.strategy === "lowest-cost") {
      providersList = [...this.providers].sort((a, b) => {
        const costA = this.estimateRequestCost(a, request);
        const costB = this.estimateRequestCost(b, request);
        if (costA === costB) return 0;
        return costA < costB ? -1 : 1;
      });
    } else if (this.strategy === "lowest-latency") {
      providersList = [...this.providers].sort((a, b) => {
        const reqA = this.metrics.providerMetrics[a.id]?.requests ?? 0;
        const reqB = this.metrics.providerMetrics[b.id]?.requests ?? 0;
        if (reqA === 0 && reqB > 0) return -1;
        if (reqB === 0 && reqA > 0) return 1;
        const latA = this.metrics.providerMetrics[a.id]?.averageLatencyMs ?? 0;
        const latB = this.metrics.providerMetrics[b.id]?.averageLatencyMs ?? 0;
        if (latA === latB) return 0;
        return latA < latB ? -1 : 1;
      });
    } else if (this.strategy === "adaptive" || this.strategy === "smart-hybrid") {
      providersList = [...this.providers].sort((a, b) => {
        const scoreA = this.calculateAdaptiveScore(a, request);
        const scoreB = this.calculateAdaptiveScore(b, request);
        if (scoreA === scoreB) return 0;
        return scoreA > scoreB ? -1 : 1;
      });
    }
    const maxAttempts = providersList.length;
    let startIndex = 0;
    if (this.strategy === "load-balance") {
      startIndex = this.currentProviderIndex;
      this.currentProviderIndex = (this.currentProviderIndex + 1) % providersList.length;
    }
    const errors = [];
    if (this.hedgedExecutor && this.hedgingOptions?.enabled !== false && !request.stream && providersList.length > 1) {
      const availableProviders = [];
      for (const p of providersList) {
        if (this.storage) {
          const throttled = await this.storage.get(`rl:req:${p.id}`);
          if (throttled !== null && throttled <= 0) continue;
        }
        if (await this.circuitBreaker.isAvailable(p.id)) {
          availableProviders.push(p);
        }
      }
      if (availableProviders.length > 1) {
        try {
          const raceResult = await this.hedgedExecutor.execute(
            availableProviders,
            request,
            async (p, reqWithSignal) => {
              return this.executeSingleProvider(p, reqWithSignal);
            }
          );
          await this.saveResponseToCache(
            request,
            raceResult.response,
            queryEmbedding,
            semanticConfig
          );
          raceResult.response.provider = raceResult.winnerProvider.id;
          return raceResult.response;
        } catch (hedgeErr) {
          errors.push(hedgeErr);
        }
      }
    }
    let previousProvider = null;
    let previousError = null;
    for (let i = 0; i < maxAttempts; i++) {
      const index = (startIndex + i) % providersList.length;
      const provider = providersList[index];
      if (previousProvider && previousError) {
        this.hooks?.onFallback?.(previousError, previousProvider, provider);
      }
      if (this.storage) {
        const throttled = await this.storage.get(
          `rl:req:${provider.id}`
        );
        if (throttled !== null && throttled <= 0) {
          const error = new Error(
            `Provider ${provider.id} is proactively throttled due to rate limits`
          );
          errors.push(error);
          previousProvider = provider;
          previousError = error;
          continue;
        }
      }
      const isAvailable = await this.circuitBreaker.isAvailable(provider.id);
      if (!isAvailable) {
        const error = new Error(
          `Provider ${provider.id} is unavailable (Circuit OPEN)`
        );
        errors.push(error);
        previousProvider = provider;
        previousError = error;
        continue;
      }
      const candidateModels = this.getCandidateModels(provider, request);
      let lastModelError = null;
      if (!request.stream) {
        try {
          const apiRes = await this.executeSingleProvider(provider, request);
          await this.saveResponseToCache(
            request,
            apiRes,
            queryEmbedding,
            semanticConfig
          );
          return apiRes;
        } catch (err) {
          lastModelError = err;
        }
      } else {
        for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
          const isStillAvailable = await this.circuitBreaker.isAvailable(
            provider.id
          );
          if (!isStillAvailable) {
            break;
          }
          const currentModel = candidateModels[mIdx];
          const currentRequest = currentModel === request.model ? request : { ...request, model: currentModel };
          const maxRetries = provider.retries ?? this.retries;
          const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
          let attempt = 0;
          while (true) {
            const startTime = Date.now();
            try {
              const res = await this.circuitBreaker.execute(
                provider,
                currentRequest
              );
              if (res != null && typeof res === "object" && Symbol.asyncIterator in res) {
                const self = this;
                const iterable = res;
                let firstChunkTime = 0;
                let collectedPromptTokens = 0;
                let collectedCompletionTokens = 0;
                let collectedCachedPromptTokens = 0;
                return (async function* () {
                  try {
                    for await (const chunk of iterable) {
                      if (!firstChunkTime) {
                        firstChunkTime = Date.now();
                      }
                      if (chunk.usage) {
                        collectedPromptTokens = chunk.usage.promptTokens || collectedPromptTokens;
                        collectedCompletionTokens = chunk.usage.completionTokens || collectedCompletionTokens;
                        collectedCachedPromptTokens = chunk.usage.cachedPromptTokens || collectedCachedPromptTokens;
                      }
                      yield chunk;
                    }
                    const totalLatencyMs = Date.now() - startTime;
                    const ttftMs = firstChunkTime ? firstChunkTime - startTime : totalLatencyMs;
                    let costUsd = 0;
                    if (provider.promptCostPer1k !== void 0 && provider.completionCostPer1k !== void 0) {
                      const uncached = Math.max(
                        0,
                        collectedPromptTokens - collectedCachedPromptTokens
                      );
                      const effectivePrompt = uncached + collectedCachedPromptTokens * 0.25;
                      costUsd = effectivePrompt / 1e3 * provider.promptCostPer1k + collectedCompletionTokens / 1e3 * provider.completionCostPer1k;
                    } else if (provider.costPer1kTokens !== void 0) {
                      const uncached = Math.max(
                        0,
                        collectedPromptTokens - collectedCachedPromptTokens
                      );
                      const effectiveTokens = uncached + collectedCachedPromptTokens * 0.25 + collectedCompletionTokens;
                      costUsd = effectiveTokens / 1e3 * provider.costPer1kTokens;
                    }
                    self.recordMetrics(
                      provider.id,
                      true,
                      totalLatencyMs,
                      collectedPromptTokens,
                      collectedCompletionTokens,
                      costUsd,
                      collectedCachedPromptTokens
                    );
                    self.hooks?.onStreamSuccess?.(
                      provider,
                      ttftMs,
                      totalLatencyMs
                    );
                  } catch (streamError) {
                    const isAbort = request.signal?.aborted || streamError?.name === "AbortError" || streamError?.message?.toLowerCase().includes("aborted");
                    if (!isAbort) {
                      self.recordMetrics(
                        provider.id,
                        false,
                        Date.now() - startTime,
                        0,
                        0,
                        0
                      );
                    }
                    throw streamError;
                  }
                })();
              }
            } catch (error) {
              const err = error;
              if (request.signal?.aborted) {
                throw err;
              }
              if (err.status === 429 || err.message.includes("429") || err.message.toLowerCase().includes("rate limit")) {
                this.hooks?.onRateLimit?.(provider, err);
                if (this.storage) {
                  await this.storage.set(`rl:req:${provider.id}`, 0, 10);
                }
              }
              if (attempt < maxRetries && this.isRetryableError(err) && !request.signal?.aborted && await this.circuitBreaker.isAvailable(provider.id)) {
                attempt++;
                const jitter = Math.random() * 50;
                const delay = Math.min(
                  baseDelay * 2 ** (attempt - 1) + jitter,
                  1e4
                );
                this.hooks?.onRetry?.(provider, err, attempt, delay);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
              this.recordMetrics(
                provider.id,
                false,
                Date.now() - startTime,
                0,
                0,
                0
              );
              lastModelError = err;
              const isAuthError2 = err.status === 401 || err.message.toLowerCase().includes("unauthorized") || err.message.toLowerCase().includes("invalid api key");
              if (isAuthError2) {
                break;
              }
              if (mIdx + 1 < candidateModels.length) {
                const nextModel = candidateModels[mIdx + 1];
                this.hooks?.onModelFallback?.(
                  err,
                  provider,
                  currentModel,
                  nextModel
                );
              }
              break;
            }
          }
          const isAuthError = lastModelError?.status === 401 || lastModelError?.message?.toLowerCase().includes("unauthorized") || lastModelError?.message?.toLowerCase().includes("invalid api key");
          if (isAuthError) {
            break;
          }
        }
      }
      if (lastModelError) {
        errors.push(lastModelError);
        previousProvider = provider;
        previousError = lastModelError;
      }
    }
    throw new AggregateError(errors, "All providers failed or are unavailable");
  }
  async executeSingleProvider(provider, request) {
    const candidateModels = this.getCandidateModels(provider, request);
    let lastModelError = null;
    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const isStillAvailable = await this.circuitBreaker.isAvailable(
        provider.id
      );
      if (!isStillAvailable) {
        break;
      }
      const currentModel = candidateModels[mIdx];
      const currentRequest = currentModel === request.model ? request : { ...request, model: currentModel };
      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;
      while (true) {
        const startTime = Date.now();
        try {
          const res = await this.circuitBreaker.execute(
            provider,
            currentRequest
          );
          const latencyMs = Date.now() - startTime;
          if ("choices" in res) {
            const apiRes = res;
            this.hooks?.onSuccess?.(provider, apiRes, latencyMs);
            const promptTokens = apiRes.usage?.promptTokens ?? 0;
            const completionTokens = apiRes.usage?.completionTokens ?? 0;
            const cachedPromptTokens = apiRes.usage?.cachedPromptTokens ?? 0;
            let costUsd = 0;
            if (provider.promptCostPer1k !== void 0 && provider.completionCostPer1k !== void 0) {
              const uncached = Math.max(0, promptTokens - cachedPromptTokens);
              const effectivePrompt = uncached + cachedPromptTokens * 0.25;
              costUsd = effectivePrompt / 1e3 * provider.promptCostPer1k + completionTokens / 1e3 * provider.completionCostPer1k;
            } else if (provider.costPer1kTokens !== void 0) {
              const uncached = Math.max(0, promptTokens - cachedPromptTokens);
              const effectiveTokens = uncached + cachedPromptTokens * 0.25 + completionTokens;
              costUsd = effectiveTokens / 1e3 * provider.costPer1kTokens;
            }
            this.recordMetrics(
              provider.id,
              true,
              latencyMs,
              promptTokens,
              completionTokens,
              costUsd,
              cachedPromptTokens
            );
            if (apiRes.rateLimit) {
              if (apiRes.rateLimit.remainingRequests !== void 0 && apiRes.rateLimit.remainingRequests <= 1) {
                this.hooks?.onRateLimitWarning?.(provider, apiRes.rateLimit);
                if (this.storage) {
                  const ttlSec = apiRes.rateLimit.resetMs ? Math.max(1, Math.ceil(apiRes.rateLimit.resetMs / 1e3)) : 10;
                  await this.storage.set(`rl:req:${provider.id}`, 0, ttlSec);
                }
              }
            }
            apiRes.provider = provider.id;
            return apiRes;
          }
          throw new Error("Invalid response structure received from provider");
        } catch (error) {
          const err = error;
          if (request.signal?.aborted) {
            throw err;
          }
          if (err.status === 429 || err.message.includes("429") || err.message.toLowerCase().includes("rate limit")) {
            this.hooks?.onRateLimit?.(provider, err);
            if (this.storage) {
              await this.storage.set(`rl:req:${provider.id}`, 0, 10);
            }
          }
          if (attempt < maxRetries && this.isRetryableError(err) && !request.signal?.aborted && await this.circuitBreaker.isAvailable(provider.id)) {
            attempt++;
            const jitter = Math.random() * 50;
            const delay = Math.min(
              baseDelay * 2 ** (attempt - 1) + jitter,
              1e4
            );
            this.hooks?.onRetry?.(provider, err, attempt, delay);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          const isAbort = request.signal?.aborted || err?.name === "AbortError" || err?.message?.toLowerCase().includes("aborted");
          if (!isAbort) {
            this.recordMetrics(
              provider.id,
              false,
              Date.now() - startTime,
              0,
              0,
              0
            );
          }
          lastModelError = err;
          const isAuthError2 = err.status === 401 || err.message.toLowerCase().includes("unauthorized") || err.message.toLowerCase().includes("invalid api key");
          if (isAuthError2) {
            break;
          }
          if (mIdx + 1 < candidateModels.length) {
            const nextModel = candidateModels[mIdx + 1];
            this.hooks?.onModelFallback?.(
              err,
              provider,
              currentModel,
              nextModel
            );
          }
          break;
        }
      }
      const isAuthError = lastModelError?.status === 401 || lastModelError?.message?.toLowerCase().includes("unauthorized") || lastModelError?.message?.toLowerCase().includes("invalid api key");
      if (isAuthError) {
        break;
      }
    }
    throw lastModelError || new Error(`Provider ${provider.id} failed to execute request`);
  }
  async saveResponseToCache(request, apiRes, queryEmbedding, semanticConfig) {
    if (this.cacheOptions?.enabled && this.storage) {
      try {
        const cacheKey = this.computeCacheKey(request);
        await this.storage.set(
          cacheKey,
          apiRes,
          this.cacheOptions.ttlSeconds ?? 300
        );
      } catch (_e) {
      }
    }
    if (this.cacheOptions?.enabled && semanticConfig?.enabled && !request.stream) {
      try {
        const promptText = extractPromptText(request.messages);
        let emb = queryEmbedding;
        if (!emb) {
          emb = await this.getEmbeddingForText(promptText, semanticConfig);
        }
        if (emb && emb.length > 0) {
          const maxEntries = semanticConfig.maxEntries ?? 1e3;
          const ttlMs = (this.cacheOptions.ttlSeconds ?? 300) * 1e3;
          if (this.semanticEntries.length >= maxEntries) {
            this.semanticEntries.shift();
          }
          this.semanticEntries.push({
            model: request.model,
            prompt: promptText,
            embedding: emb,
            response: apiRes,
            expiresAt: Date.now() + ttlMs
          });
        }
      } catch (_e) {
      }
    }
  }
  computeEmbeddingCacheKey(request) {
    const raw = JSON.stringify({
      m: request.model,
      inp: request.input
    });
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = hash * 33 ^ raw.charCodeAt(i);
    }
    return `cache:emb:${request.model}:${(hash >>> 0).toString(16)}`;
  }
  async executeEmbedding(request) {
    this.checkBudget();
    this.metrics.totalRequests++;
    if (this.cacheOptions?.enabled && this.storage) {
      try {
        const cacheKey = this.computeEmbeddingCacheKey(request);
        const cached = await this.storage.get(cacheKey);
        if (cached) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
          return cached;
        }
      } catch (_e) {
      }
    }
    const eligibleProviders = this.providers.filter(
      (p) => typeof p.generateEmbedding === "function"
    );
    if (eligibleProviders.length === 0) {
      throw new Error(
        "No configured provider supports embedding generation (generateEmbedding)"
      );
    }
    let providersList = eligibleProviders;
    if (this.strategy === "lowest-cost") {
      providersList = [...eligibleProviders].sort((a, b) => {
        const costA = a.promptCostPer1k ?? a.costPer1kTokens ?? Number.POSITIVE_INFINITY;
        const costB = b.promptCostPer1k ?? b.costPer1kTokens ?? Number.POSITIVE_INFINITY;
        if (costA === costB) return 0;
        return costA < costB ? -1 : 1;
      });
    } else if (this.strategy === "lowest-latency") {
      providersList = [...eligibleProviders].sort((a, b) => {
        const reqA = this.metrics.providerMetrics[a.id]?.requests ?? 0;
        const reqB = this.metrics.providerMetrics[b.id]?.requests ?? 0;
        if (reqA === 0 && reqB > 0) return -1;
        if (reqB === 0 && reqA > 0) return 1;
        const latA = this.metrics.providerMetrics[a.id]?.averageLatencyMs ?? 0;
        const latB = this.metrics.providerMetrics[b.id]?.averageLatencyMs ?? 0;
        if (latA === latB) return 0;
        return latA < latB ? -1 : 1;
      });
    } else if (this.strategy === "adaptive" || this.strategy === "smart-hybrid") {
      providersList = [...eligibleProviders].sort((a, b) => {
        const scoreA = this.calculateAdaptiveScore(a);
        const scoreB = this.calculateAdaptiveScore(b);
        if (scoreA === scoreB) return 0;
        return scoreA > scoreB ? -1 : 1;
      });
    }
    const maxAttempts = providersList.length;
    let startIndex = 0;
    if (this.strategy === "load-balance") {
      startIndex = this.currentProviderIndex % providersList.length;
      this.currentProviderIndex = (this.currentProviderIndex + 1) % providersList.length;
    }
    const errors = [];
    let previousProvider = null;
    let previousError = null;
    for (let i = 0; i < maxAttempts; i++) {
      const index = (startIndex + i) % providersList.length;
      const provider = providersList[index];
      if (previousProvider && previousError) {
        this.hooks?.onFallback?.(previousError, previousProvider, provider);
      }
      if (this.storage) {
        const throttled = await this.storage.get(
          `rl:req:${provider.id}`
        );
        if (throttled !== null && throttled <= 0) {
          const error = new Error(
            `Provider ${provider.id} is proactively throttled due to rate limits`
          );
          errors.push(error);
          previousProvider = provider;
          previousError = error;
          continue;
        }
      }
      const isAvailable = await this.circuitBreaker.isAvailable(provider.id);
      if (!isAvailable) {
        const error = new Error(
          `Provider ${provider.id} is unavailable (Circuit OPEN)`
        );
        errors.push(error);
        previousProvider = provider;
        previousError = error;
        continue;
      }
      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;
      while (true) {
        const startTime = Date.now();
        try {
          if (!provider.generateEmbedding) {
            throw new Error(
              `Provider ${provider.id} does not support generateEmbedding`
            );
          }
          const res = await provider.generateEmbedding(request);
          const latencyMs = Date.now() - startTime;
          await this.circuitBreaker.recordSuccess(provider.id);
          this.hooks?.onEmbeddingSuccess?.(provider, res, latencyMs);
          const promptTokens = res.usage?.promptTokens ?? 0;
          let costUsd = 0;
          if (provider.promptCostPer1k !== void 0) {
            costUsd = promptTokens / 1e3 * provider.promptCostPer1k;
          } else if (provider.costPer1kTokens !== void 0) {
            costUsd = promptTokens / 1e3 * provider.costPer1kTokens;
          }
          this.recordMetrics(
            provider.id,
            true,
            latencyMs,
            promptTokens,
            0,
            costUsd
          );
          if (this.cacheOptions?.enabled && this.storage) {
            try {
              const cacheKey = this.computeEmbeddingCacheKey(request);
              await this.storage.set(
                cacheKey,
                res,
                this.cacheOptions.ttlSeconds ?? 300
              );
            } catch (_e) {
            }
          }
          return res;
        } catch (error) {
          const err = error;
          if (err.status === 429 || err.message.includes("429") || err.message.toLowerCase().includes("rate limit")) {
            this.hooks?.onRateLimit?.(provider, err);
            if (this.storage) {
              await this.storage.set(`rl:req:${provider.id}`, 0, 10);
            }
          }
          if (attempt < maxRetries && this.isRetryableError(err) && !request.signal?.aborted && await this.circuitBreaker.isAvailable(provider.id)) {
            attempt++;
            const jitter = Math.random() * 50;
            const delay = Math.min(
              baseDelay * 2 ** (attempt - 1) + jitter,
              1e4
            );
            this.hooks?.onRetry?.(provider, err, attempt, delay);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          await this.circuitBreaker.recordFailure(provider.id);
          this.recordMetrics(
            provider.id,
            false,
            Date.now() - startTime,
            0,
            0,
            0
          );
          errors.push(err);
          previousProvider = provider;
          previousError = err;
          break;
        }
      }
    }
    throw new AggregateError(
      errors,
      "All eligible embedding providers failed or are unavailable"
    );
  }
  /**
   * Formats current gateway telemetry metrics into Prometheus / OpenMetrics exposition format.
   */
  exportPrometheusMetrics(options) {
    return formatPrometheusMetrics(this.getMetrics(), options);
  }
  /**
   * Alias for exportPrometheusMetrics.
   */
  toPrometheusMetrics(options) {
    return this.exportPrometheusMetrics(options);
  }
  /**
   * Formats current gateway telemetry metrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
   */
  exportOtelMetrics(options) {
    return formatOtelMetrics(this.getMetrics(), options);
  }
  /**
   * Alias for exportOtelMetrics.
   */
  toOtelMetrics(options) {
    return this.exportOtelMetrics(options);
  }
};

// src/core/SecurityGuardrails.ts
var SecurityGuardrailError = class extends Error {
  violations;
  constructor(message, violations) {
    super(message);
    this.name = "SecurityGuardrailError";
    this.violations = violations;
  }
};
var DEFAULT_THREAT_RULES = [
  // 1. System Prompt Override & Directive Reset
  {
    category: "system_override",
    regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|commands|context)/i
  },
  {
    category: "system_override",
    regex: /(?:disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|safety|guardrail|system)\s+(?:instructions|guidelines|rules|prompts)/i
  },
  {
    category: "system_override",
    regex: /\boverride\s+(?:system\s+)?(?:prompt|instructions|rules)\b/i
  },
  // 2. Jailbreak Personas & Unrestricted AI Activation
  {
    category: "jailbreak",
    regex: /\byou\s+are\s+now\s+(?:dan|unrestricted|jailbroken|freed|an\s+evil|chaosgpt)\b/i
  },
  {
    category: "jailbreak",
    regex: /\bdeveloper\s+mode\s+(?:is\s+)?(?:enabled|activated|on)\b/i
  },
  {
    category: "jailbreak",
    regex: /\bdo\s+anything\s+now\b/i
  },
  {
    category: "jailbreak",
    regex: /\bignore\s+ethical\s+guidelines\b/i
  },
  {
    category: "jailbreak",
    regex: /\bact\s+as\s+an?\s+unfiltered\s+ai\b/i
  },
  // 3. Chat Delimiter Hijacking & Format Injection
  {
    category: "delimiter_hijack",
    regex: /<\s*\|\s*im_start\s*\|\s*>\s*system/i
  },
  {
    category: "delimiter_hijack",
    regex: /\[SYSTEM(?:\s+PROMPT)?\]/i
  },
  {
    category: "delimiter_hijack",
    regex: /<<SYS>>[\s\S]*?<\/SYS>>/i
  },
  {
    category: "delimiter_hijack",
    regex: /<\/?(?:INST|SYS|SYSTEM)>/i
  },
  {
    category: "delimiter_hijack",
    regex: /---+ ?(?:BEGIN|START) SYSTEM (?:PROMPT|INSTRUCTIONS) ?---+/i
  },
  // 4. Secret & System Prompt Exfiltration
  {
    category: "secret_exfiltration",
    regex: /(?:print|output|reveal|display|leak|repeat)\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions|system\s+instructions)\s+(?:verbatim|word\s+for\s+word|in\s+full)/i
  },
  {
    category: "secret_exfiltration",
    regex: /(?:what\s+are\s+your|show\s+me\s+your)\s+(?:initial\s+instructions|system\s+prompts?|hidden\s+rules)/i
  },
  // 5. Prompt Injection Syntax Patterns
  {
    category: "prompt_injection",
    regex: /\bnew\s+instructions\s*:\s*(?:you\s+must|always|ignore)/i
  },
  {
    category: "prompt_injection",
    regex: /\bhidden\s+instructions\s*:/i
  }
];
var SecurityGuardrails = class {
  enabled;
  action;
  rules;
  allowedPatterns;
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.action = options.action ?? "block";
    this.rules = [...DEFAULT_THREAT_RULES, ...options.customPatterns ?? []];
    this.allowedPatterns = options.allowedPatterns ?? [];
  }
  /**
   * Scans a text string for prompt injection or jailbreak indicators.
   */
  scan(text) {
    if (!this.enabled || !text) {
      return {
        safe: true,
        sanitizedText: text || "",
        violations: []
      };
    }
    const violations = [];
    let sanitizedText = text;
    for (const rule of this.rules) {
      const flags = rule.regex.flags.includes("g") ? rule.regex.flags : `${rule.regex.flags}g`;
      const globalRegex = new RegExp(rule.regex.source, flags);
      let match;
      while (true) {
        match = globalRegex.exec(text);
        if (match === null) break;
        const matchedText = match[0];
        const isAllowed = this.allowedPatterns.some((allowed) => {
          if (allowed.test(matchedText)) return true;
          const textMatch = allowed.exec(text);
          if (textMatch && match) {
            const start = textMatch.index;
            const end = start + textMatch[0].length;
            return match.index >= start && match.index + matchedText.length <= end;
          }
          return false;
        });
        if (isAllowed) {
          continue;
        }
        const violation = {
          category: rule.category,
          pattern: rule.regex.source,
          matchedText,
          action: this.action,
          timestamp: Date.now()
        };
        violations.push(violation);
        if (this.action === "sanitize") {
          sanitizedText = sanitizedText.replace(
            matchedText,
            `[SECURITY_REDACTED: ${rule.category}]`
          );
        }
      }
    }
    return {
      safe: violations.length === 0,
      sanitizedText,
      violations
    };
  }
  /**
   * Scans an array of ChatMessage objects and applies the configured action.
   */
  scanMessages(messages) {
    if (!this.enabled || !messages || messages.length === 0) {
      return {
        safe: true,
        messages: messages || [],
        violations: []
      };
    }
    const allViolations = [];
    const updatedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (typeof msg.content === "string") {
        const scanResult = this.scan(msg.content);
        if (!scanResult.safe) {
          for (const v of scanResult.violations) {
            allViolations.push({ ...v, messageIndex: i });
          }
        }
        updatedMessages.push({
          ...msg,
          content: this.action === "sanitize" ? scanResult.sanitizedText : msg.content
        });
      } else {
        updatedMessages.push(msg);
      }
    }
    return {
      safe: allViolations.length === 0,
      messages: updatedMessages,
      violations: allViolations
    };
  }
};

// src/core/SinapsClient.ts
var SinapsClient = class {
  router;
  storage;
  guardrails;
  securityGuardrails;
  contextCompressor;
  hedgedExecutor;
  rateLimiter;
  mcp;
  isReversiblePII = false;
  modelAliases = /* @__PURE__ */ new Map();
  hooks;
  constructor(options) {
    this.storage = options.storage || new InMemoryStorage();
    this.hooks = options.hooks;
    this.mcp = options.mcpBridge || new McpToolBridge();
    if (options.modelAliases) {
      for (const [alias, target] of Object.entries(options.modelAliases)) {
        this.modelAliases.set(alias, target);
      }
    }
    if (options.rateLimiting) {
      if (options.rateLimiting === true) {
        this.rateLimiter = new GatewayRateLimiter(this.storage, {
          defaultRule: { requestsPerMinute: 600 }
        });
      } else {
        this.rateLimiter = new GatewayRateLimiter(
          this.storage,
          options.rateLimiting
        );
      }
    }
    if (options.securityGuardrails) {
      if (options.securityGuardrails === true) {
        this.securityGuardrails = new SecurityGuardrails();
      } else {
        this.securityGuardrails = new SecurityGuardrails(
          options.securityGuardrails
        );
      }
    }
    if (options.piiGuardrails) {
      if (options.piiGuardrails === true) {
        this.guardrails = new PIIGuardrails();
      } else {
        this.guardrails = new PIIGuardrails(options.piiGuardrails);
        this.isReversiblePII = options.piiGuardrails.reversible === true;
      }
    }
    if (options.contextCompression) {
      this.contextCompressor = new ContextCompressor(
        options.contextCompression
      );
    }
    const cb = new CircuitBreaker(this.storage, {
      ...options.circuitBreaker,
      onCircuitOpen: (providerId) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitOpen?.(provider);
        }
      },
      onCircuitClose: (providerId) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitClose?.(provider);
        }
      }
    });
    this.router = new Router(options.providers, cb, {
      strategy: options.strategy,
      hooks: options.hooks,
      fallbackModels: options.fallbackModels,
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
      cache: options.cache,
      storage: this.storage,
      budget: options.budget,
      hedging: options.hedging
    });
    this.hedgedExecutor = this.router.getHedgedExecutor();
  }
  chat = {
    completions: {
      create: (async (request) => {
        let messages = request.messages;
        let piiVault;
        if (this.securityGuardrails) {
          const scan = this.securityGuardrails.scanMessages(messages);
          if (!scan.safe) {
            for (const v of scan.violations) {
              this.hooks?.onSecurityViolation?.(v, v.messageIndex);
            }
            if (this.securityGuardrails.action === "block") {
              throw new SecurityGuardrailError(
                `Prompt rejected due to security violations: ${scan.violations.map((v) => v.category).join(", ")}`,
                scan.violations
              );
            }
          }
          messages = scan.messages;
        }
        if (this.guardrails) {
          if (this.isReversiblePII && !request.stream) {
            const tokenized = this.guardrails.tokenizeMessages(messages);
            messages = tokenized.messages;
            piiVault = tokenized.vault;
          } else {
            messages = this.guardrails.redactMessages(messages);
          }
        }
        if (this.contextCompressor) {
          const compressed = this.contextCompressor.compress(messages);
          messages = compressed.messages;
        }
        const resolvedModel = this.resolveModel(request.model);
        const fullReq = {
          model: resolvedModel,
          messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools: request.tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
          fallbackModels: request.fallbackModels,
          thinkingBudget: request.thinkingBudget,
          reasoningEffort: request.reasoningEffort,
          user: request.user
        };
        let estimatedTokens = 0;
        if (this.rateLimiter) {
          estimatedTokens = this.rateLimiter.estimateTokens(fullReq);
          const check = await this.rateLimiter.check(fullReq, {
            estimatedTokens
          });
          if (!check.allowed && check.violation) {
            this.hooks?.onGatewayRateLimitWarning?.(check.violation);
            if (this.rateLimiter.action === "block") {
              throw new GatewayRateLimitError(
                `Gateway rate limit exceeded: ${check.violation.limitType} limit reached for ${check.violation.key} (${check.violation.current}/${check.violation.limit}). Retry after ${check.violation.retryAfterSec}s.`,
                check.violation
              );
            }
          }
        }
        const res = await this.router.execute(fullReq);
        const actualTokens = res.usage?.totalTokens;
        if (this.rateLimiter && !request.stream && actualTokens !== void 0) {
          await this.rateLimiter.adjustTokens(
            fullReq,
            actualTokens,
            estimatedTokens,
            res.provider
          );
        }
        if (this.rateLimiter && request.stream) {
          const limiter = this.rateLimiter;
          const stream = res;
          return (async function* () {
            let actualStreamTokens;
            try {
              for await (const chunk of stream) {
                if (chunk.usage) {
                  const calculated = chunk.usage.totalTokens ?? (chunk.usage.promptTokens || 0) + (chunk.usage.completionTokens || 0);
                  actualStreamTokens = calculated > 0 ? calculated : void 0;
                }
                yield chunk;
              }
            } finally {
              if (actualStreamTokens !== void 0) {
                await limiter.adjustTokens(
                  fullReq,
                  actualStreamTokens,
                  estimatedTokens
                );
              }
            }
          })();
        }
        if (this.guardrails && piiVault && piiVault.size > 0 && !request.stream && "choices" in res) {
          return this.guardrails.restoreResponse(
            res,
            piiVault
          );
        }
        return res;
      }),
      /**
       * Accumulates a streaming response into a complete UnifiedApiResponse.
       */
      accumulateStream: async (stream, options) => {
        return accumulateStream(stream, options);
      },
      /**
       * Safely extracts and parses JSON data from a response or text string.
       */
      extractJson: (textOrResponse) => {
        if (typeof textOrResponse === "string") {
          return extractJsonFromText(textOrResponse);
        }
        const text = textOrResponse.choices?.[0]?.message?.content || "";
        return extractJsonFromText(text);
      },
      /**
       * Safely attempts to extract and parse JSON data, returning null if invalid.
       */
      tryExtractJson: (textOrResponse) => {
        if (typeof textOrResponse === "string") {
          return tryExtractJson(textOrResponse);
        }
        const text = textOrResponse.choices?.[0]?.message?.content || "";
        return tryExtractJson(text);
      }
    }
  };
  /**
   * Helper to accumulate streaming chunks into a single UnifiedApiResponse.
   */
  async accumulateStream(stream, options) {
    return accumulateStream(stream, options);
  }
  /**
   * Helper to safely extract JSON from LLM text responses or response objects.
   */
  extractJson(textOrResponse) {
    return this.chat.completions.extractJson(textOrResponse);
  }
  /**
   * Helper to safely attempt JSON extraction, returning null if parsing fails.
   */
  tryExtractJson(textOrResponse) {
    return this.chat.completions.tryExtractJson(textOrResponse);
  }
  embeddings = {
    create: async (request) => {
      const model = this.resolveModel(request.model);
      const fullReq = {
        ...request,
        model
      };
      if (this.rateLimiter) {
        const dummyReq = {
          model,
          messages: [],
          user: request.user
        };
        const inputTokens = Array.isArray(request.input) ? request.input.reduce(
          (acc, str) => acc + Math.ceil(str.length / 4),
          0
        ) : Math.ceil(request.input.length / 4);
        const check = await this.rateLimiter.check(dummyReq, {
          estimatedTokens: inputTokens
        });
        if (!check.allowed && check.violation) {
          this.hooks?.onGatewayRateLimitWarning?.(check.violation);
          if (this.rateLimiter.action === "block") {
            throw new GatewayRateLimitError(
              `Gateway rate limit exceeded: ${check.violation.limitType} limit reached for ${check.violation.key} (${check.violation.current}/${check.violation.limit}). Retry after ${check.violation.retryAfterSec}s.`,
              check.violation
            );
          }
        }
      }
      return this.router.executeEmbedding(fullReq);
    }
  };
  batch = {
    /**
     * Executes multiple non-streaming chat completion requests concurrently with
     * built-in concurrency control, fail-soft resilience, and progress reporting.
     */
    chat: async (requests, options) => {
      return executeBatch(
        requests,
        async (req) => {
          const res = await this.chat.completions.create(req);
          return res;
        },
        options
      );
    },
    /**
     * Executes multiple text embedding requests concurrently with
     * built-in concurrency control, fail-soft resilience, and progress reporting.
     */
    embeddings: async (requests, options) => {
      return executeBatch(
        requests,
        async (req) => this.embeddings.create(req),
        options
      );
    },
    /**
     * General concurrency executor for running any custom async task over an array of items.
     */
    create: async (items, handler, options) => {
      return executeBatch(items, handler, options);
    }
  };
  getMetrics() {
    return this.router.getMetrics();
  }
  async getCircuitBreakerStatus() {
    return this.router.getCircuitBreakerStatus();
  }
  async resetCircuitBreaker(providerId) {
    return this.router.resetCircuitBreaker(providerId);
  }
  async clearCache() {
    return this.router.clearCache();
  }
  /**
   * Resolves a model name against configured model aliases.
   */
  resolveModel(modelName) {
    if (!modelName) return "default";
    return this.modelAliases.get(modelName) || modelName;
  }
  /**
   * Registers or updates a friendly model alias.
   */
  setModelAlias(alias, targetModel) {
    this.modelAliases.set(alias, targetModel);
  }
  /**
   * Returns all currently registered model aliases.
   */
  getModelAliases() {
    return Object.fromEntries(this.modelAliases.entries());
  }
  /**
   * Removes a registered model alias.
   */
  removeModelAlias(alias) {
    return this.modelAliases.delete(alias);
  }
  /**
   * Checks the health and liveness of all configured providers.
   */
  async checkHealth(options) {
    return this.router.checkHealth(options);
  }
  /**
   * Formats current gateway telemetry metrics into Prometheus / OpenMetrics exposition format.
   */
  exportPrometheusMetrics(options) {
    return this.router.exportPrometheusMetrics(options);
  }
  /**
   * Alias for exportPrometheusMetrics.
   */
  toPrometheusMetrics(options) {
    return this.exportPrometheusMetrics(options);
  }
  /**
   * Formats current gateway telemetry metrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
   */
  exportOtelMetrics(options) {
    return this.router.exportOtelMetrics(options);
  }
  /**
   * Alias for exportOtelMetrics.
   */
  toOtelMetrics(options) {
    return this.exportOtelMetrics(options);
  }
  /**
   * Runs an autonomous multi-step tool-calling agent loop.
   *
   * Repeatedly queries the model with available MCP tools, executes requested tool calls
   * via the McpToolBridge, feeds results back into the conversation, and returns the final
   * response and complete conversation history once the model finishes or maxSteps is reached.
   */
  async runWithTools(options) {
    const maxSteps = options.maxSteps ?? 5;
    const bridge = options.mcpBridge ?? this.mcp;
    const currentMessages = [...options.messages];
    const steps = [];
    const startCost = this.getMetrics().estimatedCostUsd;
    let totalTokens = 0;
    let latestResponse;
    const tools = options.tools && options.tools.length > 0 ? options.tools : bridge.getTools();
    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      if (options.signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      const stepStart = Date.now();
      const req = {
        ...options,
        messages: currentMessages,
        stream: false,
        tools: tools.length > 0 ? tools : void 0
      };
      const response = await this.chat.completions.create(
        req
      );
      latestResponse = response;
      const promptTokens = response.usage?.promptTokens || 0;
      const completionTokens = response.usage?.completionTokens || 0;
      const stepTokens = response.usage?.totalTokens || promptTokens + completionTokens;
      totalTokens += stepTokens;
      const choice = response.choices?.[0];
      const toolCalls = choice?.message?.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (choice?.message) {
          currentMessages.push(choice.message);
        }
        break;
      }
      currentMessages.push(choice.message);
      const toolResults = await bridge.executeToolCalls(toolCalls, {
        signal: options.signal,
        user: options.user,
        timeoutMs: options.toolTimeoutMs
      });
      for (const tr of toolResults) {
        currentMessages.push(tr);
      }
      const durationMs = Date.now() - stepStart;
      const step = {
        stepIndex,
        assistantMessage: choice.message,
        toolCalls,
        toolResults,
        durationMs,
        usage: response.usage
      };
      steps.push(step);
      if (options.onStep) {
        await options.onStep(step);
      }
    }
    const endCost = this.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));
    return {
      response: latestResponse,
      messages: currentMessages,
      steps,
      totalSteps: steps.length,
      totalTokens,
      totalCostUsd
    };
  }
};

// src/ai-sdk/SinapsEmbeddingModel.ts
var SinapsEmbeddingModel = class {
  specificationVersion = "v1";
  provider = "sinapsai";
  modelId;
  maxEmbeddingsPerCall = 2048;
  supportsParallelCalls = true;
  client;
  settings;
  constructor(client, modelId, settings) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }
  async doEmbed(options) {
    const res = await this.client.embeddings.create({
      model: this.modelId,
      input: options.values,
      signal: options.abortSignal,
      dimensions: this.settings?.dimensions
    });
    const embeddings = res.data.map((item) => item.embedding);
    const tokens = res.usage?.promptTokens ?? 0;
    return {
      embeddings,
      usage: {
        tokens
      }
    };
  }
};

// src/ai-sdk/promptConverter.ts
function convertPromptToSinapsMessages(prompt) {
  const messages = [];
  for (const message of prompt) {
    if (message.role === "system") {
      messages.push({
        role: "system",
        content: message.content
      });
    } else if (message.role === "user") {
      const parts = [];
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({
            type: "text",
            text: part.text
          });
        } else if (part.type === "image") {
          let urlStr;
          if (part.image instanceof URL) {
            urlStr = part.image.toString();
          } else if (typeof part.image === "string") {
            urlStr = part.image;
          } else if (part.image instanceof Uint8Array || typeof Buffer !== "undefined" && Buffer.isBuffer(part.image)) {
            const base64 = typeof Buffer !== "undefined" ? Buffer.from(part.image).toString("base64") : btoa(String.fromCharCode(...part.image));
            const mimeType = part.mimeType || "image/jpeg";
            urlStr = `data:${mimeType};base64,${base64}`;
          } else {
            urlStr = String(part.image);
          }
          parts.push({
            type: "image_url",
            image_url: { url: urlStr }
          });
        }
      }
      if (parts.length === 1 && parts[0].type === "text") {
        messages.push({
          role: "user",
          content: parts[0].text
        });
      } else {
        messages.push({
          role: "user",
          content: parts
        });
      }
    } else if (message.role === "assistant") {
      let textContent = "";
      const toolCalls = [];
      for (const part of message.content) {
        if (part.type === "text") {
          textContent += part.text;
        } else if (part.type === "tool-call") {
          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: typeof part.args === "string" ? part.args : JSON.stringify(part.args)
            }
          });
        }
      }
      messages.push({
        role: "assistant",
        content: textContent.length > 0 ? textContent : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : void 0
      });
    } else if (message.role === "tool") {
      for (const part of message.content) {
        messages.push({
          role: "tool",
          tool_call_id: part.toolCallId,
          name: part.toolName,
          content: typeof part.result === "string" ? part.result : JSON.stringify(part.result)
        });
      }
    }
  }
  return messages;
}
function convertToolsAndMode(mode) {
  if (!mode) {
    return {};
  }
  if (mode.type === "regular") {
    let tools;
    if (mode.tools && mode.tools.length > 0) {
      tools = mode.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? void 0
        }
      }));
    }
    let toolChoice;
    if (mode.toolChoice) {
      if (mode.toolChoice.type === "auto") {
        toolChoice = "auto";
      } else if (mode.toolChoice.type === "none") {
        toolChoice = "none";
      } else if (mode.toolChoice.type === "required") {
        toolChoice = "required";
      } else if (mode.toolChoice.type === "tool") {
        toolChoice = {
          type: "function",
          function: { name: mode.toolChoice.toolName }
        };
      }
    }
    return { tools, toolChoice };
  }
  if (mode.type === "object-json") {
    return {
      responseFormat: {
        type: "json_object",
        json_schema: mode.schema ? {
          name: mode.name || "response",
          description: mode.description,
          schema: mode.schema
        } : void 0
      }
    };
  }
  if (mode.type === "object-tool") {
    return {
      tools: [
        {
          type: "function",
          function: {
            name: mode.tool.name,
            description: mode.tool.description,
            parameters: mode.tool.parameters ?? void 0
          }
        }
      ],
      toolChoice: {
        type: "function",
        function: { name: mode.tool.name }
      }
    };
  }
  return {};
}
function mapFinishReason(finishReason) {
  if (!finishReason) {
    return "stop";
  }
  const normalized = finishReason.toLowerCase();
  switch (normalized) {
    case "stop":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
    case "function_call":
      return "tool-calls";
    case "content_filter":
    case "safety":
      return "content-filter";
    case "error":
      return "error";
    default:
      return "other";
  }
}

// src/ai-sdk/SinapsLanguageModel.ts
var SinapsLanguageModel = class {
  specificationVersion = "v1";
  provider = "sinapsai";
  modelId;
  defaultObjectGenerationMode = "json";
  supportsImageUrls = true;
  client;
  settings;
  constructor(client, modelId, settings) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }
  async doGenerate(options) {
    const messages = convertPromptToSinapsMessages(options.prompt);
    const { tools, toolChoice, responseFormat } = convertToolsAndMode(
      options.mode
    );
    const requestPayload = {
      model: this.modelId,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools,
      toolChoice,
      responseFormat,
      fallbackModels: this.settings?.fallbackModels,
      thinkingBudget: this.settings?.thinkingBudget,
      reasoningEffort: this.settings?.reasoningEffort,
      signal: options.abortSignal
    };
    const response = await this.client.chat.completions.create(
      requestPayload
    );
    const choice = response.choices?.[0];
    const message = choice?.message;
    let toolCalls;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        toolCallType: "function",
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: tc.function.arguments
      }));
    }
    return {
      text: message?.content ?? void 0,
      toolCalls,
      finishReason: mapFinishReason(choice?.finishReason),
      usage: {
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          mode: options.mode
        }
      }
    };
  }
  async doStream(options) {
    const messages = convertPromptToSinapsMessages(options.prompt);
    const { tools, toolChoice, responseFormat } = convertToolsAndMode(
      options.mode
    );
    const requestPayload = {
      model: this.modelId,
      messages,
      stream: true,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools,
      toolChoice,
      responseFormat,
      fallbackModels: this.settings?.fallbackModels,
      thinkingBudget: this.settings?.thinkingBudget,
      reasoningEffort: this.settings?.reasoningEffort,
      signal: options.abortSignal
    };
    const client = this.client;
    const rawSettings = {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      mode: options.mode
    };
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const responseStream = await client.chat.completions.create(
            requestPayload
          );
          let promptTokens = 0;
          let completionTokens = 0;
          let finishReason = "stop";
          const activeTools = /* @__PURE__ */ new Map();
          for await (const chunk of responseStream) {
            if (chunk.usage) {
              promptTokens = chunk.usage.promptTokens || promptTokens;
              completionTokens = chunk.usage.completionTokens || completionTokens;
            }
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.delta?.reasoning_content) {
              controller.enqueue({
                type: "reasoning",
                textDelta: choice.delta.reasoning_content
              });
            }
            if (choice.delta?.content) {
              controller.enqueue({
                type: "text-delta",
                textDelta: choice.delta.content
              });
            }
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                let active = activeTools.get(idx);
                if (!active) {
                  active = {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: tc.function?.name || "",
                    args: tc.function?.arguments || ""
                  };
                  activeTools.set(idx, active);
                } else {
                  if (tc.id) active.id = tc.id;
                  if (tc.function?.name) active.name = tc.function.name;
                  if (tc.function?.arguments) {
                    active.args += tc.function.arguments;
                  }
                }
                if (!active.emittedStart && active.name) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallType: "function",
                    toolCallId: active.id,
                    toolName: active.name,
                    args: active.args
                  });
                  active.emittedStart = true;
                } else if (tc.function?.arguments) {
                  controller.enqueue({
                    type: "tool-call-delta",
                    toolCallType: "function",
                    toolCallId: active.id,
                    toolName: active.name,
                    argsTextDelta: tc.function.arguments
                  });
                }
              }
            }
            if (choice.finishReason) {
              finishReason = mapFinishReason(choice.finishReason);
            }
          }
          controller.enqueue({
            type: "finish",
            finishReason,
            usage: {
              promptTokens,
              completionTokens
            }
          });
          controller.close();
        } catch (error) {
          controller.enqueue({
            type: "error",
            error
          });
          controller.close();
        }
      }
    });
    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings
      }
    };
  }
};

// src/ai-sdk/index.ts
function createSinapsAI(clientOrOptions) {
  if (!clientOrOptions) {
    throw new Error(
      "createSinapsAI requires a SinapsClient instance or SinapsClientOptions with at least one configured provider."
    );
  }
  const client = clientOrOptions instanceof SinapsClient ? clientOrOptions : new SinapsClient(clientOrOptions);
  const createLanguageModel = (modelId, settings) => new SinapsLanguageModel(client, modelId, settings);
  const createEmbeddingModel = (modelId, settings) => new SinapsEmbeddingModel(client, modelId, settings);
  const provider = ((modelId, settings) => createLanguageModel(modelId, settings));
  provider.languageModel = createLanguageModel;
  provider.chat = createLanguageModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.embedding = createEmbeddingModel;
  Object.defineProperty(provider, "client", {
    get() {
      return client;
    },
    enumerable: true
  });
  return provider;
}
var sinapsai = createSinapsAI;

// src/core/BudgetGuardrails.ts
var BudgetExceededError2 = class extends Error {
  alert;
  constructor(message, alert) {
    super(message);
    this.name = "BudgetExceededError";
    this.alert = alert;
  }
};
var BudgetGuardrails = class {
  options;
  constructor(options = {}) {
    this.options = {
      ...options,
      enabled: options.enabled ?? true,
      warningThresholdRatio: options.warningThresholdRatio ?? 0.8,
      action: options.action ?? "block"
    };
  }
  /**
   * Evaluates current gateway telemetry metrics against configured budget limits.
   * Throws BudgetExceededError if action is 'block' and hard limits are reached.
   */
  evaluate(metrics) {
    if (!this.options.enabled) return [];
    const alerts = [];
    const now = Date.now();
    if (this.options.maxCostUsd !== void 0 && this.options.maxCostUsd > 0) {
      const currentCost = metrics.estimatedCostUsd;
      const limitCost = this.options.maxCostUsd;
      const ratio = currentCost / limitCost;
      const percentage = Math.round(ratio * 1e3) / 10;
      if (currentCost >= limitCost) {
        const alert = {
          type: "cost_exceeded",
          currentValue: currentCost,
          limitValue: limitCost,
          percentage,
          timestamp: now
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
        if (this.options.action === "block") {
          throw new BudgetExceededError2(
            `SinapsAI Budget Guardrail: Cumulative cost ($${currentCost.toFixed(4)} USD) exceeded limit ($${limitCost.toFixed(4)} USD).`,
            alert
          );
        }
      } else if (ratio >= this.options.warningThresholdRatio) {
        const alert = {
          type: "cost_warning",
          currentValue: currentCost,
          limitValue: limitCost,
          percentage,
          timestamp: now
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
      }
    }
    if (this.options.maxTotalTokens !== void 0 && this.options.maxTotalTokens > 0) {
      const currentTokens = metrics.totalTokens;
      const limitTokens = this.options.maxTotalTokens;
      const ratio = currentTokens / limitTokens;
      const percentage = Math.round(ratio * 1e3) / 10;
      if (currentTokens >= limitTokens) {
        const alert = {
          type: "token_exceeded",
          currentValue: currentTokens,
          limitValue: limitTokens,
          percentage,
          timestamp: now
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
        if (this.options.action === "block") {
          throw new BudgetExceededError2(
            `SinapsAI Budget Guardrail: Total token usage (${currentTokens}) exceeded limit (${limitTokens}).`,
            alert
          );
        }
      } else if (ratio >= this.options.warningThresholdRatio) {
        const alert = {
          type: "token_warning",
          currentValue: currentTokens,
          limitValue: limitTokens,
          percentage,
          timestamp: now
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
      }
    }
    return alerts;
  }
};

// src/core/CloudflareKVStorage.ts
var CloudflareKVStorage = class {
  kv;
  prefix;
  constructor(kv, options) {
    this.kv = kv;
    this.prefix = options?.prefix ?? "sinaps:";
  }
  key(k) {
    return `${this.prefix}${k}`;
  }
  async get(key) {
    const raw = await this.kv.get(this.key(key), { type: "text" });
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async set(key, value, ttlSeconds) {
    const serialized = JSON.stringify(value);
    const options = {};
    if (ttlSeconds && ttlSeconds > 0) {
      options.expirationTtl = Math.max(60, ttlSeconds);
    }
    await this.kv.put(this.key(key), serialized, options);
  }
  async delete(key) {
    await this.kv.delete(this.key(key));
  }
  async increment(key) {
    const prefixedKey = this.key(key);
    const raw = await this.kv.get(prefixedKey, { type: "text" });
    let current = 0;
    if (raw !== null) {
      try {
        current = JSON.parse(raw);
      } catch {
        current = 0;
      }
    }
    const newValue = current + 1;
    await this.kv.put(prefixedKey, JSON.stringify(newValue));
    return newValue;
  }
  async clear() {
    let cursor;
    let complete = false;
    while (!complete) {
      const result = await this.kv.list({
        prefix: this.prefix,
        limit: 1e3,
        cursor
      });
      await Promise.all(result.keys.map((k) => this.kv.delete(k.name)));
      complete = result.list_complete;
      cursor = result.cursor;
    }
  }
};

// src/core/D1Storage.ts
var D1Storage = class {
  db;
  tableName;
  migrated = false;
  autoMigrate;
  constructor(db, options) {
    this.db = db;
    this.tableName = options?.tableName ?? "sinaps_state";
    this.autoMigrate = options?.autoMigrate ?? true;
  }
  async ensureTable() {
    if (this.migrated || !this.autoMigrate) return;
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )
    `);
    this.migrated = true;
  }
  async get(key) {
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1e3);
    const row = await this.db.prepare(
      `SELECT value FROM ${this.tableName} WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`
    ).bind(key, now).first();
    if (!row) return null;
    const rawValue = typeof row === "string" ? row : row.value;
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue);
    } catch {
      return null;
    }
  }
  async set(key, value, ttlSeconds) {
    await this.ensureTable();
    const serialized = JSON.stringify(value);
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Math.floor(Date.now() / 1e3) + ttlSeconds : null;
    await this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, ?)`
    ).bind(key, serialized, expiresAt).run();
  }
  async delete(key) {
    await this.ensureTable();
    await this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?`).bind(key).run();
  }
  async increment(key) {
    await this.ensureTable();
    const current = await this.get(key);
    const newValue = (current ?? 0) + 1;
    await this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, (SELECT expires_at FROM ${this.tableName} WHERE key = ?))`
    ).bind(key, JSON.stringify(newValue), key).run();
    return newValue;
  }
  async clear() {
    await this.ensureTable();
    await this.db.prepare(`DELETE FROM ${this.tableName}`).run();
  }
  /**
   * Removes expired entries. Call periodically via scheduled handler
   * or Cron Trigger to keep the table lean.
   */
  async purgeExpired() {
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1e3);
    await this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`
    ).bind(now).run();
  }
};

// src/core/RedisStorage.ts
var RedisStorage = class {
  redis;
  prefix;
  constructor(redis, options) {
    this.redis = redis;
    this.prefix = options?.prefix ?? "sinaps:";
  }
  key(k) {
    return `${this.prefix}${k}`;
  }
  async get(key) {
    const raw = await this.redis.get(this.key(key));
    if (raw === null || raw === void 0) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async set(key, value, ttlSeconds) {
    const prefixedKey = this.key(key);
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(prefixedKey, serialized, "EX", ttlSeconds);
    } else {
      await this.redis.set(prefixedKey, serialized);
    }
  }
  async delete(key) {
    await this.redis.del(this.key(key));
  }
  async increment(key) {
    return this.redis.incr(this.key(key));
  }
  async clear() {
    if (typeof this.redis.scan === "function") {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.prefix}*`,
          "COUNT",
          100
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(keys);
        }
      } while (cursor !== "0");
    } else if (typeof this.redis.keys === "function") {
      const keys = await this.redis.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        for (const key of keys) {
          await this.redis.del(key);
        }
      }
    }
  }
};

// src/utils/rateLimit.ts
function parseDurationMs(durationStr) {
  const trimmed = durationStr.trim();
  if (!trimmed) return void 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number.parseFloat(trimmed);
    return Number.isNaN(val) ? void 0 : Math.round(val * 1e3);
  }
  let totalMs = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    matched = true;
    const value = Number.parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case "ms":
        totalMs += value;
        break;
      case "s":
        totalMs += value * 1e3;
        break;
      case "m":
        totalMs += value * 60 * 1e3;
        break;
      case "h":
        totalMs += value * 3600 * 1e3;
        break;
      case "d":
        totalMs += value * 86400 * 1e3;
        break;
    }
  }
  return matched ? Math.round(totalMs) : void 0;
}
function parseRateLimitHeaders(headers) {
  if (!headers) return void 0;
  const reqStr = headers.get("x-ratelimit-remaining-requests") || headers.get("anthropic-ratelimit-requests-remaining") || headers.get("ratelimit-remaining");
  const tokStr = headers.get("x-ratelimit-remaining-tokens") || headers.get("anthropic-ratelimit-tokens-remaining");
  const retryAfter = headers.get("retry-after");
  let remainingRequests;
  if (reqStr !== null && reqStr !== void 0) {
    const parsed = Number.parseInt(reqStr, 10);
    if (!Number.isNaN(parsed)) remainingRequests = parsed;
  }
  let remainingTokens;
  if (tokStr !== null && tokStr !== void 0) {
    const parsed = Number.parseInt(tokStr, 10);
    if (!Number.isNaN(parsed)) remainingTokens = parsed;
  }
  let resetMs;
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter.trim())) {
      const parsedSec = Number.parseFloat(retryAfter);
      if (!Number.isNaN(parsedSec)) {
        resetMs = Math.round(parsedSec * 1e3);
      }
    } else {
      const retryDateMs = Date.parse(retryAfter);
      if (!Number.isNaN(retryDateMs)) {
        resetMs = Math.max(0, retryDateMs - Date.now());
      }
    }
  } else {
    const resetTokensHeader = headers.get("x-ratelimit-reset-tokens");
    const resetRequestsHeader = headers.get("x-ratelimit-reset-requests");
    if (resetTokensHeader) {
      resetMs = parseDurationMs(resetTokensHeader);
    } else if (resetRequestsHeader) {
      resetMs = parseDurationMs(resetRequestsHeader);
    }
  }
  if (remainingRequests === void 0 && remainingTokens === void 0 && resetMs === void 0) {
    return void 0;
  }
  return {
    remainingRequests,
    remainingTokens,
    resetMs
  };
}

// src/utils/signal.ts
function linkAbortSignal(target, source) {
  if (!source) return void 0;
  if (source.aborted) {
    target.abort();
    return void 0;
  }
  const onAbort = () => {
    target.abort();
  };
  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
}

// src/providers/AnthropicProvider.ts
init_stream();
var AnthropicProvider = class {
  id;
  name = "Anthropic";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `anthropic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  formatRequest(request) {
    const payload = {
      model: this.resolveModel(request.model),
      max_tokens: request.maxTokens || 4096,
      messages: []
    };
    if (request.thinkingBudget !== void 0 && request.thinkingBudget > 0) {
      payload.thinking = {
        type: "enabled",
        budget_tokens: request.thinkingBudget
      };
      if (!request.maxTokens || request.maxTokens <= request.thinkingBudget) {
        payload.max_tokens = request.thinkingBudget + 4096;
      }
      payload.temperature = 1;
    } else if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    const systemMessages = [];
    const formatAnthropicContent = (content) => {
      if (content === null || content === void 0) return "";
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map((part) => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          }
          if (part.type === "image_url") {
            const url = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2]
                }
              };
            }
            return {
              type: "image",
              source: {
                type: "url",
                url
              }
            };
          }
          return { type: "text", text: JSON.stringify(part) };
        });
      }
      return "";
    };
    for (const msg of request.messages) {
      if (msg.role === "system") {
        if (typeof msg.content === "string") {
          systemMessages.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          const sysText = msg.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
          if (sysText) systemMessages.push(sysText);
        }
      } else if (msg.role === "tool") {
        const toolContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
        const toolResultBlock = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: toolContent
        };
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(toolResultBlock);
        } else {
          payload.messages.push({
            role: "user",
            content: [toolResultBlock]
          });
        }
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const contentBlocks = [];
        if (typeof msg.content === "string" && msg.content) {
          contentBlocks.push({ type: "text", text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              contentBlocks.push({ type: "text", text: part.text });
            }
          }
        }
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input
          });
        }
        payload.messages.push({
          role: "assistant",
          content: contentBlocks
        });
      } else {
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (lastMsg && lastMsg.role === msg.role && typeof lastMsg.content === "string" && typeof msg.content === "string") {
          lastMsg.content += `

${msg.content}`;
        } else {
          payload.messages.push({
            role: msg.role,
            content: formatAnthropicContent(msg.content)
          });
        }
      }
    }
    if (request.responseFormat?.type === "json_object") {
      systemMessages.push(
        "Respond strictly with a valid JSON object without markdown wrappers."
      );
    } else if (request.responseFormat?.type === "json_schema" && request.responseFormat.json_schema) {
      systemMessages.push(
        `Respond strictly with valid JSON matching this schema:
${JSON.stringify(request.responseFormat.json_schema.schema)}`
      );
    }
    if (systemMessages.length > 0) {
      const systemText = systemMessages.join("\n");
      const shouldCache = this.config.promptCaching === true || this.config.promptCaching !== false && systemText.length >= 2048;
      if (shouldCache) {
        payload.system = [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral" }
          }
        ];
      } else {
        payload.system = systemText;
      }
    }
    if (request.tools && request.toolChoice !== "none") {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object" }
      }));
    }
    if (request.toolChoice && request.toolChoice !== "none") {
      if (request.toolChoice === "auto") {
        payload.tool_choice = { type: "auto" };
      } else if (request.toolChoice === "required") {
        payload.tool_choice = { type: "any" };
      } else if (typeof request.toolChoice === "object") {
        payload.tool_choice = {
          type: "tool",
          name: request.toolChoice.function.name
        };
      }
    }
    if (request.stream) {
      payload.stream = true;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    let text = "";
    let reasoningContent = "";
    const toolCalls = [];
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "thinking") {
          reasoningContent += block.thinking;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          });
        }
      }
    }
    let finishReason = "stop";
    if (data.stop_reason) {
      switch (data.stop_reason) {
        case "tool_use":
          finishReason = "tool_calls";
          break;
        case "max_tokens":
          finishReason = "length";
          break;
        case "end_turn":
        case "stop_sequence":
          finishReason = "stop";
          break;
        default:
          finishReason = data.stop_reason;
      }
    }
    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: text || null,
            reasoning_content: reasoningContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : void 0
          },
          finishReason
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        cachedPromptTokens: data.usage.cache_read_input_tokens || void 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.anthropic.com/v1";
    const url = `${baseUrl}/messages`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey || "",
      "anthropic-version": "2023-06-01"
    };
    if (this.config.promptCaching || Array.isArray(payload.system)) {
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Anthropic API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          let messageId = `anthropic-${Date.now()}`;
          let promptTokens = 0;
          let cachedPromptTokens;
          try {
            for await (const msg of parseSSE(response)) {
              if (msg.event === "message_start") {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.message?.id) messageId = parsed.message.id;
                  if (parsed.message?.usage) {
                    promptTokens = parsed.message.usage.input_tokens || 0;
                    cachedPromptTokens = parsed.message.usage.cache_read_input_tokens || void 0;
                  }
                } catch (_e) {
                }
              } else if (msg.event === "content_block_start") {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.content_block?.type === "tool_use") {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: "assistant",
                            tool_calls: [
                              {
                                index: parsed.index,
                                id: parsed.content_block.id,
                                type: "function",
                                function: {
                                  name: parsed.content_block.name,
                                  arguments: ""
                                }
                              }
                            ]
                          },
                          finishReason: null
                        }
                      ]
                    };
                  }
                } catch (_e) {
                }
              } else if (msg.event === "content_block_delta") {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.delta?.type === "text_delta") {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: "assistant",
                            content: parsed.delta.text || ""
                          },
                          finishReason: null
                        }
                      ]
                    };
                  } else if (parsed.delta?.type === "thinking_delta") {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: "assistant",
                            reasoning_content: parsed.delta.thinking || ""
                          },
                          finishReason: null
                        }
                      ]
                    };
                  } else if (parsed.delta?.type === "input_json_delta") {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: "assistant",
                            tool_calls: [
                              {
                                index: parsed.index,
                                function: {
                                  arguments: parsed.delta.partial_json || ""
                                }
                              }
                            ]
                          },
                          finishReason: null
                        }
                      ]
                    };
                  }
                } catch (_e) {
                }
              } else if (msg.event === "message_delta") {
                try {
                  const parsed = JSON.parse(msg.data);
                  const completionTokens = parsed.usage?.output_tokens || 0;
                  const chunkUsage = promptTokens || completionTokens ? {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    cachedPromptTokens
                  } : void 0;
                  if (parsed.delta?.stop_reason) {
                    let finishReason = "stop";
                    switch (parsed.delta.stop_reason) {
                      case "tool_use":
                        finishReason = "tool_calls";
                        break;
                      case "max_tokens":
                        finishReason = "length";
                        break;
                      case "end_turn":
                      case "stop_sequence":
                        finishReason = "stop";
                        break;
                      default:
                        finishReason = parsed.delta.stop_reason;
                    }
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {},
                          finishReason
                        }
                      ],
                      usage: chunkUsage
                    };
                  }
                } catch (_e) {
                }
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
};

// src/providers/CohereProvider.ts
init_stream();
var COHERE_MODELS = {
  COMMAND_A: "command-a-03-2025",
  COMMAND_R_PLUS: "command-r-plus-08-2024",
  COMMAND_R: "command-r-08-2024",
  COMMAND_R7B: "command-r7b-12-2024",
  EMBED_V4: "embed-v4.0",
  EMBED_MULTILINGUAL_V3: "embed-multilingual-v3.0",
  EMBED_ENGLISH_V3: "embed-english-v3.0"
};
var CohereProvider = class {
  id;
  name = "Cohere";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `cohere-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === "default") {
      return COHERE_MODELS.COMMAND_A;
    }
    return model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      let content = m.content;
      if (Array.isArray(m.content)) {
        content = m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      }
      const msg = {
        role: m.role,
        content: content ?? ""
      };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.tools && request.toolChoice !== "none") {
      payload.tools = request.tools;
    }
    if (request.toolChoice === "required") {
      payload.tool_choice = "REQUIRED";
    } else if (request.toolChoice === "none") {
      payload.tool_choice = "NONE";
    }
    if (request.responseFormat) {
      if (request.responseFormat.type === "json_object") {
        payload.response_format = { type: "json_object" };
      } else if (request.responseFormat.type === "json_schema" && request.responseFormat.json_schema) {
        payload.response_format = {
          type: "json_object",
          json_schema: request.responseFormat.json_schema.schema
        };
      }
    }
    if (request.stream) {
      payload.stream = true;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: cohere v2 response
  formatResponse(data, requestedModel) {
    let textContent = "";
    let reasoningContent = "";
    if (Array.isArray(data.message?.content)) {
      for (const block of data.message.content) {
        if (block.type === "text") {
          textContent += block.text || "";
        } else if (block.type === "thinking") {
          reasoningContent += block.thinking || "";
        }
      }
    } else if (typeof data.message?.content === "string") {
      textContent = data.message.content;
    } else if (typeof data.text === "string") {
      textContent = data.text;
    }
    const toolCalls = data.message?.tool_calls?.map(
      // biome-ignore lint/suspicious/noExplicitAny: tool call item
      (tc) => ({
        id: tc.id || `call_${Date.now()}`,
        type: "function",
        function: {
          name: tc.function?.name || "",
          arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
        }
      })
    );
    let finishReason = "stop";
    if (toolCalls && toolCalls.length > 0) {
      finishReason = "tool_calls";
    } else if (data.finish_reason) {
      switch (data.finish_reason) {
        case "MAX_TOKENS":
          finishReason = "length";
          break;
        case "TOOL_CALL":
          finishReason = "tool_calls";
          break;
        case "COMPLETE":
        case "STOP_SEQUENCE":
          finishReason = "stop";
          break;
        default:
          finishReason = String(data.finish_reason).toLowerCase();
      }
    }
    const promptTokens = data.usage?.tokens?.input_tokens ?? data.usage?.billed_units?.input_tokens ?? 0;
    const completionTokens = data.usage?.tokens?.output_tokens ?? data.usage?.billed_units?.output_tokens ?? 0;
    return {
      id: data.id || `cohere-${Date.now()}`,
      model: data.model || this.resolveModel(requestedModel),
      choices: [
        {
          message: {
            role: "assistant",
            content: textContent || null,
            reasoning_content: reasoningContent || null,
            tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : void 0
          },
          finishReason
        }
      ],
      usage: data.usage ? {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.cohere.com/v2";
    const url = `${baseUrl}/chat`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey || ""}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Cohere API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          let streamId = `cohere-${Date.now()}`;
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const eventType = msg.event || parsed.type;
                if (eventType === "message-start") {
                  if (parsed.id) streamId = parsed.id;
                } else if (eventType === "content-delta") {
                  const textDelta = parsed.delta?.message?.content?.text ?? parsed.delta?.text ?? "";
                  const thinkingDelta = parsed.delta?.message?.content?.thinking ?? "";
                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {
                          role: "assistant",
                          content: textDelta || void 0,
                          reasoning_content: thinkingDelta || void 0
                        },
                        finishReason: null
                      }
                    ]
                  };
                } else if (eventType === "tool-call-start") {
                  const tc = parsed.delta?.message?.tool_calls;
                  if (tc) {
                    yield {
                      id: streamId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: "assistant",
                            tool_calls: [
                              {
                                index: parsed.index ?? 0,
                                id: tc.id,
                                type: "function",
                                function: {
                                  name: tc.function?.name || "",
                                  arguments: tc.function?.arguments || ""
                                }
                              }
                            ]
                          },
                          finishReason: null
                        }
                      ]
                    };
                  }
                } else if (eventType === "tool-call-delta") {
                  const argDelta = parsed.delta?.message?.tool_calls?.function?.arguments || "";
                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {
                          role: "assistant",
                          tool_calls: [
                            {
                              index: parsed.index ?? 0,
                              function: {
                                arguments: argDelta
                              }
                            }
                          ]
                        },
                        finishReason: null
                      }
                    ]
                  };
                } else if (eventType === "message-end") {
                  const rawReason = parsed.delta?.finish_reason;
                  let finishReason = "stop";
                  if (rawReason === "TOOL_CALL") finishReason = "tool_calls";
                  else if (rawReason === "MAX_TOKENS") finishReason = "length";
                  const inTok = parsed.delta?.usage?.tokens?.input_tokens ?? parsed.delta?.usage?.billed_units?.input_tokens ?? 0;
                  const outTok = parsed.delta?.usage?.tokens?.output_tokens ?? parsed.delta?.usage?.billed_units?.output_tokens ?? 0;
                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {},
                        finishReason
                      }
                    ],
                    usage: inTok || outTok ? {
                      promptTokens: inTok,
                      completionTokens: outTok,
                      totalTokens: inTok + outTok
                    } : void 0
                  };
                }
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data, request.model);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const baseUrl = this.config.baseUrl || "https://api.cohere.com/v2";
    const url = `${baseUrl}/embed`;
    const texts = Array.isArray(request.input) ? request.input : [request.input];
    const targetModel = request.model && request.model !== "default" ? request.model : COHERE_MODELS.EMBED_V4;
    const payload = {
      model: targetModel,
      texts,
      input_type: "search_document",
      embedding_types: ["float"]
    };
    if (request.dimensions) {
      payload.output_dimension = request.dimensions;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey || ""}`
      },
      body: JSON.stringify(payload),
      signal: request.signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Cohere Embedding API Error (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    const floatVectors = data.embeddings?.float || data.embeddings || [];
    const inputTokens = data.meta?.billed_units?.input_tokens ?? data.usage?.tokens?.input_tokens ?? 0;
    return {
      object: "list",
      data: floatVectors.map((vec, index) => ({
        index,
        embedding: vec,
        object: "embedding"
      })),
      model: targetModel,
      usage: {
        promptTokens: inputTokens,
        totalTokens: inputTokens
      }
    };
  }
};

// src/providers/DeepSeekProvider.ts
var DeepSeekProvider = class {
  id;
  name = "DeepSeek";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `deepseek-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const choice = data.choices?.[0];
    const cachedPromptTokens = data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens ?? void 0;
    return {
      id: data.id || `deepseek-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: choice?.message?.reasoning_content ?? null,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.deepseek.com";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `DeepSeek API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                const cachedPromptTokens = parsed.usage?.prompt_cache_hit_tokens ?? parsed.usage?.prompt_tokens_details?.cached_tokens ?? void 0;
                yield {
                  id: parsed.id || `deepseek-${Date.now()}`,
                  model: parsed.model,
                  choices: chunk ? [
                    {
                      delta: {
                        role: chunk.delta?.role,
                        content: chunk.delta?.content,
                        reasoning_content: chunk.delta?.reasoning_content,
                        tool_calls: chunk.delta?.tool_calls
                      },
                      finishReason: chunk.finish_reason || null
                    }
                  ] : [],
                  usage: parsed.usage ? {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens
                  } : void 0
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
};

// src/providers/GeminiProvider.ts
init_stream();
var GEMINI_MODELS = {
  PRO_4: "gemini-4-pro",
  FLASH_4: "gemini-4-flash",
  PROJECT_ASTRA: "gemini-4-flash",
  FLASH_3_8: "gemini-3.8-flash",
  FLASH_3_6: "gemini-3.6-flash",
  FLASH_LITE_3_5: "gemini-3.5-flash-lite",
  PRO_3_1_PREVIEW: "gemini-3.1-pro-preview",
  FLASH_2_5: "gemini-2.5-flash",
  FLASH_LITE_2_5: "gemini-2.5-flash-lite",
  PRO_2_5: "gemini-2.5-pro",
  FLASH_2_0: "gemini-2.0-flash",
  FLASH_2_0_LITE: "gemini-2.0-flash-lite",
  FLASH_THINKING_2_0: "gemini-2.0-flash-thinking-exp",
  PRO_2_0: "gemini-2.0-pro-exp",
  FLASH_LATEST: "gemini-flash-latest",
  PRO_LATEST: "gemini-pro-latest",
  EMBEDDING_001: "gemini-embedding-001",
  EMBEDDING_2: "gemini-embedding-2",
  TEXT_EMBEDDING_004: "text-embedding-004"
};
var GEMINI_DEFAULT_PRICING = {
  "gemini-4-pro": { promptCostPer1k: 125e-5, completionCostPer1k: 5e-3 },
  "gemini-4-flash": { promptCostPer1k: 75e-6, completionCostPer1k: 3e-4 },
  "gemini-3.8-flash": {
    promptCostPer1k: 75e-6,
    completionCostPer1k: 3e-4
  },
  "gemini-3.6-flash": {
    promptCostPer1k: 75e-6,
    completionCostPer1k: 3e-4
  },
  "gemini-3.5-flash-lite": {
    promptCostPer1k: 375e-7,
    completionCostPer1k: 15e-5
  },
  "gemini-3.1-pro-preview": {
    promptCostPer1k: 125e-5,
    completionCostPer1k: 5e-3
  },
  "gemini-2.5-pro": { promptCostPer1k: 125e-5, completionCostPer1k: 5e-3 },
  "gemini-2.5-flash": {
    promptCostPer1k: 75e-6,
    completionCostPer1k: 3e-4
  },
  "gemini-2.5-flash-lite": {
    promptCostPer1k: 375e-7,
    completionCostPer1k: 15e-5
  },
  "gemini-2.0-flash": { promptCostPer1k: 1e-4, completionCostPer1k: 4e-4 },
  "gemini-2.0-flash-lite": {
    promptCostPer1k: 75e-6,
    completionCostPer1k: 3e-4
  },
  "gemini-2.0-pro-exp": {
    promptCostPer1k: 125e-5,
    completionCostPer1k: 5e-3
  },
  "gemini-flash-latest": {
    promptCostPer1k: 75e-6,
    completionCostPer1k: 3e-4
  },
  "gemini-pro-latest": { promptCostPer1k: 125e-5, completionCostPer1k: 5e-3 },
  "text-embedding-004": { promptCostPer1k: 1e-5, completionCostPer1k: 0 },
  "gemini-embedding-001": { promptCostPer1k: 1e-5, completionCostPer1k: 0 },
  "gemini-embedding-2": { promptCostPer1k: 1e-5, completionCostPer1k: 0 }
};
var GeminiProvider = class {
  id;
  name = "Gemini";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    if (this.config.promptCostPer1k !== void 0) {
      return this.config.promptCostPer1k;
    }
    const model = this.resolveModel(this.defaultModel || "default");
    return GEMINI_DEFAULT_PRICING[model]?.promptCostPer1k;
  }
  get completionCostPer1k() {
    if (this.config.completionCostPer1k !== void 0) {
      return this.config.completionCostPer1k;
    }
    const model = this.resolveModel(this.defaultModel || "default");
    return GEMINI_DEFAULT_PRICING[model]?.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === "default") {
      return GEMINI_MODELS.FLASH_2_5;
    }
    return model;
  }
  formatRequest(request) {
    const contents = [];
    const systemParts = [];
    const toolCallIdToName = /* @__PURE__ */ new Map();
    for (const m of request.messages) {
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallIdToName.set(tc.id, tc.function.name);
          }
        }
      }
    }
    const formatGeminiParts = (content) => {
      if (content === null || content === void 0) {
        return [{ text: "" }];
      }
      if (typeof content === "string") {
        return [{ text: content }];
      }
      if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
          } else if (part.type === "image_url") {
            const url = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            } else {
              let mimeType = "image/jpeg";
              if (url.endsWith(".png")) mimeType = "image/png";
              else if (url.endsWith(".webp")) mimeType = "image/webp";
              else if (url.endsWith(".gif")) mimeType = "image/gif";
              else if (url.endsWith(".svg")) mimeType = "image/svg+xml";
              else if (url.endsWith(".pdf")) mimeType = "application/pdf";
              else if (url.endsWith(".mp4")) mimeType = "video/mp4";
              else if (url.endsWith(".webm")) mimeType = "video/webm";
              else if (url.endsWith(".mp3")) mimeType = "audio/mp3";
              else if (url.endsWith(".wav")) mimeType = "audio/wav";
              parts.push({
                fileData: {
                  mimeType,
                  fileUri: url
                }
              });
            }
          } else if (part.type === "input_audio") {
            parts.push({
              inlineData: {
                mimeType: `audio/${part.input_audio.format || "wav"}`,
                data: part.input_audio.data
              }
            });
          }
        }
        return parts.length > 0 ? parts : [{ text: "" }];
      }
      return [{ text: "" }];
    };
    for (const msg of request.messages) {
      if (msg.role === "system") {
        if (typeof msg.content === "string") {
          systemParts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const p of msg.content) {
            if (p.type === "text") {
              systemParts.push({ text: p.text });
            }
          }
        }
      } else if (msg.role === "tool") {
        const responseContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
        const resolvedName = msg.name || (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : void 0) || "function";
        const functionResponsePart = {
          functionResponse: {
            name: resolvedName,
            response: { content: responseContent }
          }
        };
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === "user") {
          lastContent.parts.push(functionResponsePart);
        } else {
          contents.push({
            role: "user",
            parts: [functionResponsePart]
          });
        }
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts = [];
        if (typeof msg.content === "string" && msg.content) {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const p of msg.content) {
            if (p.type === "text") {
              parts.push({ text: p.text });
            }
          }
        }
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args
            }
          });
        }
        contents.push({
          role: "model",
          parts
        });
      } else {
        const geminiRole = msg.role === "assistant" ? "model" : "user";
        const msgParts = formatGeminiParts(msg.content);
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === geminiRole) {
          lastContent.parts.push(...msgParts);
        } else {
          contents.push({
            role: geminiRole,
            parts: msgParts
          });
        }
      }
    }
    const generationConfig = {};
    if (request.temperature !== void 0) {
      generationConfig.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.responseFormat?.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    } else if (request.responseFormat?.type === "json_schema" && request.responseFormat.json_schema) {
      generationConfig.responseMimeType = "application/json";
      const cleanSchema = { ...request.responseFormat.json_schema.schema };
      delete cleanSchema.additionalProperties;
      generationConfig.responseSchema = cleanSchema;
    }
    let thinkingBudget = request.thinkingBudget ?? this.config.thinkingBudget;
    if (thinkingBudget === void 0 && request.reasoningEffort) {
      if (request.reasoningEffort === "low") {
        thinkingBudget = 2048;
      } else if (request.reasoningEffort === "medium") {
        thinkingBudget = 8192;
      } else if (request.reasoningEffort === "high") {
        thinkingBudget = 32768;
      }
    }
    if (thinkingBudget !== void 0) {
      generationConfig.thinkingConfig = {
        thinkingBudget
      };
    }
    const payload = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }
    if (this.config.safetySettings && this.config.safetySettings.length > 0) {
      payload.safetySettings = this.config.safetySettings;
    }
    const cachedContent = request.cachedContent ?? this.config.cachedContent;
    if (cachedContent) {
      payload.cachedContent = cachedContent;
    }
    const tools = [];
    if (request.tools && request.tools.length > 0) {
      tools.push({
        functionDeclarations: request.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      });
    }
    const useGoogleSearch = request.googleSearch ?? this.config.googleSearch;
    if (useGoogleSearch) {
      tools.push({ googleSearch: {} });
    }
    const useCodeExecution = request.codeExecution ?? this.config.codeExecution;
    if (useCodeExecution) {
      tools.push({ codeExecution: {} });
    }
    if (tools.length > 0) {
      payload.tools = tools;
    }
    if (request.toolChoice) {
      if (request.toolChoice === "auto") {
        payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      } else if (request.toolChoice === "none") {
        payload.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      } else if (request.toolChoice === "required") {
        payload.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      } else if (typeof request.toolChoice === "object") {
        payload.toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [request.toolChoice.function.name]
          }
        };
      }
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data, model) {
    const candidate = data.candidates?.[0];
    let text = "";
    let reasoningContent = "";
    const toolCalls = [];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (typeof part.thought === "string") {
          reasoningContent += part.thought;
        } else if (part.thought) {
          reasoningContent += part.text || "";
        } else if (part.text) {
          text += part.text;
        }
        if (part.executableCode) {
          const lang = (part.executableCode.language || "python").toLowerCase();
          text += `
\`\`\`${lang}
${part.executableCode.code || ""}
\`\`\`
`;
        }
        if (part.codeExecutionResult) {
          text += `
\`\`\`
[Execution Outcome: ${part.codeExecutionResult.outcome || "OK"}]
${part.codeExecutionResult.output || ""}
\`\`\`
`;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          });
        }
      }
    }
    let finishReason = "stop";
    if (toolCalls.length > 0) {
      finishReason = "tool_calls";
    } else if (candidate?.finishReason) {
      switch (candidate.finishReason) {
        case "MAX_TOKENS":
          finishReason = "length";
          break;
        case "SAFETY":
        case "RECITATION":
          finishReason = "content_filter";
          break;
        case "STOP":
          finishReason = "stop";
          break;
        default:
          finishReason = candidate.finishReason.toLowerCase();
      }
    }
    let grounding;
    if (candidate?.groundingMetadata) {
      const gm = candidate.groundingMetadata;
      const sources = [];
      if (Array.isArray(gm.groundingChunks)) {
        for (const gc of gm.groundingChunks) {
          if (gc.web) {
            sources.push({
              title: gc.web.title,
              uri: gc.web.uri
            });
          }
        }
      }
      grounding = {
        webSearchQueries: gm.webSearchQueries,
        sources: sources.length > 0 ? sources : void 0,
        searchEntryPoint: gm.searchEntryPoint?.renderedContent
      };
    }
    return {
      id: `gemini-${Date.now()}`,
      model,
      choices: [
        {
          message: {
            role: "assistant",
            content: text || null,
            reasoning_content: reasoningContent || void 0,
            tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
            grounding
          },
          finishReason
        }
      ],
      grounding,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0,
        cachedPromptTokens: data.usageMetadata.cachedContentTokenCount || void 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const action = request.stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const finalUrl = `${baseUrl}/models/${targetModel}:${action}`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey || ""
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Gemini API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          try {
            let chunkIndex = 0;
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const candidate = parsed.candidates?.[0];
                let text = "";
                let reasoning = "";
                const toolCalls = [];
                if (candidate?.content?.parts) {
                  for (const part of candidate.content.parts) {
                    if (typeof part.thought === "string") {
                      reasoning += part.thought;
                    } else if (part.thought) {
                      reasoning += part.text || "";
                    } else if (part.text) {
                      text += part.text;
                    }
                    if (part.executableCode) {
                      const lang = (part.executableCode.language || "python").toLowerCase();
                      text += `
\`\`\`${lang}
${part.executableCode.code || ""}
\`\`\`
`;
                    }
                    if (part.codeExecutionResult) {
                      text += `
\`\`\`
[Execution Outcome: ${part.codeExecutionResult.outcome || "OK"}]
${part.codeExecutionResult.output || ""}
\`\`\`
`;
                    }
                    if (part.functionCall) {
                      toolCalls.push({
                        index: chunkIndex++,
                        id: `call_${Date.now()}_${chunkIndex}`,
                        type: "function",
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(
                            part.functionCall.args || {}
                          )
                        }
                      });
                    }
                  }
                }
                let streamGrounding;
                if (candidate?.groundingMetadata) {
                  const gm = candidate.groundingMetadata;
                  const sources = [];
                  if (Array.isArray(gm.groundingChunks)) {
                    for (const gc of gm.groundingChunks) {
                      if (gc.web) {
                        sources.push({
                          title: gc.web.title,
                          uri: gc.web.uri
                        });
                      }
                    }
                  }
                  streamGrounding = {
                    webSearchQueries: gm.webSearchQueries,
                    sources: sources.length > 0 ? sources : void 0,
                    searchEntryPoint: gm.searchEntryPoint?.renderedContent
                  };
                }
                const usage = parsed.usageMetadata ? {
                  promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                  completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                  totalTokens: parsed.usageMetadata.totalTokenCount || 0,
                  cachedPromptTokens: parsed.usageMetadata.cachedContentTokenCount || void 0
                } : void 0;
                yield {
                  id: `gemini-${Date.now()}`,
                  model: targetModel,
                  choices: [
                    {
                      delta: {
                        role: "assistant",
                        content: text || void 0,
                        reasoning_content: reasoning || void 0,
                        tool_calls: toolCalls.length > 0 ? toolCalls : void 0
                      },
                      finishReason: toolCalls.length > 0 ? "tool_calls" : candidate?.finishReason ? candidate.finishReason.toLowerCase() : null
                    }
                  ],
                  usage,
                  grounding: streamGrounding
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data, targetModel);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const targetModel = request.model && request.model !== "default" ? request.model : GEMINI_MODELS.EMBEDDING_001;
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const isBatch = Array.isArray(request.input);
    const endpoint = isBatch ? "batchEmbedContents" : "embedContent";
    const keyParam = this.config.apiKey ? `?key=${this.config.apiKey}` : "";
    const url = `${baseUrl}/models/${targetModel}:${endpoint}${keyParam}`;
    let bodyPayload;
    if (isBatch) {
      bodyPayload = {
        requests: request.input.map((text) => {
          const item = {
            model: `models/${targetModel}`,
            content: { parts: [{ text }] }
          };
          if (request.dimensions) {
            item.outputDimensionality = request.dimensions;
          }
          return item;
        })
      };
    } else {
      bodyPayload = {
        content: { parts: [{ text: request.input }] }
      };
      if (request.dimensions) {
        bodyPayload.outputDimensionality = request.dimensions;
      }
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.config.apiKey || ""
      },
      body: JSON.stringify(bodyPayload),
      signal: request.signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Gemini Embedding API Error (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    const embeddingsList = isBatch ? (data.embeddings || []).map(
      // biome-ignore lint/suspicious/noExplicitAny: embedding item
      (e, idx) => ({
        index: idx,
        embedding: e.values || [],
        object: "embedding"
      })
    ) : [
      {
        index: 0,
        embedding: data.embedding?.values || [],
        object: "embedding"
      }
    ];
    return {
      object: "list",
      data: embeddingsList,
      model: targetModel,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0
      } : void 0
    };
  }
  static async fetchAvailableModels(options) {
    const baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        "x-goog-api-key": options.apiKey
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Gemini models (${response.status})`);
    }
    const data = await response.json();
    return (data.models || []).map((m) => ({
      id: (m.name || "").replace(/^models\//, ""),
      displayName: m.displayName || m.name,
      description: m.description,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      supportedGenerationMethods: m.supportedGenerationMethods || []
    }));
  }
  /**
   * Creates a context cache resource on Google Gemini API for long contexts (>32,768 tokens),
   * providing up to 75%-90% cost reduction and lower latency.
   */
  async createCachedContent(options) {
    const targetModel = this.resolveModel(options.model);
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    let contents = options.contents;
    if (!contents && options.messages) {
      const formatted = this.formatRequest({
        model: targetModel,
        messages: options.messages
      });
      contents = formatted.contents;
    }
    const body = {
      model: `models/${targetModel}`,
      contents: contents || [],
      ttl: options.ttl || "3600s"
    };
    if (options.displayName) {
      body.displayName = options.displayName;
    }
    if (options.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }]
      };
    }
    const response = await fetch(`${baseUrl}/cachedContents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.config.apiKey || ""
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to create Gemini CachedContent (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    return await response.json();
  }
  /**
   * Fetches metadata for an existing Gemini CachedContent.
   */
  async getCachedContent(name) {
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const resourcePath = name.startsWith("cachedContents/") ? name : `cachedContents/${name}`;
    const response = await fetch(`${baseUrl}/${resourcePath}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": this.config.apiKey || ""
      }
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to get Gemini CachedContent (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    return await response.json();
  }
  /**
   * Lists active CachedContents for the configured Gemini API key.
   */
  async listCachedContents(pageSize) {
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const query = pageSize ? `?pageSize=${pageSize}` : "";
    const response = await fetch(`${baseUrl}/cachedContents${query}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": this.config.apiKey || ""
      }
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to list Gemini CachedContents (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    return data.cachedContents || [];
  }
  /**
   * Deletes a Gemini CachedContent by name.
   */
  async deleteCachedContent(name) {
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const resourcePath = name.startsWith("cachedContents/") ? name : `cachedContents/${name}`;
    const response = await fetch(`${baseUrl}/${resourcePath}`, {
      method: "DELETE",
      headers: {
        "x-goog-api-key": this.config.apiKey || ""
      }
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to delete Gemini CachedContent (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
  }
};

// src/providers/GroqProvider.ts
var GroqProvider = class {
  id;
  name = "Groq";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `groq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === "default") {
      return "llama-3.3-70b-versatile";
    }
    return model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature === 0 ? 1e-8 : request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
      payload.max_completion_tokens = request.maxTokens;
    }
    if (request.thinkingBudget !== void 0) {
      payload.reasoning_format = "parsed";
    }
    if (request.reasoningEffort !== void 0) {
      payload.reasoning_effort = request.reasoningEffort;
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const choice = data.choices?.[0];
    let content = choice?.message?.content ?? null;
    let reasoningContent = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;
    if (!reasoningContent && typeof content === "string" && content.includes("<think>")) {
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        reasoningContent = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
      }
    }
    return {
      id: data.id || `groq-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens: data.usage.prompt_tokens_details?.cached_tokens ?? void 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.groq.com/openai/v1";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Groq API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                let chunkUsage;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? void 0
                  };
                }
                yield {
                  id: parsed.id || `groq-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content: chunk?.delta?.reasoning ?? chunk?.delta?.reasoning_content ?? null,
                        tool_calls: chunk?.delta?.tool_calls
                      },
                      finishReason: chunk?.finish_reason || null
                    }
                  ],
                  usage: chunkUsage
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
};

// src/providers/MistralProvider.ts
var MistralProvider = class {
  id;
  name = "Mistral";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `mistral-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response mapping
  formatResponse(data) {
    const choice = data.choices?.[0];
    const reasoningContent = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? null;
    return {
      id: data.id || `mistral-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens: data.usage.prompt_tokens_details?.cached_tokens ?? void 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.mistral.ai/v1";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Mistral API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      const rateLimit = parseRateLimitHeaders(response.headers);
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              if (msg.data.trim() === "[DONE]") break;
              try {
                const parsed = JSON.parse(msg.data);
                let chunkUsage;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? void 0
                  };
                }
                const chunk = {
                  id: parsed.id,
                  model: parsed.model,
                  choices: (parsed.choices || []).map(
                    // biome-ignore lint/suspicious/noExplicitAny: stream chunk mapping
                    (c) => ({
                      delta: {
                        role: c.delta?.role,
                        content: c.delta?.content ?? null,
                        reasoning_content: c.delta?.reasoning_content ?? c.delta?.reasoning ?? null,
                        tool_calls: c.delta?.tool_calls
                      },
                      finishReason: c.finish_reason || null
                    })
                  ),
                  usage: chunkUsage
                };
                yield chunk;
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const formatted = this.formatResponse(data);
      if (rateLimit) {
        formatted.rateLimit = rateLimit;
      }
      return formatted;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || "https://api.mistral.ai/v1";
    const url = `${baseUrl}/embeddings`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          input: request.input
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Mistral API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      return {
        object: "list",
        model: data.model || targetModel,
        // biome-ignore lint/suspicious/noExplicitAny: item mapping
        data: (data.data || []).map((item, idx) => ({
          object: "embedding",
          index: item.index ?? idx,
          embedding: item.embedding
        })),
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        } : void 0
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
};

// src/providers/OllamaProvider.ts
var OllamaProvider = class {
  id;
  name = "Ollama";
  config;
  constructor(config = {}) {
    this.config = config;
    this.id = config.id || `ollama-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens ?? 0;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k ?? 0;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k ?? 0;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const choice = data.choices?.[0];
    const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
    const reasoningContent = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? null;
    return {
      id: data.id || `ollama-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: promptTokens || completionTokens ? {
        promptTokens,
        completionTokens,
        totalTokens
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const rawBaseUrl = (this.config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    const baseUrl = rawBaseUrl.endsWith("/v1") ? rawBaseUrl : `${rawBaseUrl}/v1`;
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Ollama API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                let chunkUsage;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0
                  };
                } else if (parsed.prompt_eval_count !== void 0 || parsed.eval_count !== void 0) {
                  const promptTokens = parsed.prompt_eval_count || 0;
                  const completionTokens = parsed.eval_count || 0;
                  chunkUsage = {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens
                  };
                }
                yield {
                  id: parsed.id || `ollama-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content: chunk?.delta?.reasoning_content ?? chunk?.delta?.reasoning ?? null,
                        tool_calls: chunk?.delta?.tool_calls
                      },
                      finishReason: chunk?.finish_reason || null
                    }
                  ],
                  usage: chunkUsage
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      return this.formatResponse(data);
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const targetModel = this.resolveModel(request.model);
    const rawBaseUrl = (this.config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    const baseUrl = rawBaseUrl.endsWith("/v1") ? rawBaseUrl : `${rawBaseUrl}/v1`;
    const url = `${baseUrl}/embeddings`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: targetModel,
          input: request.input,
          ...request.user ? { user: request.user } : {}
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Ollama Embeddings API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      return {
        object: "list",
        model: data.model || targetModel,
        // biome-ignore lint/suspicious/noExplicitAny: item mapping
        data: (data.data || []).map((item, idx) => ({
          object: "embedding",
          index: item.index ?? idx,
          embedding: item.embedding
        })),
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        } : void 0
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
};

// src/providers/OpenAiProvider.ts
var OpenAiProvider = class {
  id;
  name = "OpenAI";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `openai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: this.resolveModel(request.model),
      messages
    };
    const resolvedModel = this.resolveModel(request.model);
    const isReasoningModel = resolvedModel.startsWith("o1") || resolvedModel.startsWith("o3") || resolvedModel.startsWith("o4") || resolvedModel.includes("reasoner");
    if (request.reasoningEffort) {
      payload.reasoning_effort = request.reasoningEffort;
    }
    if (request.temperature !== void 0 && !isReasoningModel) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      if (isReasoningModel) {
        payload.max_completion_tokens = request.maxTokens;
      } else {
        payload.max_tokens = request.maxTokens;
      }
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const choice = data.choices?.[0];
    const reasoningContent = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;
    return {
      id: data.id || `openai-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens: data.usage.prompt_tokens_details?.cached_tokens ?? void 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenAI API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                let chunkUsage;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? void 0
                  };
                }
                yield {
                  id: parsed.id || `openai-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content: chunk?.delta?.reasoning ?? chunk?.delta?.reasoning_content ?? null,
                        tool_calls: chunk?.delta?.tool_calls
                      },
                      finishReason: chunk?.finish_reason || null
                    }
                  ],
                  usage: chunkUsage
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl}/embeddings`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          input: request.input,
          ...request.user ? { user: request.user } : {}
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenAI API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      return {
        object: "list",
        model: data.model || targetModel,
        // biome-ignore lint/suspicious/noExplicitAny: item mapping
        data: (data.data || []).map((item, idx) => ({
          object: "embedding",
          index: item.index ?? idx,
          embedding: item.embedding
        })),
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        } : void 0
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
};

// src/providers/OpenRouterProvider.ts
var OPENROUTER_FREE_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "cohere/north-mini-code:free",
  "liquid/lfm-2.5-2.6b:free",
  "apodex/apodex-1.1-mini:free"
];
function isOpenRouterFreeModel(model) {
  if (!model) return false;
  return model === "openrouter/free" || model.endsWith(":free");
}
var OpenRouterProvider = class {
  id;
  name = "OpenRouter";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `openrouter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    if (config.isFreeTier) {
      this.name = "OpenRouter (Free)";
    }
  }
  isConfiguredModelFree() {
    const model = this.config.defaultModel;
    return !!model && isOpenRouterFreeModel(model);
  }
  get costPer1kTokens() {
    if (this.config.costPer1kTokens !== void 0) {
      return this.config.costPer1kTokens;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return void 0;
  }
  get promptCostPer1k() {
    if (this.config.promptCostPer1k !== void 0) {
      return this.config.promptCostPer1k;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return void 0;
  }
  get completionCostPer1k() {
    if (this.config.completionCostPer1k !== void 0) {
      return this.config.completionCostPer1k;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return void 0;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (this.config.isFreeTier) {
      return "openrouter/free";
    }
    return model;
  }
  formatRequest(request) {
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const primaryModel = this.resolveModel(request.model);
    const payload = {
      model: primaryModel,
      messages
    };
    const fallbackModels = request.fallbackModels ?? this.config.fallbackModels;
    if (fallbackModels && fallbackModels.length > 0) {
      const distinct = [
        primaryModel,
        ...fallbackModels.filter((m) => m !== primaryModel)
      ];
      payload.models = distinct;
    }
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.stream) {
      payload.stream = true;
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const choice = data.choices?.[0];
    const reasoningContent = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;
    const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? data.usage?.prompt_cache_hit_tokens ?? (data.usage?.cache_discount ? Math.round(
      (data.usage.prompt_tokens || 0) * data.usage.cache_discount
    ) : void 0);
    return {
      id: data.id || `openrouter-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://openrouter.ai/api/v1";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      };
      if (this.config.siteUrl) {
        headers["HTTP-Referer"] = this.config.siteUrl;
      }
      if (this.config.siteName) {
        headers["X-Title"] = this.config.siteName;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenRouter API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                let chunkUsage;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.prompt_cache_hit_tokens ?? void 0
                  };
                }
                yield {
                  id: parsed.id || `openrouter-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content: chunk?.delta?.reasoning ?? chunk?.delta?.reasoning_content ?? null,
                        tool_calls: chunk?.delta?.tool_calls
                      },
                      finishReason: chunk?.finish_reason || null
                    }
                  ],
                  usage: chunkUsage
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  /**
   * Fetches the dynamic list of free models directly from the OpenRouter API.
   * Matches models listed on https://openrouter.ai/models?variant=free ($0 prompt/completion pricing or :free suffix).
   */
  static async fetchFreeModels(options) {
    const baseUrl = options?.baseUrl || "https://openrouter.ai/api/v1";
    const headers = {};
    if (options?.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      signal: options?.signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch OpenRouter models (${response.status}): ${errorText}`
      );
    }
    const data = await response.json();
    const allModels = data.data || [];
    const freeModels = [];
    for (const m of allModels) {
      const isFreePricing = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      const isFreeSuffix = isOpenRouterFreeModel(m.id);
      if (isFreePricing || isFreeSuffix) {
        freeModels.push({
          id: m.id,
          name: m.name,
          description: m.description,
          contextLength: m.context_length,
          pricing: {
            prompt: m.pricing?.prompt ?? "0",
            completion: m.pricing?.completion ?? "0"
          },
          supportedParameters: m.supported_parameters,
          isFree: true
        });
      }
    }
    return freeModels;
  }
};
function createOpenRouterFreeProvider(config) {
  const model = config?.model || config?.defaultModel || "openrouter/free";
  const fallbackModels = config?.fallbackModels || [
    "openrouter/free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3.5-lightning:free"
  ];
  const envKey = typeof process !== "undefined" && process.env?.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY : "";
  return new OpenRouterProvider({
    ...config,
    apiKey: config?.apiKey || envKey,
    defaultModel: model,
    fallbackModels,
    isFreeTier: true,
    costPer1kTokens: 0,
    promptCostPer1k: 0,
    completionCostPer1k: 0
  });
}

// src/providers/XAiProvider.ts
init_stream();
var XAI_MODELS = {
  GROK_3: "grok-3-beta",
  GROK_3_FAST: "grok-3-fast-beta",
  GROK_3_MINI: "grok-3-mini-beta",
  GROK_3_MINI_FAST: "grok-3-mini-fast-beta",
  GROK_2_VISION: "grok-2-vision-1212"
};
var XAiProvider = class {
  id;
  name = "xAI";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `xai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  get costPer1kTokens() {
    return this.config.costPer1kTokens;
  }
  get promptCostPer1k() {
    return this.config.promptCostPer1k;
  }
  get completionCostPer1k() {
    return this.config.completionCostPer1k;
  }
  get retries() {
    return this.config.retries;
  }
  get retryDelayMs() {
    return this.config.retryDelayMs;
  }
  get fallbackModels() {
    return this.config.fallbackModels;
  }
  get defaultModel() {
    return this.config.defaultModel;
  }
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === "default") {
      return XAI_MODELS.GROK_3;
    }
    return model;
  }
  formatRequest(request) {
    const targetModel = this.resolveModel(request.model);
    const messages = request.messages.map((m) => {
      const msg = {
        role: m.role,
        content: m.content
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });
    const payload = {
      model: targetModel,
      messages
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== void 0) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.reasoningEffort) {
      payload.reasoning_effort = request.reasoningEffort === "medium" ? "high" : request.reasoningEffort;
    } else if (request.thinkingBudget && request.thinkingBudget > 0) {
      payload.reasoning_effort = request.thinkingBudget >= 2048 ? "high" : "low";
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: xAI response payload
  formatResponse(data) {
    const choice = data.choices?.[0];
    const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? void 0;
    return {
      id: data.id || `xai-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
            reasoning_content: choice?.message?.reasoning_content ?? null,
            tool_calls: choice?.message?.tool_calls
          },
          finishReason: choice?.finish_reason || "stop"
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cachedPromptTokens
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || "https://api.x.ai/v1";
    const url = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey || ""}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `xAI API Error (${response.status}): ${errorText}`
        );
        err.status = response.status;
        throw err;
      }
      if (request.stream) {
        return (async function* () {
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                const cachedPromptTokens = parsed.usage?.prompt_tokens_details?.cached_tokens ?? void 0;
                yield {
                  id: parsed.id || `xai-${Date.now()}`,
                  model: parsed.model || payload.model,
                  choices: chunk ? [
                    {
                      delta: {
                        role: chunk.delta?.role,
                        content: chunk.delta?.content,
                        reasoning_content: chunk.delta?.reasoning_content,
                        tool_calls: chunk.delta?.tool_calls
                      },
                      finishReason: chunk.finish_reason || null
                    }
                  ] : [],
                  usage: parsed.usage ? {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens
                  } : void 0
                };
              } catch (_e) {
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }
      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const baseUrl = this.config.baseUrl || "https://api.x.ai/v1";
    const url = `${baseUrl}/embeddings`;
    const payload = {
      model: request.model || "v1",
      input: request.input
    };
    if (request.dimensions) {
      payload.dimensions = request.dimensions;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey || ""}`
      },
      body: JSON.stringify(payload),
      signal: request.signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `xAI Embedding API Error (${response.status}): ${errorText}`
      );
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    return {
      object: "list",
      data: (data.data || []).map(
        // biome-ignore lint/suspicious/noExplicitAny: embedding item
        (item, idx) => ({
          index: item.index ?? idx,
          embedding: item.embedding || [],
          object: "embedding"
        })
      ),
      model: data.model || payload.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : void 0
    };
  }
};
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * Model Context Protocol (MCP) In-Process Tool Bridge & JSON-RPC Protocol
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Zero-Dependency PII Guardrails Engine
 *
 * In-process automatic redaction of Personally Identifiable Information (PII)
 * from outgoing LLM payloads before they leave the network boundary.
 * No external dependencies, no data leaves the process unprotected.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK EmbeddingModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Prompt & Tool Converter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK LanguageModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK v1 Specification Types
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Integration & Provider Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Cloudflare Workers KV Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Cloudflare D1 (SQLite Edge) Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Redis / Upstash Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

exports.AnthropicProvider = AnthropicProvider;
exports.BatchExecutionError = BatchExecutionError;
exports.BudgetExceededError = BudgetExceededError;
exports.BudgetGuardrails = BudgetGuardrails;
exports.COHERE_MODELS = COHERE_MODELS;
exports.CircuitBreaker = CircuitBreaker;
exports.CloudflareKVStorage = CloudflareKVStorage;
exports.CohereProvider = CohereProvider;
exports.ContextCompressor = ContextCompressor;
exports.D1Storage = D1Storage;
exports.DeepSeekProvider = DeepSeekProvider;
exports.GEMINI_DEFAULT_PRICING = GEMINI_DEFAULT_PRICING;
exports.GEMINI_MODELS = GEMINI_MODELS;
exports.GatewayRateLimitError = GatewayRateLimitError;
exports.GatewayRateLimiter = GatewayRateLimiter;
exports.GeminiProvider = GeminiProvider;
exports.GroqProvider = GroqProvider;
exports.HedgedExecutor = HedgedExecutor;
exports.InMemoryStorage = InMemoryStorage;
exports.McpToolBridge = McpToolBridge;
exports.MistralProvider = MistralProvider;
exports.OPENROUTER_FREE_MODELS = OPENROUTER_FREE_MODELS;
exports.OllamaProvider = OllamaProvider;
exports.OpenAiProvider = OpenAiProvider;
exports.OpenRouterProvider = OpenRouterProvider;
exports.PIIGuardrails = PIIGuardrails;
exports.RedisStorage = RedisStorage;
exports.Router = Router;
exports.SecurityGuardrailError = SecurityGuardrailError;
exports.SecurityGuardrails = SecurityGuardrails;
exports.SinapsClient = SinapsClient;
exports.SinapsEmbeddingModel = SinapsEmbeddingModel;
exports.SinapsLanguageModel = SinapsLanguageModel;
exports.XAI_MODELS = XAI_MODELS;
exports.XAiProvider = XAiProvider;
exports.accumulateStream = accumulateStream;
exports.convertPromptToSinapsMessages = convertPromptToSinapsMessages;
exports.convertToolsAndMode = convertToolsAndMode;
exports.cosineSimilarity = cosineSimilarity;
exports.createOpenRouterFreeProvider = createOpenRouterFreeProvider;
exports.createSinapsAI = createSinapsAI;
exports.estimateMessageTokens = estimateMessageTokens;
exports.estimateTotalTokens = estimateTotalTokens;
exports.executeBatch = executeBatch;
exports.extractBalancedJson = extractBalancedJson;
exports.extractJsonFromText = extractJsonFromText;
exports.extractPromptText = extractPromptText;
exports.formatOtelMetrics = formatOtelMetrics;
exports.formatPrometheusMetrics = formatPrometheusMetrics;
exports.isOpenRouterFreeModel = isOpenRouterFreeModel;
exports.linkAbortSignal = linkAbortSignal;
exports.mapFinishReason = mapFinishReason;
exports.sinapsai = sinapsai;
exports.tryExtractJson = tryExtractJson;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map