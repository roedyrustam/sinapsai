'use strict';

/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

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
      return true;
    } catch (_error) {
      return true;
    }
  }
  async recordSuccess(providerId) {
    try {
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
            }
            throw streamError;
          }
        })();
      }
      await this.recordSuccess(provider.id);
      return response;
    } catch (error) {
      const isAbort = request.signal?.aborted || error?.name === "AbortError" || error?.message?.toLowerCase().includes("aborted");
      if (!isAbort) {
        await this.recordFailure(provider.id);
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
    const avgLatency = Math.max(30, pm.averageLatencyMs || 200);
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
  isReversiblePII = false;
  modelAliases = /* @__PURE__ */ new Map();
  hooks;
  constructor(options) {
    this.storage = options.storage || new InMemoryStorage();
    this.hooks = options.hooks;
    if (options.modelAliases) {
      for (const [alias, target] of Object.entries(options.modelAliases)) {
        this.modelAliases.set(alias, target);
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
          reasoningEffort: request.reasoningEffort
        };
        const res = await this.router.execute(fullReq);
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
      return this.router.executeEmbedding({
        ...request,
        model
      });
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

exports.SinapsEmbeddingModel = SinapsEmbeddingModel;
exports.SinapsLanguageModel = SinapsLanguageModel;
exports.convertPromptToSinapsMessages = convertPromptToSinapsMessages;
exports.convertToolsAndMode = convertToolsAndMode;
exports.createSinapsAI = createSinapsAI;
exports.mapFinishReason = mapFinishReason;
exports.sinapsai = sinapsai;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map