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
  const lastBrace = trimmed.lastIndexOf("}");
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  const hasObject = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace;
  const hasArray = firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket;
  if (hasObject && (!hasArray || firstBrace < firstBracket)) {
    try {
      const candidate = trimmed.substring(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    } catch (_e) {
    }
  } else if (hasArray) {
    try {
      const candidate = trimmed.substring(firstBracket, lastBracket + 1);
      return JSON.parse(candidate);
    } catch (_e) {
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
  }
  getProviderById(id) {
    return this.providers.find((p) => p.id === id);
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
            if (currentRequest.stream && res != null && typeof res === "object" && Symbol.asyncIterator in res) {
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
                    costUsd = collectedPromptTokens / 1e3 * provider.promptCostPer1k + collectedCompletionTokens / 1e3 * provider.completionCostPer1k;
                  } else if (provider.costPer1kTokens !== void 0) {
                    costUsd = (collectedPromptTokens + collectedCompletionTokens) / 1e3 * provider.costPer1kTokens;
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
            if (!currentRequest.stream && "choices" in res) {
              const apiRes = res;
              this.hooks?.onSuccess?.(provider, apiRes, latencyMs);
              const promptTokens = apiRes.usage?.promptTokens ?? 0;
              const completionTokens = apiRes.usage?.completionTokens ?? 0;
              let costUsd = 0;
              if (provider.promptCostPer1k !== void 0 && provider.completionCostPer1k !== void 0) {
                costUsd = promptTokens / 1e3 * provider.promptCostPer1k + completionTokens / 1e3 * provider.completionCostPer1k;
              } else if (provider.costPer1kTokens !== void 0) {
                costUsd = (promptTokens + completionTokens) / 1e3 * provider.costPer1kTokens;
              }
              const cachedPromptTokens = apiRes.usage?.cachedPromptTokens ?? 0;
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
              if (this.cacheOptions?.enabled && semanticConfig?.enabled && !currentRequest.stream) {
                try {
                  const promptText = extractPromptText(request.messages);
                  if (!queryEmbedding) {
                    queryEmbedding = await this.getEmbeddingForText(
                      promptText,
                      semanticConfig
                    );
                  }
                  if (queryEmbedding && queryEmbedding.length > 0) {
                    const maxEntries = semanticConfig.maxEntries ?? 1e3;
                    const ttlMs = (this.cacheOptions.ttlSeconds ?? 300) * 1e3;
                    if (this.semanticEntries.length >= maxEntries) {
                      this.semanticEntries.shift();
                    }
                    this.semanticEntries.push({
                      model: request.model,
                      prompt: promptText,
                      embedding: queryEmbedding,
                      response: apiRes,
                      expiresAt: Date.now() + ttlMs
                    });
                  }
                } catch (_e) {
                }
              }
            }
            return res;
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
      if (lastModelError) {
        errors.push(lastModelError);
        previousProvider = provider;
        previousError = lastModelError;
      }
    }
    throw new AggregateError(errors, "All providers failed or are unavailable");
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
      storage: this.storage
    });
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
    const parsedSec = Number.parseFloat(retryAfter);
    if (!Number.isNaN(parsedSec)) {
      resetMs = Math.round(parsedSec * 1e3);
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

// src/providers/AnthropicProvider.ts
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
        if (typeof msg.content === "string") {
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
    if (systemMessages.length > 0) {
      payload.system = systemMessages.join("\n");
    }
    if (request.responseFormat?.type === "json_object") {
      const jsonInstruction = "Respond strictly with a valid JSON object without markdown wrappers.";
      payload.system = payload.system ? `${payload.system}
${jsonInstruction}` : jsonInstruction;
    } else if (request.responseFormat?.type === "json_schema" && request.responseFormat.json_schema) {
      const schemaInstruction = `Respond strictly with valid JSON matching this schema:
${JSON.stringify(request.responseFormat.json_schema.schema)}`;
      payload.system = payload.system ? `${payload.system}
${schemaInstruction}` : schemaInstruction;
    }
    if (request.tools) {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object" }
      }));
    }
    if (request.toolChoice) {
      if (request.toolChoice === "none") {
        delete payload.tools;
      } else if (request.toolChoice === "auto") {
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01"
        },
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
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          let messageId = `anthropic-${Date.now()}`;
          let promptTokens = 0;
          let cachedPromptTokens;
          try {
            for await (const msg of parseSSE2(response)) {
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
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
};

// src/providers/GeminiProvider.ts
var GEMINI_MODELS = {
  // Flagship & General Multimodal Models
  FLASH_2_5: "gemini-2.5-flash",
  FLASH_LITE_2_5: "gemini-2.5-flash-lite",
  PRO_2_5: "gemini-2.5-pro",
  FLASH_3_8: "gemini-3.8-flash",
  FLASH_3_6: "gemini-3.6-flash",
  FLASH_LITE_3_5: "gemini-3.5-flash-lite",
  PRO_3_1_PREVIEW: "gemini-3.1-pro-preview",
  // Auto-updating Managed Aliases
  FLASH_LATEST: "gemini-flash-latest",
  PRO_LATEST: "gemini-pro-latest",
  // Embeddings Models
  EMBEDDING_001: "gemini-embedding-001",
  EMBEDDING_2: "gemini-embedding-2",
  TEXT_EMBEDDING_004: "text-embedding-004"
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
  // Exposed for testing
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
        const resolvedFunctionName = msg.name || (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : void 0) || "function";
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: resolvedFunctionName,
                response: { content: responseContent }
              }
            }
          ]
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts = [];
        if (typeof msg.content === "string") {
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
      const rawSchema = { ...request.responseFormat.json_schema.schema };
      delete rawSchema.additionalProperties;
      generationConfig.responseSchema = rawSchema;
    }
    const thinkingBudget = request.thinkingBudget ?? this.config.thinkingBudget;
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
    if (request.tools) {
      payload.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          }))
        }
      ];
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
  // Exposed for testing
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data, model) {
    const candidate = data.candidates?.[0];
    let text = "";
    let reasoningContent = "";
    const toolCalls = [];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.thought) {
          reasoningContent += part.text || "";
        } else if (part.text) {
          text += part.text;
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
    return {
      id: `gemini-${Date.now()}`,
      model,
      choices: [
        {
          message: {
            role: "assistant",
            content: text || null,
            reasoning_content: reasoningContent || void 0,
            tool_calls: toolCalls.length > 0 ? toolCalls : void 0
          },
          finishReason
        }
      ],
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
    const endpointAction = request.stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const finalUrl = `${baseUrl}/models/${targetModel}:${endpointAction}`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
        return (async function* (self) {
          const { parseSSE: parseSSE2 } = await Promise.resolve().then(() => (init_stream(), stream_exports));
          try {
            for await (const msg of parseSSE2(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = self.formatResponse(parsed, targetModel);
                yield {
                  id: chunk.id,
                  model: chunk.model,
                  choices: [
                    {
                      delta: {
                        role: "assistant",
                        content: chunk.choices[0].message.content,
                        reasoning_content: chunk.choices[0].message.reasoning_content,
                        tool_calls: chunk.choices[0].message.tool_calls
                      },
                      finishReason: chunk.choices[0].finishReason === "stop" && !chunk.choices[0].message.content ? "stop" : chunk.choices[0].finishReason !== "stop" ? chunk.choices[0].finishReason : null
                    }
                  ],
                  usage: chunk.usage
                };
              } catch (_e) {
              }
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })(this);
      }
      const data = await response.json();
      const res = this.formatResponse(data, targetModel);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
  async generateEmbedding(request) {
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const isBatch = Array.isArray(request.input);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const finalUrl = isBatch ? `${baseUrl}/models/${targetModel}:batchEmbedContents?key=${this.config.apiKey}` : `${baseUrl}/models/${targetModel}:embedContent?key=${this.config.apiKey}`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
    const payload = isBatch ? {
      requests: inputs.map((text) => {
        const reqObj = {
          model: `models/${targetModel}`,
          content: { parts: [{ text }] }
        };
        if (request.dimensions !== void 0) {
          reqObj.outputDimensionality = request.dimensions;
        }
        return reqObj;
      })
    } : {
      content: { parts: [{ text: inputs[0] }] }
    };
    if (!isBatch && request.dimensions !== void 0) {
      payload.outputDimensionality = request.dimensions;
    }
    try {
      const response = await fetch(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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
      const data = await response.json();
      if (isBatch) {
        const embeddingsList = (data.embeddings || []).map(
          // biome-ignore lint/suspicious/noExplicitAny: embedding item
          (item, idx) => ({
            object: "embedding",
            index: idx,
            embedding: item.values || []
          })
        );
        return {
          object: "list",
          model: targetModel,
          data: embeddingsList,
          usage: data.usageMetadata ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0
          } : void 0
        };
      }
      return {
        object: "list",
        model: targetModel,
        data: [
          {
            object: "embedding",
            index: 0,
            embedding: data.embedding?.values || []
          }
        ],
        usage: data.usageMetadata ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0
        } : void 0
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
  /**
   * Fetches all available Gemini models directly from Google Generative Language API.
   * Corresponds to models listed on https://ai.google.dev/gemini-api/docs/models?hl=id
   */
  static async fetchAvailableModels(options) {
    const baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetch(`${baseUrl}/models?key=${options.apiKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: options.signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch Gemini models (${response.status}): ${errorText}`
      );
    }
    const data = await response.json();
    return (data.models || []).map((m) => {
      const id = m.name.replace(/^models\//, "");
      return {
        id,
        displayName: m.displayName || id,
        description: m.description,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
        supportedGenerationMethods: m.supportedGenerationMethods || []
      };
    });
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
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
  // biome-ignore lint/suspicious/noExplicitAny: response mapping
  formatResponse(data) {
    const choice = data.choices?.[0];
    return {
      id: data.id || `mistral-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
                const chunk = {
                  id: parsed.id,
                  model: parsed.model,
                  choices: (parsed.choices || []).map(
                    // biome-ignore lint/suspicious/noExplicitAny: stream chunk mapping
                    (c) => ({
                      delta: {
                        role: c.delta?.role,
                        content: c.delta?.content ?? null,
                        tool_calls: c.delta?.tool_calls
                      },
                      finishReason: c.finish_reason || null
                    })
                  )
                };
                yield chunk;
              } catch (_e) {
              }
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
    const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
    return {
      id: data.id || `ollama-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: choice?.message?.content ?? null,
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
                yield {
                  id: parsed.id || `ollama-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        tool_calls: chunk?.delta?.tool_calls
                      },
                      finishReason: chunk?.finish_reason || null
                    }
                  ]
                };
              } catch (_e) {
              }
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })();
      }
      const data = await response.json();
      return this.formatResponse(data);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }
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
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
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
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
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
exports.CircuitBreaker = CircuitBreaker;
exports.CloudflareKVStorage = CloudflareKVStorage;
exports.D1Storage = D1Storage;
exports.DeepSeekProvider = DeepSeekProvider;
exports.GEMINI_MODELS = GEMINI_MODELS;
exports.GeminiProvider = GeminiProvider;
exports.GroqProvider = GroqProvider;
exports.InMemoryStorage = InMemoryStorage;
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
exports.accumulateStream = accumulateStream;
exports.convertPromptToSinapsMessages = convertPromptToSinapsMessages;
exports.convertToolsAndMode = convertToolsAndMode;
exports.cosineSimilarity = cosineSimilarity;
exports.createOpenRouterFreeProvider = createOpenRouterFreeProvider;
exports.createSinapsAI = createSinapsAI;
exports.executeBatch = executeBatch;
exports.extractJsonFromText = extractJsonFromText;
exports.extractPromptText = extractPromptText;
exports.isOpenRouterFreeModel = isOpenRouterFreeModel;
exports.mapFinishReason = mapFinishReason;
exports.sinapsai = sinapsai;
exports.tryExtractJson = tryExtractJson;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map