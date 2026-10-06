'use strict';

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
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          currentEvent = void 0;
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          yield { event: currentEvent, data };
        }
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
          await this.recordFailure(provider.id);
          throw error;
        }
        await this.recordSuccess(provider.id);
        return (async function* () {
          if (!firstResult.done) {
            yield firstResult.value;
            let nextResult;
            nextResult = await iterator.next();
            while (!nextResult.done) {
              yield nextResult.value;
              nextResult = await iterator.next();
            }
          }
        })();
      }
      await this.recordSuccess(provider.id);
      return response;
    } catch (error) {
      await this.recordFailure(provider.id);
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
  destroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
  }
};

// src/core/Router.ts
var Router = class {
  providers;
  strategy;
  circuitBreaker;
  hooks;
  currentProviderIndex = 0;
  retries;
  retryDelayMs;
  cacheOptions;
  storage;
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
  recordMetrics(providerId, success, latencyMs, promptTokens = 0, completionTokens = 0, costUsd = 0) {
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
    } else {
      pm.failures++;
      this.metrics.failedRequests++;
    }
    pm.promptTokens += promptTokens;
    pm.completionTokens += completionTokens;
    pm.latencySumMs += latencyMs;
    pm.averageLatencyMs = Math.round(
      pm.latencySumMs / (pm.successes + pm.failures)
    );
    this.metrics.totalPromptTokens += promptTokens;
    this.metrics.totalCompletionTokens += completionTokens;
    this.metrics.totalTokens += promptTokens + completionTokens;
    this.metrics.estimatedCostUsd = Number(
      (this.metrics.estimatedCostUsd + costUsd).toFixed(6)
    );
  }
  estimateRequestCost(provider, request) {
    if (provider.promptCostPer1k !== void 0 && provider.completionCostPer1k !== void 0) {
      let totalChars = 0;
      if (Array.isArray(request.messages)) {
        for (const msg of request.messages) {
          totalChars += msg.content?.length ?? 0;
        }
      }
      const estimatedPromptTokens = Math.max(1, Math.ceil(totalChars / 4));
      const estimatedCompletionTokens = request.maxTokens ?? 500;
      return estimatedPromptTokens / 1e3 * provider.promptCostPer1k + estimatedCompletionTokens / 1e3 * provider.completionCostPer1k;
    }
    return provider.costPer1kTokens ?? Number.POSITIVE_INFINITY;
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
    let providersList = this.providers;
    if (this.strategy === "lowest-cost") {
      providersList = [...this.providers].sort((a, b) => {
        const costA = this.estimateRequestCost(a, request);
        const costB = this.estimateRequestCost(b, request);
        if (costA === costB) return 0;
        return costA < costB ? -1 : 1;
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
      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;
      while (true) {
        const startTime = Date.now();
        try {
          const res = await this.circuitBreaker.execute(provider, request);
          const latencyMs = Date.now() - startTime;
          if (!request.stream && "choices" in res) {
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
            this.recordMetrics(
              provider.id,
              true,
              latencyMs,
              promptTokens,
              completionTokens,
              costUsd
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

// src/core/SinapsClient.ts
var SinapsClient = class {
  router;
  storage;
  constructor(options) {
    this.storage = options.storage || new InMemoryStorage();
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
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
      cache: options.cache,
      storage: this.storage
    });
  }
  chat = {
    completions: {
      create: (async (request) => {
        const fullReq = {
          model: request.model || "default",
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools: request.tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat
        };
        return this.router.execute(fullReq);
      })
    }
  };
  embeddings = {
    create: async (request) => {
      return this.router.executeEmbedding(request);
    }
  };
  getMetrics() {
    return this.router.getMetrics();
  }
};

// src/utils/rateLimit.ts
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
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    const systemMessages = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        if (msg.content) systemMessages.push(msg.content);
      } else if (msg.role === "tool") {
        payload.messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content || ""
            }
          ]
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const contentBlocks = [];
        if (msg.content) {
          contentBlocks.push({ type: "text", text: msg.content });
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
            content: msg.content ?? ""
          });
        }
      }
    }
    if (systemMessages.length > 0) {
      payload.system = systemMessages.join("\n");
    }
    if (request.tools) {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object" }
      }));
    }
    if (request.toolChoice) {
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
    const toolCalls = [];
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text") {
          text += block.text;
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
            tool_calls: toolCalls.length > 0 ? toolCalls : void 0
          },
          finishReason
        }
      ],
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
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
          try {
            for await (const msg of parseSSE2(response)) {
              if (msg.event === "message_start") {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.message?.id) messageId = parsed.message.id;
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
                  }
                } catch (_e) {
                }
              } else if (msg.event === "message_delta") {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.delta?.stop_reason) {
                    let finishReason = "stop";
                    switch (parsed.delta.stop_reason) {
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
                      ]
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
        totalTokens: data.usage.total_tokens || 0
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
                yield {
                  id: parsed.id || `deepseek-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content: chunk?.delta?.reasoning_content,
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
  resolveModel(model) {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }
  // Exposed for testing
  formatRequest(request) {
    const contents = [];
    const systemParts = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        if (msg.content) systemParts.push({ text: msg.content });
      } else if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.name || "function",
                response: { content: msg.content }
              }
            }
          ]
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts = [];
        if (msg.content) parts.push({ text: msg.content });
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
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === geminiRole && typeof msg.content === "string") {
          lastContent.parts.push({ text: msg.content });
        } else {
          contents.push({
            role: geminiRole,
            parts: [{ text: msg.content ?? "" }]
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
    }
    const payload = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
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
    return payload;
  }
  // Exposed for testing
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data, model) {
    const candidate = data.candidates?.[0];
    let text = "";
    const toolCalls = [];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
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
            tool_calls: toolCalls.length > 0 ? toolCalls : void 0
          },
          finishReason
        }
      ],
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0
      } : void 0
    };
  }
  async generateContent(request) {
    const payload = this.formatRequest(request);
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const finalUrl = `${baseUrl}/models/${targetModel}:${request.stream ? "streamGenerateContent?alt=sse&key=" : "generateContent?key="}${this.config.apiKey}`;
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
                        content: chunk.choices[0].message.content
                      },
                      finishReason: chunk.choices[0].finishReason === "stop" && !chunk.choices[0].message.content ? "stop" : chunk.choices[0].finishReason !== "stop" ? chunk.choices[0].finishReason : null
                    }
                  ]
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
      return this.formatResponse(data, targetModel);
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
    return {
      id: data.id || `groq-${Date.now()}`,
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
        totalTokens: data.usage.total_tokens || 0
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
                yield {
                  id: parsed.id || `groq-${Date.now()}`,
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
    return {
      id: data.id || `openai-${Date.now()}`,
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
        totalTokens: data.usage.total_tokens || 0
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
                yield {
                  id: parsed.id || `openai-${Date.now()}`,
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
var OpenRouterProvider = class {
  id;
  name = "OpenRouter";
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id || `openrouter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
    return {
      id: data.id || `openrouter-${Date.now()}`,
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
        totalTokens: data.usage.total_tokens || 0
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
                yield {
                  id: parsed.id || `openrouter-${Date.now()}`,
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

exports.AnthropicProvider = AnthropicProvider;
exports.CircuitBreaker = CircuitBreaker;
exports.DeepSeekProvider = DeepSeekProvider;
exports.GeminiProvider = GeminiProvider;
exports.GroqProvider = GroqProvider;
exports.InMemoryStorage = InMemoryStorage;
exports.OllamaProvider = OllamaProvider;
exports.OpenAiProvider = OpenAiProvider;
exports.OpenRouterProvider = OpenRouterProvider;
exports.Router = Router;
exports.SinapsClient = SinapsClient;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map