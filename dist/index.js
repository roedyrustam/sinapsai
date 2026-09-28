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
  resetTimeoutMs;
  onCircuitOpen;
  onCircuitClose;
  constructor(storage, options = {}) {
    this.storage = storage;
    this.failureThreshold = options.failureThreshold || 3;
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
      const previousState = await this.storage.get(
        `cb:state:${providerId}`
      );
      await this.storage.delete(`cb:failures:${providerId}`);
      await this.storage.set(`cb:state:${providerId}`, "CLOSED");
      if (previousState === "OPEN" || failures !== null && failures >= this.failureThreshold) {
        this.onCircuitClose?.(providerId);
      }
    } catch (_error) {
    }
  }
  async recordFailure(providerId) {
    try {
      const failures = await this.storage.increment(
        `cb:failures:${providerId}`
      );
      if (failures === this.failureThreshold) {
        await this.storage.set(
          `cb:state:${providerId}`,
          "OPEN",
          this.resetTimeoutMs / 1e3
        );
        this.onCircuitOpen?.(providerId);
      } else if (failures > this.failureThreshold) {
        await this.storage.set(
          `cb:state:${providerId}`,
          "OPEN",
          this.resetTimeoutMs / 1e3
        );
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
  constructor(sweepIntervalMs = 6e4) {
    if (typeof setInterval !== "undefined") {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
      if (this.sweepInterval && typeof this.sweepInterval.unref === "function") {
        this.sweepInterval.unref();
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
  constructor(providers, circuitBreaker, options = {}) {
    if (!providers || providers.length === 0) {
      throw new Error("At least one provider must be configured");
    }
    this.providers = providers;
    this.strategy = options.strategy || "failover";
    this.circuitBreaker = circuitBreaker;
    this.hooks = options.hooks;
  }
  getProviderById(id) {
    return this.providers.find((p) => p.id === id);
  }
  async execute(request) {
    let providersList = this.providers;
    if (this.strategy === "lowest-cost") {
      providersList = [...this.providers].sort((a, b) => {
        const costA = a.costPer1kTokens ?? Infinity;
        const costB = b.costPer1kTokens ?? Infinity;
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
      try {
        return await this.circuitBreaker.execute(provider, request);
      } catch (error) {
        const err = error;
        errors.push(err);
        if (err.status === 429 || err.message.includes("429") || err.message.toLowerCase().includes("rate limit")) {
          this.hooks?.onRateLimit?.(provider, err);
        }
        previousProvider = provider;
        previousError = err;
      }
    }
    throw new AggregateError(errors, "All providers failed or are unavailable");
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
      hooks: options.hooks
    });
  }
  chat = {
    completions: {
      create: async (request) => {
        const fullReq = {
          model: request.model || "default",
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens
        };
        return this.router.execute(fullReq);
      }
    }
  };
};

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
  formatRequest(request) {
    const payload = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages: []
    };
    if (request.temperature !== void 0) {
      payload.temperature = request.temperature;
    }
    const systemMessages = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else {
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (lastMsg && lastMsg.role === msg.role) {
          lastMsg.content += `

${msg.content}`;
        } else {
          payload.messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }
    if (systemMessages.length > 0) {
      payload.system = systemMessages.join("\n");
    }
    if (request.stream) {
      payload.stream = true;
    }
    return payload;
  }
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data) {
    const text = data.content?.map((c) => c.text).join("") || "";
    let finishReason = "stop";
    if (data.stop_reason) {
      switch (data.stop_reason) {
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
            content: text
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
                      model: request.model,
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
                      model: request.model,
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
  // Exposed for testing
  formatRequest(request) {
    const contents = [];
    const systemParts = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemParts.push({ text: msg.content });
      } else {
        const geminiRole = msg.role === "assistant" ? "model" : "user";
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === geminiRole) {
          lastContent.parts.push({ text: msg.content });
        } else {
          contents.push({
            role: geminiRole,
            parts: [{ text: msg.content }]
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
    const payload = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }
    return payload;
  }
  // Exposed for testing
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  formatResponse(data, model) {
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";
    let finishReason = "stop";
    if (candidate?.finishReason) {
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
            content: text
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
    const baseUrl = this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = request.stream ? "streamGenerateContent?alt=sse" : "generateContent";
    `${baseUrl}/models/${request.model}:${endpoint}&key=${this.config.apiKey}`.replace(
      ":streamGenerateContent?alt=sse&key=",
      ":streamGenerateContent?alt=sse&key="
    ).replace(":generateContent&key=", ":generateContent?key=");
    const finalUrl = `${baseUrl}/models/${request.model}:${request.stream ? "streamGenerateContent?alt=sse&key=" : "generateContent?key="}${this.config.apiKey}`;
    const controller = new AbortController();
    let timeoutId;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
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
                const chunk = self.formatResponse(parsed, request.model);
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
      return this.formatResponse(data, request.model);
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
  formatRequest(request) {
    const payload = {
      model: request.model,
      messages: request.messages
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
            content: choice?.message?.content || ""
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
                        content: chunk?.delta?.content || ""
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
  formatRequest(request) {
    const payload = {
      model: request.model,
      messages: request.messages
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
            content: choice?.message?.content || ""
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
                        content: chunk?.delta?.content || ""
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
  formatRequest(request) {
    const payload = {
      model: request.model,
      messages: request.messages
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
            content: choice?.message?.content || ""
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
                        content: chunk?.delta?.content || ""
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
};

export { AnthropicProvider, CircuitBreaker, GeminiProvider, GroqProvider, InMemoryStorage, OpenAiProvider, OpenRouterProvider, Router, SinapsClient };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map