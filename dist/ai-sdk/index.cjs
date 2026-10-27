'use strict';

/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

// src/core/GeminiAgentBooster.ts
var COMPLEX_REASONING_REGEX = /\b(architect(?:ure)?|refactor|optimiz(?:e|ation)|vulnerabilit(?:y|ies)|security\s+audit|prove|theorem|algorithm|concurren(?:t|cy)|deadlock|race\s+condition|distributed|microkernel|step[\s-]by[\s-]step|root\s+cause|stack\s+trace|benchmark|formal\s+verification)\b/i;
var CODE_OR_MATH_REGEX = /```[\s\S]*?```|\b(?:function|class|interface|SELECT\s+.+\s+FROM|CREATE\s+TABLE|async\s+function|Promise\.all|TypeError:|ReferenceError:|Error:\s+at\s+)\b|\$\$[\s\S]+?\$\$/i;
var SIMPLE_INTENT_REGEX = /^(?:hi|hello|hey|halo|ping|ok|okay|thanks|thank\s+you|terima\s+kasih|yes|no|ya|tidak|translate\s+to\s+\w+:|classify\s*:)/i;
function canonicalizeJsonValue(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  const record = value;
  const sortedKeys = Object.keys(record).filter(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype"
  ).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJsonValue(record[key]);
  }
  return result;
}
function extractMessagesText(messages) {
  const allParts = [];
  const systemParts = [];
  let lastUserText = "";
  let nonSystemTurnCount = 0;
  for (const msg of messages) {
    let msgText = "";
    if (typeof msg.content === "string") {
      msgText = msg.content;
    } else if (Array.isArray(msg.content)) {
      msgText = msg.content.map((p) => p.type === "text" ? p.text : "").filter(Boolean).join("\n");
    }
    if (msg.role === "system") {
      if (msgText) systemParts.push(msgText);
    } else {
      nonSystemTurnCount++;
      if (msg.role === "user" && msgText) {
        lastUserText = msgText;
      }
    }
    if (msgText) {
      allParts.push(msgText);
    }
  }
  return {
    totalText: allParts.join("\n"),
    lastUserText,
    systemText: systemParts.join("\n"),
    nonSystemTurnCount
  };
}
var GeminiAgentBooster = class _GeminiAgentBooster {
  /**
   * Analyzes a UnifiedApiRequest and computes a complexity score [0..1],
   * thinking tier ('none' | 'low' | 'medium' | 'high'), and recommended thinkingBudget.
   */
  static analyzeComplexity(request) {
    const signals = [];
    let score = 0;
    const { totalText, lastUserText, nonSystemTurnCount } = extractMessagesText(
      request.messages || []
    );
    const trimmedLastUser = lastUserText.trim();
    const totalChars = totalText.length;
    const toolCount = request.tools?.length ?? 0;
    if (toolCount === 0 && !request.responseFormat && totalChars < 80 && (totalChars === 0 || SIMPLE_INTENT_REGEX.test(trimmedLastUser)) && !CODE_OR_MATH_REGEX.test(totalText) && !COMPLEX_REASONING_REGEX.test(totalText)) {
      signals.push("simple_intent_short_prompt");
      return {
        score: 0.05,
        tier: "none",
        recommendedBudget: 0,
        signals
      };
    }
    if (totalChars > 8e3) {
      score += 0.35;
      signals.push("long_context_8k+");
    } else if (totalChars > 2e3) {
      score += 0.25;
      signals.push("medium_context_2k+");
    } else if (totalChars > 300) {
      score += 0.15;
      signals.push("standard_context_300+");
    } else if (totalChars > 60) {
      score += 0.1;
      signals.push("concise_prompt");
    }
    if (CODE_OR_MATH_REGEX.test(totalText)) {
      score += 0.3;
      signals.push("code_or_math_detected");
    }
    if (COMPLEX_REASONING_REGEX.test(totalText)) {
      score += 0.3;
      signals.push("complex_reasoning_keywords");
    }
    if (toolCount >= 4) {
      score += 0.3;
      signals.push(`multi_tool_orchestration(${toolCount})`);
    } else if (toolCount >= 1) {
      score += 0.2;
      signals.push(`tool_calling(${toolCount})`);
    }
    if (request.responseFormat?.type === "json_schema") {
      score += 0.15;
      signals.push("strict_json_schema");
    } else if (request.responseFormat?.type === "json_object") {
      score += 0.1;
      signals.push("json_object_mode");
    }
    if (nonSystemTurnCount >= 6) {
      score += 0.15;
      signals.push(`deep_conversation(${nonSystemTurnCount}_turns)`);
    }
    const clampedScore = Math.min(1, Number(score.toFixed(2)));
    if (clampedScore < 0.15) {
      return {
        score: clampedScore,
        tier: "none",
        recommendedBudget: 0,
        signals
      };
    }
    if (clampedScore < 0.45) {
      return {
        score: clampedScore,
        tier: "low",
        recommendedBudget: 2048,
        signals
      };
    }
    if (clampedScore < 0.75) {
      return {
        score: clampedScore,
        tier: "medium",
        recommendedBudget: 8192,
        signals
      };
    }
    return {
      score: clampedScore,
      tier: "high",
      recommendedBudget: 32768,
      signals
    };
  }
  /**
   * Computes a concrete numerical thinking token budget for `thinkingBudget: 'auto'`.
   */
  static computeDynamicThinkingBudget(request) {
    return _GeminiAgentBooster.analyzeComplexity(request).recommendedBudget;
  }
  /**
   * Deterministically sorts tool definitions by `function.name` and recursively
   * canonicalizes `function.parameters` keys so identical tool sets always produce
   * byte-identical JSON prefixes for KV-Cache reuse.
   */
  static canonicalizeTools(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return tools;
    }
    return [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name)).map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        parameters: tool.function.parameters ? canonicalizeJsonValue(tool.function.parameters) : tool.function.parameters
      }
    }));
  }
  /**
   * Canonicalizes a UnifiedApiRequest for optimal KV-Cache hit rates and resolves
   * `thinkingBudget: 'auto'` if specified.
   *
   * - Pins all `system` messages to the leading prefix in their relative order.
   * - Sorts `tools` and their JSON schema keys deterministically.
   * - Resolves `thinkingBudget: 'auto'` into a concrete numerical token budget.
   */
  static canonicalizeRequest(request) {
    const systemMessages = [];
    const conversationMessages = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }
    const canonicalMessages = systemMessages.length > 0 ? [...systemMessages, ...conversationMessages] : request.messages;
    const canonicalTools = request.tools ? _GeminiAgentBooster.canonicalizeTools(request.tools) : void 0;
    const resolvedThinkingBudget = request.thinkingBudget === "auto" ? _GeminiAgentBooster.computeDynamicThinkingBudget(request) : request.thinkingBudget;
    return {
      ...request,
      messages: canonicalMessages,
      tools: canonicalTools,
      thinkingBudget: resolvedThinkingBudget
    };
  }
  /**
   * Evaluates whether a request's static prefix (system instructions + tool definitions)
   * meets the token threshold for Google Context Caching (default: 32,768 tokens).
   */
  static evaluateContextCacheEligibility(request, minTokenThreshold = 32768) {
    const { systemText } = extractMessagesText(request.messages || []);
    const toolsJson = request.tools && request.tools.length > 0 ? JSON.stringify(_GeminiAgentBooster.canonicalizeTools(request.tools)) : "";
    const totalStaticChars = systemText.length + toolsJson.length;
    const estimatedPrefixTokens = Math.ceil(totalStaticChars / 4);
    const eligible = estimatedPrefixTokens >= minTokenThreshold;
    return {
      eligible,
      estimatedPrefixTokens,
      thresholdTokens: minTokenThreshold,
      estimatedSavingsRatio: eligible ? 0.75 : 0,
      systemText
    };
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

// src/utils/stream.ts
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

// src/providers/GeminiProvider.ts
var GEMINI_MODELS = {
  FLASH_3_8: "gemini-3.8-flash",
  FLASH_2_5: "gemini-2.5-flash",
  EMBEDDING_001: "gemini-embedding-001"};
var GEMINI_AVAILABILITY_FALLBACKS = {
  "gemini-4-pro": ["gemini-3.8-flash"],
  "gemini-4-argon": ["gemini-3.8-flash"]
};
var GEMINI_DEFAULT_PRICING = {
  "gemini-4-pro": { promptCostPer1k: 125e-5, completionCostPer1k: 5e-3 },
  "gemini-4-argon": { promptCostPer1k: 5e-4, completionCostPer1k: 2e-3 },
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
    if (this.config.fallbackModels) {
      return this.config.fallbackModels;
    }
    if (this.config.enableAvailabilityFallback) {
      const target = this.defaultModel || "gemini-4-pro";
      return GEMINI_AVAILABILITY_FALLBACKS[target] || [GEMINI_MODELS.FLASH_3_8];
    }
    return void 0;
  }
  /**
   * Returns the canonical availability fallback models for a given Gemini frontier model.
   */
  static getAvailabilityFallbacks(model) {
    return GEMINI_AVAILABILITY_FALLBACKS[model] || [];
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
    const rawThinkingBudget = request.thinkingBudget ?? this.config.thinkingBudget;
    let thinkingBudget;
    if (rawThinkingBudget === "auto") {
      thinkingBudget = GeminiAgentBooster.computeDynamicThinkingBudget(request);
    } else {
      thinkingBudget = rawThinkingBudget;
    }
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
      const canonicalTools = GeminiAgentBooster.canonicalizeTools(
        request.tools
      );
      tools.push({
        functionDeclarations: canonicalTools.map((t) => ({
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
    const url = `${baseUrl}/models/${targetModel}:${endpoint}`;
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
          "x-goog-api-key": this.config.apiKey || ""
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal
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
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
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
                if (tc.function?.name) {
                  if (!existing.name) {
                    existing.name = tc.function.name;
                  } else if (existing.name !== tc.function.name && !existing.name.includes(tc.function.name)) {
                    existing.name += tc.function.name;
                  }
                }
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

// src/core/AgentSwarm.ts
var AgentWalletExceededError = class extends Error {
  agentId;
  limitUsd;
  currentCostUsd;
  constructor(agentId, currentCostUsd, limitUsd) {
    super(
      `Agent "${agentId}" exceeded allocated budget wallet: $${currentCostUsd.toFixed(4)} (limit: $${limitUsd})`
    );
    this.name = "AgentWalletExceededError";
    this.agentId = agentId;
    this.currentCostUsd = currentCostUsd;
    this.limitUsd = limitUsd;
  }
};
var SwarmContext = class {
  store = /* @__PURE__ */ new Map();
  constructor(initialData) {
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) {
        this.store.set(key, value);
      }
    }
  }
  get(key) {
    return this.store.get(key);
  }
  set(key, value) {
    this.store.set(key, value);
    return this;
  }
  has(key) {
    return this.store.has(key);
  }
  delete(key) {
    return this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  getAll() {
    return Object.fromEntries(this.store.entries());
  }
  toPromptSection() {
    if (this.store.size === 0) return "";
    return `

[SHARED SWARM CONTEXT]:
${JSON.stringify(this.getAll(), null, 2)}`;
  }
};
var AgentSwarm = class {
  client;
  agents = /* @__PURE__ */ new Map();
  defaultAgentId;
  maxHandoffs;
  defaultModel;
  constructor(client, options) {
    this.client = client;
    this.maxHandoffs = options.maxHandoffs ?? 10;
    this.defaultModel = options.defaultModel;
    if (!options.agents || options.agents.length === 0) {
      throw new Error("AgentSwarm requires at least one specialist agent.");
    }
    for (const agent of options.agents) {
      this.agents.set(agent.id, agent);
    }
    this.defaultAgentId = options.defaultAgentId || options.agents[0].id;
    if (!this.agents.has(this.defaultAgentId)) {
      throw new Error(
        `Default agent ID "${this.defaultAgentId}" is not in the registered agents list.`
      );
    }
  }
  /**
   * Get an agent by its ID
   */
  getAgent(id) {
    return this.agents.get(id);
  }
  /**
   * List all registered swarm agents
   */
  listAgents() {
    return Array.from(this.agents.values());
  }
  /**
   * Export A2A Agent Cards for all registered agents in this swarm
   */
  exportAgentCards(baseUrl) {
    return Array.from(this.agents.values()).map((agent) => ({
      name: agent.name,
      description: `${agent.role}: ${agent.instructions.slice(0, 200)}`,
      url: baseUrl ? `${baseUrl.replace(/\/$/, "")}/agents/${agent.id}` : void 0,
      version: "2.11.0",
      capabilities: {
        streaming: true,
        handoffs: agent.handoffs && agent.handoffs.length > 0 || false
      },
      skills: agent.skills || [
        {
          id: `${agent.id}-core`,
          name: agent.name,
          description: agent.role,
          tags: [agent.id, "sinapsai-swarm"],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"]
        }
      ]
    }));
  }
  /**
   * Synthesize handoff tool definitions for an agent
   */
  getHandoffTools(agent) {
    if (!agent.handoffs || agent.handoffs.length === 0) {
      return [];
    }
    const tools = [];
    for (const targetId of agent.handoffs) {
      const target = this.agents.get(targetId);
      if (!target) continue;
      tools.push({
        type: "function",
        function: {
          name: `transfer_to_${target.id}`,
          description: `Delegate the task to ${target.name} (${target.role}). ${target.instructions.slice(0, 140)}`,
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description: "Detailed explanation of why you are transferring this task"
              },
              context_updates: {
                type: "object",
                description: "Key-value state updates to commit to shared memory before handoff",
                additionalProperties: true
              }
            },
            required: ["reason"]
          }
        }
      });
    }
    return tools;
  }
  /**
   * Compile full tool list for an agent, combining its specific tools, client.mcp tools, and handoff tools
   */
  compileAgentTools(agent) {
    const handoffTools = this.getHandoffTools(agent);
    const mcpTools = this.client.mcp.toUnifiedTools();
    if (agent.tools) {
      return [...agent.tools, ...handoffTools];
    }
    return [...mcpTools, ...handoffTools];
  }
  /**
   * Run the multi-agent swarm to completion (non-streaming)
   */
  async run(options) {
    const context = new SwarmContext(options.context);
    let activeAgentId = options.initialAgentId || this.defaultAgentId;
    let handoffCount = 0;
    let totalSteps = 0;
    const agentSteps = {};
    const agentSpendBreakdown = {};
    const startCost = this.client.getMetrics().estimatedCostUsd;
    const history = options.messages ? [...options.messages] : [];
    if (options.task && history.length === 0) {
      history.push({ role: "user", content: options.task });
    }
    while (handoffCount <= this.maxHandoffs) {
      const agent = this.agents.get(activeAgentId);
      if (!agent) {
        throw new Error(`Active agent "${activeAgentId}" not found in Swarm.`);
      }
      agentSteps[activeAgentId] = (agentSteps[activeAgentId] || 0) + 1;
      totalSteps++;
      const systemContent = `${agent.instructions}

You are specialist: ${agent.name} (${agent.role}).${context.toPromptSection()}`;
      const stepMessages = [
        { role: "system", content: systemContent },
        ...history.filter((m) => m.role !== "system")
      ];
      const tools = this.compileAgentTools(agent);
      const req = {
        model: agent.model || this.defaultModel || "default",
        messages: stepMessages,
        tools: tools.length > 0 ? tools : void 0,
        thinkingBudget: agent.thinkingBudget
      };
      const response = await this.client.chat.completions.create(
        req
      );
      const choice = response.choices[0];
      if (!choice) {
        break;
      }
      const usage = response.usage;
      const promptTokens = usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completionTokens ?? usage?.completion_tokens ?? 0;
      const stepTokens = usage?.totalTokens ?? usage?.total_tokens ?? promptTokens + completionTokens;
      const stepCost = response.costUsd ?? promptTokens * 15e-7 + completionTokens * 2e-6;
      if (!agentSpendBreakdown[activeAgentId]) {
        agentSpendBreakdown[activeAgentId] = { costUsd: 0, tokens: 0 };
      }
      agentSpendBreakdown[activeAgentId].costUsd = Number(
        (agentSpendBreakdown[activeAgentId].costUsd + stepCost).toFixed(6)
      );
      agentSpendBreakdown[activeAgentId].tokens += stepTokens;
      if (agent.wallet) {
        if (agent.wallet.maxCostUsd !== void 0 && agentSpendBreakdown[activeAgentId].costUsd > agent.wallet.maxCostUsd) {
          throw new AgentWalletExceededError(
            activeAgentId,
            agentSpendBreakdown[activeAgentId].costUsd,
            agent.wallet.maxCostUsd
          );
        }
        if (agent.wallet.maxTokens !== void 0 && agentSpendBreakdown[activeAgentId].tokens > agent.wallet.maxTokens) {
          throw new AgentWalletExceededError(
            activeAgentId,
            agentSpendBreakdown[activeAgentId].tokens,
            agent.wallet.maxTokens
          );
        }
      }
      const msg = choice.message;
      history.push(msg);
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        let delegatedTo;
        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          if (fnName.startsWith("transfer_to_")) {
            const targetId = fnName.replace("transfer_to_", "");
            if (this.agents.has(targetId)) {
              delegatedTo = targetId;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || "{}");
              } catch {
                parsedArgs = {};
              }
              if (parsedArgs.context_updates) {
                for (const [k, v] of Object.entries(
                  parsedArgs.context_updates
                )) {
                  context.set(k, v);
                }
              }
              history.push({
                role: "tool",
                tool_call_id: tc.id,
                name: fnName,
                content: JSON.stringify({
                  status: "transferred",
                  targetAgent: targetId,
                  reason: parsedArgs.reason || "Delegated to specialist"
                })
              });
              break;
            }
          }
        }
        if (delegatedTo) {
          handoffCount++;
          activeAgentId = delegatedTo;
          continue;
        }
        const toolResults = await this.client.mcp.executeToolCalls(
          msg.tool_calls
        );
        for (const tr of toolResults) {
          history.push(tr);
        }
        continue;
      }
      const finalContent = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join("") : "";
      const endCost2 = this.client.getMetrics().estimatedCostUsd;
      const totalCostUsd2 = Number(Math.max(0, endCost2 - startCost).toFixed(6));
      return {
        content: finalContent,
        finalAgentId: activeAgentId,
        history,
        sharedContext: context.getAll(),
        totalSteps,
        totalHandoffs: handoffCount,
        agentSteps,
        totalCostUsd: totalCostUsd2,
        agentSpendBreakdown
      };
    }
    const lastMsg = history[history.length - 1];
    const endCost = this.client.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));
    return {
      content: typeof lastMsg?.content === "string" ? lastMsg.content : "Max handoffs reached.",
      finalAgentId: activeAgentId,
      history,
      sharedContext: context.getAll(),
      totalSteps,
      totalHandoffs: handoffCount,
      agentSteps,
      totalCostUsd,
      agentSpendBreakdown
    };
  }
  /**
   * Run the multi-agent swarm with real-time streaming events
   */
  async *runStream(options) {
    const context = new SwarmContext(options.context);
    let activeAgentId = options.initialAgentId || this.defaultAgentId;
    let handoffCount = 0;
    let totalSteps = 0;
    const agentSteps = {};
    const agentSpendBreakdown = {};
    const startCost = this.client.getMetrics().estimatedCostUsd;
    const history = options.messages ? [...options.messages] : [];
    if (options.task && history.length === 0) {
      history.push({ role: "user", content: options.task });
    }
    while (handoffCount <= this.maxHandoffs) {
      const agent = this.agents.get(activeAgentId);
      if (!agent) {
        throw new Error(`Active agent "${activeAgentId}" not found in Swarm.`);
      }
      agentSteps[activeAgentId] = (agentSteps[activeAgentId] || 0) + 1;
      totalSteps++;
      yield {
        type: "agent-start",
        agentId: activeAgentId,
        agentName: agent.name,
        step: totalSteps,
        handoffCount
      };
      const systemContent = `${agent.instructions}

You are specialist: ${agent.name} (${agent.role}).${context.toPromptSection()}`;
      const stepMessages = [
        { role: "system", content: systemContent },
        ...history.filter((m) => m.role !== "system")
      ];
      const tools = this.compileAgentTools(agent);
      const req = {
        model: agent.model || this.defaultModel || "default",
        messages: stepMessages,
        tools: tools.length > 0 ? tools : void 0,
        thinkingBudget: agent.thinkingBudget,
        stream: true
      };
      const stream = await this.client.chat.completions.create(
        req
      );
      let contentAcc = "";
      let reasoningAcc = "";
      const toolCallsMap = /* @__PURE__ */ new Map();
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoningAcc += delta.reasoning_content;
          yield {
            type: "reasoning-delta",
            agentId: activeAgentId,
            reasoningDelta: delta.reasoning_content,
            chunk
          };
        }
        if (typeof delta.content === "string" && delta.content) {
          contentAcc += delta.content;
          yield {
            type: "text-delta",
            agentId: activeAgentId,
            textDelta: delta.content,
            chunk
          };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || {
              id: "",
              name: "",
              arguments: ""
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
            toolCallsMap.set(idx, existing);
          }
        }
      }
      const assembledToolCalls = Array.from(toolCallsMap.entries()).sort(([a], [b]) => a - b).map(([idx, tc]) => ({
        id: tc.id || `call_${totalSteps}_${idx}`,
        type: "function",
        function: {
          name: tc.name,
          arguments: tc.arguments || "{}"
        }
      }));
      const assistantMsg = {
        role: "assistant",
        content: contentAcc,
        reasoning_content: reasoningAcc || void 0,
        tool_calls: assembledToolCalls.length > 0 ? assembledToolCalls : void 0
      };
      history.push(assistantMsg);
      if (assembledToolCalls.length > 0) {
        yield {
          type: "tool-call-start",
          agentId: activeAgentId,
          toolCalls: assembledToolCalls
        };
        let delegatedTo;
        for (const tc of assembledToolCalls) {
          const fnName = tc.function.name;
          if (fnName.startsWith("transfer_to_")) {
            const targetId = fnName.replace("transfer_to_", "");
            if (this.agents.has(targetId)) {
              delegatedTo = targetId;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || "{}");
              } catch {
                parsedArgs = {};
              }
              if (parsedArgs.context_updates) {
                for (const [k, v] of Object.entries(
                  parsedArgs.context_updates
                )) {
                  context.set(k, v);
                }
              }
              yield {
                type: "handoff",
                fromAgentId: activeAgentId,
                toAgentId: targetId,
                reason: parsedArgs.reason || "Delegated to specialist",
                contextUpdates: parsedArgs.context_updates
              };
              history.push({
                role: "tool",
                tool_call_id: tc.id,
                name: fnName,
                content: JSON.stringify({
                  status: "transferred",
                  targetAgent: targetId,
                  reason: parsedArgs.reason || "Delegated to specialist"
                })
              });
              break;
            }
          }
        }
        if (delegatedTo) {
          handoffCount++;
          activeAgentId = delegatedTo;
          continue;
        }
        const toolResults = await this.client.mcp.executeToolCalls(assembledToolCalls);
        for (const tr of toolResults) {
          history.push(tr);
        }
        yield {
          type: "tool-call-result",
          agentId: activeAgentId,
          toolCalls: assembledToolCalls,
          results: toolResults
        };
        continue;
      }
      const endCost2 = this.client.getMetrics().estimatedCostUsd;
      const totalCostUsd2 = Number(Math.max(0, endCost2 - startCost).toFixed(6));
      const result2 = {
        content: contentAcc,
        finalAgentId: activeAgentId,
        history,
        sharedContext: context.getAll(),
        totalSteps,
        totalHandoffs: handoffCount,
        agentSteps,
        totalCostUsd: totalCostUsd2,
        agentSpendBreakdown
      };
      yield {
        type: "done",
        result: result2
      };
      return;
    }
    const endCost = this.client.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));
    const result = {
      content: "Max handoffs reached.",
      finalAgentId: activeAgentId,
      history,
      sharedContext: context.getAll(),
      totalSteps,
      totalHandoffs: handoffCount,
      agentSteps,
      totalCostUsd
    };
    yield {
      type: "done",
      result
    };
  }
};

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

// src/core/ConsensusEngine.ts
function computeTermFrequencyVector(text, vocabulary) {
  const vec = new Array(vocabulary.size).fill(0);
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const word of words) {
    const idx = vocabulary.get(word);
    if (idx !== void 0) {
      vec[idx] += 1;
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}
function calculatePairwiseSimilarity(vectors) {
  if (vectors.length < 2) return 1;
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const sim = Math.max(0, cosineSimilarity(vectors[i], vectors[j]));
      totalSim += sim;
      pairs++;
    }
  }
  return pairs > 0 ? Number((totalSim / pairs).toFixed(4)) : 1;
}
var ConsensusEngine = class {
  /**
   * Executes multi-model speculative drafting and consensus arbitration.
   */
  async execute(client, options) {
    const start = Date.now();
    const threshold = options.consensusThreshold ?? 0.85;
    const extractText = (res) => {
      const c = res.choices?.[0]?.message?.content;
      return typeof c === "string" ? c : JSON.stringify(c ?? "");
    };
    if (!options.draftModels || options.draftModels.length === 0) {
      throw new Error(
        "ConsensusEngine requires at least one draftModel in draftModels array."
      );
    }
    const draftPromises = options.draftModels.map(async (model) => {
      const draftStart = Date.now();
      const res = await client.chat.completions.create({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens,
        signal: options.signal
      });
      const latencyMs = Date.now() - draftStart;
      const text = res.choices?.[0]?.message?.content || "";
      return {
        model,
        provider: res.provider,
        response: res,
        latencyMs,
        text
      };
    });
    const settled = await Promise.allSettled(draftPromises);
    const successfulDrafts = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.text.trim().length > 0) {
        successfulDrafts.push(s.value);
      }
    }
    if (successfulDrafts.length === 0) {
      const firstRejected = settled.find((s) => s.status === "rejected");
      throw firstRejected?.reason ?? new Error("All candidate draft models failed to produce a response.");
    }
    if (successfulDrafts.length === 1) {
      return {
        finalResponse: successfulDrafts[0].response,
        synthesizedText: extractText(successfulDrafts[0].response),
        consensusReached: true,
        averageSimilarity: 1,
        consensusScore: 1,
        drafts: successfulDrafts,
        escalatedToJudge: false,
        judgeEscalated: false,
        totalDurationMs: Date.now() - start
      };
    }
    let vectors = [];
    const embedFn = options.customEmbed;
    if (embedFn) {
      vectors = await Promise.all(successfulDrafts.map((d) => embedFn(d.text)));
    } else {
      const vocab = /* @__PURE__ */ new Map();
      let vocabIdx = 0;
      for (const d of successfulDrafts) {
        const words = d.text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
        for (const w of words) {
          if (!vocab.has(w)) {
            vocab.set(w, vocabIdx++);
          }
        }
      }
      vectors = successfulDrafts.map(
        (d) => computeTermFrequencyVector(d.text, vocab)
      );
    }
    const averageSimilarity = calculatePairwiseSimilarity(vectors);
    const consensusReached = averageSimilarity >= threshold;
    if (consensusReached || !options.judgeModel) {
      const best = [...successfulDrafts].sort(
        (a, b) => a.latencyMs - b.latencyMs
      )[0];
      return {
        finalResponse: best.response,
        synthesizedText: extractText(best.response),
        consensusReached,
        averageSimilarity,
        consensusScore: averageSimilarity,
        drafts: successfulDrafts,
        escalatedToJudge: false,
        judgeEscalated: false,
        totalDurationMs: Date.now() - start
      };
    }
    const userPromptText = options.messages.filter((m) => m.role === "user").map(
      (m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    ).join("\n");
    const draftEvidence = successfulDrafts.map(
      (d, i) => `### Candidate Draft ${i + 1} (${d.model} | ${d.latencyMs}ms):
${d.text}`
    ).join("\n\n");
    const judgePrompt = [
      {
        role: "system",
        content: "You are an expert Supreme AI Arbitrator. Multiple independent AI models produced divergent answers for the user request. Analyze the candidate drafts, cross-verify claims, eliminate hallucinations, and synthesize the single authoritative, complete, and accurate final response."
      },
      {
        role: "user",
        content: `User Request:
"""
${userPromptText}
"""

Candidate Drafts:
${draftEvidence}

Please deliver the definitive answer:`
      }
    ];
    const judgeResponse = await client.chat.completions.create({
      model: options.judgeModel,
      messages: judgePrompt,
      temperature: 0.1,
      signal: options.signal
    });
    return {
      finalResponse: judgeResponse,
      synthesizedText: extractText(judgeResponse),
      consensusReached: false,
      averageSimilarity,
      consensusScore: averageSimilarity,
      drafts: successfulDrafts,
      escalatedToJudge: true,
      judgeEscalated: true,
      judgeModel: options.judgeModel,
      judgeResponse,
      totalDurationMs: Date.now() - start
    };
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

// src/core/EpisodicMemory.ts
function createFastTfEmbedding(text, dimensions = 64) {
  const vec = new Array(dimensions).fill(0);
  const clean = text.toLowerCase().replace(/[^\w\s]/g, " ");
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % dimensions;
    vec[bucket] += 2;
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const trigram = word.substring(j, j + 3);
        let triHash = 0;
        for (let k = 0; k < trigram.length; k++) {
          triHash = (triHash << 5) - triHash + trigram.charCodeAt(k);
          triHash |= 0;
        }
        vec[Math.abs(triHash) % dimensions] += 1;
      }
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}
var EpisodicMemory = class {
  records = /* @__PURE__ */ new Map();
  options;
  constructor(options = {}) {
    this.options = {
      defaultMinSimilarity: options.defaultMinSimilarity ?? 0.05,
      ...options
    };
  }
  /**
   * Retrieves a memory record by ID.
   */
  get(id) {
    return this.records.get(id);
  }
  /**
   * Generates a numeric vector embedding for text using customEmbed or fast local TF vectorizer.
   */
  async getEmbedding(text) {
    if (this.options.customEmbed) {
      return this.options.customEmbed(text);
    }
    return createFastTfEmbedding(text, 64);
  }
  /**
   * Stores a new memory fact or interaction.
   */
  async store(options) {
    const raw = options.text ?? options.content ?? "";
    const text = typeof raw === "string" ? raw.trim() : String(raw).trim();
    if (!text) {
      throw new Error("Memory text must not be empty.");
    }
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const embedding = options.embedding ?? await this.getEmbedding(text);
    const now = Date.now();
    const record = {
      id,
      userId: options.userId,
      text,
      content: text,
      metadata: options.metadata,
      embedding,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(id, record);
    if (this.options.storage) {
      await this.options.storage.set(`sinaps_mem_${id}`, record);
    }
    return record;
  }
  /**
   * Recalls semantically relevant memory facts for a query.
   */
  async recall(options) {
    const query = options.query.trim();
    if (!query) return [];
    const topK = options.topK ?? 3;
    const minSim = options.minScore ?? options.minSimilarity ?? this.options.defaultMinSimilarity ?? 0.5;
    const queryVec = options.queryEmbedding ?? await this.getEmbedding(query);
    const scored = [];
    for (const record of this.records.values()) {
      if (options.userId && record.userId && record.userId !== options.userId) {
        continue;
      }
      if (options.filter && !options.filter(record)) {
        continue;
      }
      const similarity = cosineSimilarity(queryVec, record.embedding);
      if (similarity >= minSim) {
        scored.push({ record, similarity: Number(similarity.toFixed(4)) });
      }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }
  /**
   * Injects recalled memories directly into messages as a system instruction context block.
   */
  async injectContext(messages, query, options = {}) {
    const memories = await this.recall({ ...options, query });
    if (memories.length === 0) {
      return messages;
    }
    const contextText = [
      "[LONG-TERM EPISODIC MEMORY / USER FACTS]",
      ...memories.map(
        (m) => `- ${m.record.text} (Relevance: ${(m.similarity * 100).toFixed(0)}%)`
      )
    ].join("\n");
    const result = [...messages];
    const systemIdx = result.findIndex((m) => m.role === "system");
    if (systemIdx >= 0) {
      const existing = result[systemIdx];
      const existingContent = typeof existing.content === "string" ? existing.content : Array.isArray(existing.content) ? existing.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "";
      result[systemIdx] = {
        role: "system",
        content: `${existingContent}

${contextText}`
      };
    } else {
      result.unshift({
        role: "system",
        content: contextText
      });
    }
    return result;
  }
  /**
   * Alias for injectContext with explicit userId parameter.
   */
  async injectIntoMessages(messages, query, userId, options = {}) {
    return this.injectContext(messages, query, { ...options, userId });
  }
  /**
   * Deletes a memory record by ID.
   */
  async delete(id) {
    const existed = this.records.delete(id);
    if (this.options.storage) {
      await this.options.storage.delete(`sinaps_mem_${id}`);
    }
    return existed;
  }
  /**
   * Clears memory records, optionally filtered by userId.
   */
  async clear(userId) {
    if (userId) {
      for (const [id, record] of this.records.entries()) {
        if (record.userId === userId) {
          this.records.delete(id);
          if (this.options.storage) {
            await this.options.storage.delete(`sinaps_mem_${id}`);
          }
        }
      }
    } else {
      this.records.clear();
      if (this.options.storage && typeof this.options.storage.clear === "function") {
        await this.options.storage.clear();
      }
    }
  }
  /**
   * Returns total count of stored records.
   */
  count(userId) {
    if (!userId) return this.records.size;
    let c = 0;
    for (const r of this.records.values()) {
      if (r.userId === userId) c++;
    }
    return c;
  }
};

// src/core/HybridRag.ts
function chunkDocument(documentIdOrText, textOrOptions, metadata, options = {}) {
  let documentId;
  let text;
  let opts;
  let meta;
  if (typeof textOrOptions === "string") {
    documentId = documentIdOrText;
    text = textOrOptions;
    meta = metadata;
    opts = options;
  } else {
    documentId = "doc";
    text = documentIdOrText;
    opts = textOrOptions || {};
    meta = metadata;
  }
  const maxSize = opts.maxChunkSize ?? 800;
  const overlap = opts.overlap ?? 100;
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return [];
  }
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentBuffer = "";
  let chunkIdx = 0;
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (currentBuffer.length + trimmed.length + 2 <= maxSize) {
      currentBuffer = currentBuffer.length > 0 ? `${currentBuffer}

${trimmed}` : trimmed;
    } else {
      if (currentBuffer.length > 0) {
        chunks.push({
          id: `${documentId}_chunk_${chunkIdx}`,
          documentId,
          chunkIndex: chunkIdx++,
          text: currentBuffer,
          metadata: meta,
          tokenCount: Math.ceil(currentBuffer.length / 4)
        });
        const overlapStart = Math.max(0, currentBuffer.length - overlap);
        currentBuffer = currentBuffer.substring(overlapStart).trim();
      }
      if (trimmed.length > maxSize) {
        let segments = trimmed.split(/(?<=[.!?])\s+/);
        if (segments.length <= 1) {
          segments = trimmed.split(/\s+/);
        }
        for (const s of segments) {
          if (currentBuffer.length + s.length + 1 <= maxSize) {
            currentBuffer = currentBuffer.length > 0 ? `${currentBuffer} ${s}` : s;
          } else {
            if (currentBuffer.length > 0) {
              chunks.push({
                id: `${documentId}_chunk_${chunkIdx}`,
                documentId,
                chunkIndex: chunkIdx++,
                text: currentBuffer,
                metadata: meta,
                tokenCount: Math.ceil(currentBuffer.length / 4)
              });
              const overlapStart = Math.max(0, currentBuffer.length - overlap);
              currentBuffer = currentBuffer.substring(overlapStart).trim();
            }
            currentBuffer = currentBuffer.length > 0 ? `${currentBuffer} ${s}` : s;
          }
        }
      } else {
        currentBuffer = currentBuffer.length > 0 ? `${currentBuffer}

${trimmed}` : trimmed;
      }
    }
  }
  if (currentBuffer.length > 0) {
    chunks.push({
      id: `${documentId}_chunk_${chunkIdx}`,
      documentId,
      chunkIndex: chunkIdx,
      text: currentBuffer,
      metadata: meta,
      tokenCount: Math.ceil(currentBuffer.length / 4)
    });
  }
  return chunks;
}
var Bm25Index = class {
  k1 = 1.5;
  b = 0.75;
  docFrequencies = /* @__PURE__ */ new Map();
  docLengths = /* @__PURE__ */ new Map();
  termFrequencies = /* @__PURE__ */ new Map();
  // docId -> (term -> count)
  totalDocs = 0;
  totalLength = 0;
  tokenize(text) {
    if (!text || typeof text !== "string") return [];
    return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  }
  add(docId, text) {
    const terms = this.tokenize(text);
    const length = terms.length;
    this.docLengths.set(docId, length);
    this.totalLength += length;
    this.totalDocs++;
    const tf = /* @__PURE__ */ new Map();
    const seenTerms = /* @__PURE__ */ new Set();
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
      if (!seenTerms.has(term)) {
        seenTerms.add(term);
        this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
      }
    }
    this.termFrequencies.set(docId, tf);
  }
  addDocument(docId, text) {
    this.add(docId, text);
  }
  scoreMap(query) {
    const queryTerms = this.tokenize(query);
    const scores = /* @__PURE__ */ new Map();
    if (this.totalDocs === 0 || queryTerms.length === 0) return scores;
    const avgdl = this.totalLength / this.totalDocs;
    for (const term of queryTerms) {
      const df = this.docFrequencies.get(term) || 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5));
      for (const [docId, tfMap] of this.termFrequencies.entries()) {
        const tf = tfMap.get(term) || 0;
        if (tf === 0) continue;
        const docLen = this.docLengths.get(docId) || avgdl;
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
        const termScore = idf * (numerator / denominator);
        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }
    return scores;
  }
  score(query) {
    const scores = this.scoreMap(query);
    return Array.from(scores.entries()).map(([id, score]) => ({ id, score: Number(score.toFixed(4)) })).sort((a, b) => b.score - a.score);
  }
};
function reciprocalRankFusion(bm25Input, vectorInput, k = 60, bm25Weight = 0.5, vectorWeight = 0.5) {
  const toRankedIds = (input) => {
    if (Array.isArray(input)) return input;
    return Array.from(input.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };
  const bm25RankedIds = toRankedIds(bm25Input);
  const vectorRankedIds = toRankedIds(vectorInput);
  const combined = /* @__PURE__ */ new Map();
  bm25RankedIds.forEach((id, rank) => {
    const rrf = 1 / (k + rank + 1) * bm25Weight;
    const entry = combined.get(id) || { id, score: 0 };
    entry.score += rrf;
    entry.bm25Rank = rank + 1;
    combined.set(id, entry);
  });
  vectorRankedIds.forEach((id, rank) => {
    const rrf = 1 / (k + rank + 1) * vectorWeight;
    const entry = combined.get(id) || { id, score: 0 };
    entry.score += rrf;
    entry.vectorRank = rank + 1;
    combined.set(id, entry);
  });
  return Array.from(combined.values()).sort((a, b) => b.score - a.score);
}
var HybridRagEngine = class {
  chunks = /* @__PURE__ */ new Map();
  bm25 = new Bm25Index();
  options;
  constructor(options = {}) {
    this.options = options;
  }
  /**
   * Adds and indexes a full text document with automatic chunking.
   */
  async addDocument(documentId, text, metadata) {
    const createdChunks = chunkDocument(
      documentId,
      text,
      metadata,
      this.options.chunkOptions
    );
    for (const chunk of createdChunks) {
      if (this.options.customEmbed) {
        chunk.embedding = await this.options.customEmbed(chunk.text);
      }
      this.chunks.set(chunk.id, chunk);
      this.bm25.add(chunk.id, chunk.text);
    }
    return createdChunks;
  }
  /**
   * Executes hybrid search using BM25, dense vector cosine similarity, and RRF ranking.
   */
  async search(queryOrOptions, options) {
    const query = typeof queryOrOptions === "string" ? queryOrOptions : queryOrOptions.query || "";
    const opts = typeof queryOrOptions === "string" ? options || {} : queryOrOptions;
    const topK = opts.topK ?? 5;
    const weight = opts.hybridWeight ?? 0.5;
    const bm25Ranked = this.bm25.score(query).map((r) => r.id);
    const vectorScores = /* @__PURE__ */ new Map();
    let queryVec = opts.queryEmbedding;
    if (!queryVec && this.options.customEmbed && query.length > 0) {
      queryVec = await this.options.customEmbed(query);
    }
    if (queryVec && queryVec.length > 0) {
      for (const chunk of this.chunks.values()) {
        if (chunk.embedding && chunk.embedding.length > 0) {
          const sim = Math.max(0, cosineSimilarity(queryVec, chunk.embedding));
          vectorScores.set(chunk.id, sim);
        }
      }
    }
    const vectorRanked = Array.from(vectorScores.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const fused = reciprocalRankFusion(
      bm25Ranked,
      vectorRanked,
      60,
      1 - weight,
      weight
    );
    const sortedIds = fused.slice(0, topK);
    const results = [];
    for (const item of sortedIds) {
      const chunk = this.chunks.get(item.id);
      if (chunk) {
        results.push({
          chunk,
          score: Number(item.score.toFixed(6)),
          rrfScore: Number(item.score.toFixed(6)),
          denseScore: vectorScores.get(item.id) ?? 0.5,
          bm25Rank: item.bm25Rank,
          vectorRank: item.vectorRank
        });
      }
    }
    return results;
  }
  /**
   * Formats search results into a clean context block ready for system instructions.
   */
  formatForPrompt(results) {
    if (results.length === 0) return "";
    const items = results.map(
      (r, i) => `[Source ${i + 1} (${r.chunk.documentId})]:
${r.chunk.text}`
    );
    return `[RETRIEVED KNOWLEDGE CONTEXT]
${items.join("\n\n")}`;
  }
  /**
   * Returns total chunk count in index.
   */
  getChunkCount() {
    return this.chunks.size;
  }
  /**
   * Alias for getChunkCount().
   */
  count() {
    return this.chunks.size;
  }
  /**
   * Deletes all chunks associated with a document ID.
   */
  deleteDocument(documentId) {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.documentId === documentId) {
        this.chunks.delete(id);
      }
    }
    this.bm25 = new Bm25Index();
    for (const chunk of this.chunks.values()) {
      this.bm25.add(chunk.id, chunk.text);
    }
  }
  /**
   * Clears all documents and resets the index.
   */
  clear() {
    this.chunks.clear();
    this.bm25 = new Bm25Index();
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
  async increment(key, ttlSeconds) {
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
    const expiresAt = existing?.expiresAt ?? (ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1e3 : null);
    this.store.set(key, {
      value: newValue,
      expiresAt
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

// src/core/LlmOptimizer.ts
var COMPLEX_REASONING_REGEX2 = /\b(architect(?:ure)?|refactor|optimiz(?:e|ation)|vulnerabilit(?:y|ies)|security\s+audit|prove|theorem|algorithm|concurren(?:t|cy)|deadlock|race\s+condition|distributed|microkernel|step[\s-]by[\s-]step|root\s+cause|stack\s+trace|benchmark|formal\s+verification|regex|memory\s+leak|reverse\s+engineer)\b/i;
var CODE_OR_MATH_REGEX2 = /```[\s\S]*?```|\b(?:function|class|interface|SELECT\s+.+\s+FROM|CREATE\s+TABLE|async\s+function|Promise\.all|TypeError:|ReferenceError:|Error:\s+at\s+)\b|\$\$[\s\S]+?\$\$/i;
var SIMPLE_INTENT_REGEX2 = /^(?:hi|hello|hey|halo|ping|ok|okay|thanks|thank\s+you|terima\s+kasih|yes|no|ya|tidak|translate\s+to\s+\w+:|classify\s*:)/i;
var AGGRESSIVE_FLUFF_REGEX = /^(?:(?:could|can|would)\s+you\s+(?:please\s+)?(?:help\s+me\s+)?(?:to\s+)?|please\s+(?:kindly\s+)?|kindly\s+|i\s+(?:would\s+like|want)\s+you\s+to\s+)/i;
var DEFAULT_CASCADE_TIERS = {
  tier1: "gemini-2.5-flash-lite",
  tier2: "gemini-2.5-flash",
  tier3: "gemini-2.5-pro"
};
function minifyProsePreservingCode(text, mode = "lossless") {
  if (!text || text.length === 0) {
    return text;
  }
  const codeBlockRegex = /(```[\s\S]*?```|````[\s\S]*?````)/g;
  const parts = text.split(codeBlockRegex);
  const processedParts = parts.map((part) => {
    if (part.startsWith("```") || part.startsWith("````")) {
      return part;
    }
    let p = part.replace(/\r\n/g, "\n");
    if (mode === "aggressive") {
      p = p.replace(AGGRESSIVE_FLUFF_REGEX, "");
    }
    p = p.replace(/[ \t]+/g, " ");
    p = p.split("\n").map((line) => line.trim()).join("\n");
    p = p.replace(/\n{3,}/g, "\n\n");
    return p;
  });
  return processedParts.join("").trim();
}
function deduplicateSystemInstructions(messages) {
  const systemMessages = [];
  const otherMessages = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemMessages.push(m);
    } else {
      otherMessages.push(m);
    }
  }
  if (systemMessages.length <= 1) {
    return messages;
  }
  const seenLines = /* @__PURE__ */ new Set();
  const combinedLines = [];
  for (const sm of systemMessages) {
    const content = typeof sm.content === "string" ? sm.content : Array.isArray(sm.content) ? sm.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "";
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        combinedLines.push("");
        continue;
      }
      if (!seenLines.has(trimmed)) {
        seenLines.add(trimmed);
        combinedLines.push(trimmed);
      }
    }
  }
  const mergedSystemContent = combinedLines.join("\n").replace(/\n{3,}/g, "\n\n");
  const mergedSystemMessage = {
    role: "system",
    content: mergedSystemContent
  };
  return [mergedSystemMessage, ...otherMessages];
}
function canonicalizeTools(tools) {
  if (!tools || tools.length === 0) {
    return tools;
  }
  return [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name)).map((tool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ? canonicalizeJsonValue(tool.function.parameters) : void 0
    }
  }));
}
var LlmOptimizer = class {
  options;
  metrics = {
    totalOptimizedRequests: 0,
    totalTokensSaved: 0,
    totalEstimatedUsdSaved: 0,
    averageCompressionRatio: 1,
    cascadedRequestsCount: 0
  };
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      minifyPrompts: options.minifyPrompts ?? true,
      minificationMode: options.minificationMode ?? "lossless",
      deduplicateSystem: options.deduplicateSystem ?? true,
      alignKvCachePrefix: options.alignKvCachePrefix ?? true,
      autoCascadeModel: options.autoCascadeModel ?? false,
      cascadeTiers: options.cascadeTiers ?? DEFAULT_CASCADE_TIERS,
      dynamicThinking: options.dynamicThinking ?? true
    };
  }
  /**
   * Analyzes prompt messages to calculate a normalized complexity score [0.0, 1.0],
   * complexity tier, and recommended model/thinking budget.
   */
  analyzeComplexity(messages, tiers = this.options.cascadeTiers ?? DEFAULT_CASCADE_TIERS) {
    const resolvedTiers = { ...DEFAULT_CASCADE_TIERS, ...tiers };
    const signals = [];
    let score = 0.2;
    let totalChars = 0;
    let hasCodeOrMath = false;
    let hasComplexReasoning = false;
    let hasSimpleIntent = false;
    for (const m of messages) {
      const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ") : "";
      totalChars += text.length;
      if (CODE_OR_MATH_REGEX2.test(text)) {
        hasCodeOrMath = true;
      }
      if (COMPLEX_REASONING_REGEX2.test(text)) {
        hasComplexReasoning = true;
      }
      if (m.role === "user" && SIMPLE_INTENT_REGEX2.test(text.trim())) {
        hasSimpleIntent = true;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        signals.push("tool_calling_history");
        score += 0.15;
      }
    }
    if (hasSimpleIntent && totalChars < 80 && !hasCodeOrMath && !hasComplexReasoning) {
      signals.push("simple_intent");
      score -= 0.15;
    }
    if (hasCodeOrMath) {
      signals.push("code_or_math_blocks");
      score += 0.3;
    }
    if (hasComplexReasoning) {
      signals.push("complex_reasoning_keywords");
      score += 0.35;
    }
    if (messages.length > 6) {
      signals.push("multi_turn_depth");
      score += 0.15;
    }
    if (totalChars > 4e3) {
      signals.push("long_context");
      score += 0.2;
    }
    score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
    let tier = "tier2";
    let recommendedBudget = 2048;
    let recommendedModel = resolvedTiers.tier2;
    if (score <= 0.35) {
      tier = "tier1";
      recommendedBudget = 0;
      recommendedModel = resolvedTiers.tier1;
    } else if (score > 0.7) {
      tier = "tier3";
      recommendedBudget = 8192;
      recommendedModel = resolvedTiers.tier3;
    }
    return {
      score,
      tier,
      signals,
      recommendedModel,
      recommendedThinkingBudget: recommendedBudget
    };
  }
  /**
   * Executes the full LLM Optimization pipeline on an incoming UnifiedApiRequest.
   */
  optimize(request, overrideOptions) {
    const isEnabled = this.options.enabled !== false;
    const originalTokens = estimateTotalTokens(request.messages);
    if (!isEnabled) {
      const complexity2 = this.analyzeComplexity(request.messages);
      return {
        messages: request.messages,
        originalTokens,
        optimizedTokens: originalTokens,
        tokensSaved: 0,
        savingsRatio: 0,
        complexity: complexity2,
        tools: request.tools,
        thinkingBudget: request.thinkingBudget
      };
    }
    let messages = [...request.messages];
    const shouldMinify = overrideOptions?.minify ?? this.options.minifyPrompts ?? true;
    const mode = overrideOptions?.mode ?? this.options.minificationMode ?? "lossless";
    if (this.options.deduplicateSystem) {
      messages = deduplicateSystemInstructions(messages);
    }
    if (shouldMinify) {
      messages = messages.map((m) => {
        if (typeof m.content === "string") {
          return {
            ...m,
            content: minifyProsePreservingCode(m.content, mode)
          };
        }
        if (Array.isArray(m.content)) {
          return {
            ...m,
            content: m.content.map((part) => {
              if (part.type === "text") {
                return {
                  ...part,
                  text: minifyProsePreservingCode(
                    part.text,
                    mode
                  )
                };
              }
              return part;
            })
          };
        }
        return m;
      });
    }
    let tools = request.tools;
    if (this.options.alignKvCachePrefix && tools) {
      tools = canonicalizeTools(tools);
    }
    const complexity = this.analyzeComplexity(messages);
    let cascadeModel;
    const shouldCascade = overrideOptions?.cascade ?? (this.options.autoCascadeModel || request.model === "auto");
    if (shouldCascade && complexity.recommendedModel) {
      cascadeModel = complexity.recommendedModel;
    }
    let thinkingBudget = request.thinkingBudget;
    if (this.options.dynamicThinking && thinkingBudget === void 0) {
      if (complexity.recommendedThinkingBudget !== void 0) {
        thinkingBudget = complexity.recommendedThinkingBudget;
      }
    }
    const optimizedTokens = estimateTotalTokens(messages);
    const tokensSaved = Math.max(0, originalTokens - optimizedTokens);
    const savingsRatio = originalTokens > 0 ? Number((tokensSaved / originalTokens).toFixed(4)) : 0;
    this.recordMetrics(
      tokensSaved,
      originalTokens,
      optimizedTokens,
      !!cascadeModel
    );
    return {
      messages,
      originalTokens,
      optimizedTokens,
      tokensSaved,
      savingsRatio,
      complexity,
      cascadeModel,
      tools,
      thinkingBudget
    };
  }
  recordMetrics(tokensSaved, originalTokens, optimizedTokens, cascaded) {
    this.metrics.totalOptimizedRequests++;
    this.metrics.totalTokensSaved += tokensSaved;
    this.metrics.totalEstimatedUsdSaved += tokensSaved / 1e3 * 3e-3;
    if (cascaded) {
      this.metrics.cascadedRequestsCount++;
    }
    const ratio = originalTokens > 0 ? optimizedTokens / originalTokens : 1;
    const n = this.metrics.totalOptimizedRequests;
    this.metrics.averageCompressionRatio = Number(
      ((this.metrics.averageCompressionRatio * (n - 1) + ratio) / n).toFixed(4)
    );
  }
  getMetrics() {
    return { ...this.metrics };
  }
  resetMetrics() {
    this.metrics = {
      totalOptimizedRequests: 0,
      totalTokensSaved: 0,
      totalEstimatedUsdSaved: 0,
      averageCompressionRatio: 1,
      cascadedRequestsCount: 0
    };
  }
};

// src/core/McpBridge.ts
function coerceToolArguments(args, schema) {
  if (!args || typeof args !== "object" || !schema?.properties) {
    return args;
  }
  const result = { ...args };
  for (const [key, prop] of Object.entries(schema.properties)) {
    const val = result[key];
    if (val === void 0 || val === null) continue;
    const propType = prop?.type;
    if ((propType === "number" || propType === "integer") && typeof val === "string") {
      const num = Number(val);
      if (!Number.isNaN(num)) {
        result[key] = num;
      }
    } else if (propType === "boolean" && typeof val === "string") {
      if (val.toLowerCase() === "true") result[key] = true;
      if (val.toLowerCase() === "false") result[key] = false;
    } else if (propType === "object" && typeof val === "string") {
      try {
        result[key] = JSON.parse(val);
      } catch {
      }
    }
  }
  return result;
}
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
    parsedArgs = coerceToolArguments(parsedArgs, toolDef.inputSchema);
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
      const errMsg = err.message;
      const propNames = toolDef.inputSchema?.properties ? Object.keys(toolDef.inputSchema.properties).join(", ") : "none";
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${toolName}': ${errMsg}`
          }
        ],
        isError: true,
        selfHealingHint: `Error executing tool '${toolName}': ${errMsg}. Hint: Verify input arguments against schema properties (${propNames}) and retry.`,
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
              version: "2.11.0"
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
    const ascendingMatches = [...matches].sort(
      (a, b) => a.startIndex - b.startIndex
    );
    for (const match of ascendingMatches) {
      if (!originalToToken.has(match.original)) {
        const token = this.tokenFormat.replace("{category}", match.category.toUpperCase()).replace("{index}", String(nextIndex++));
        vault.set(token, match.original);
        originalToToken.set(match.original, token);
      }
    }
    for (const match of matches) {
      const token = originalToToken.get(match.original);
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
  /**
   * Creates a stateful sliding-window string detokenizer for streaming chunks.
   * Only buffers characters when the tail of the current chunk matches a proper prefix
   * of an active token in the vault, guaranteeing 0ms buffering delay for normal text.
   */
  createStreamTextRestorer(vault) {
    const entries = vault instanceof Map ? Array.from(vault.entries()) : Object.entries(vault);
    const tokens = entries.map(([token]) => token).filter((t) => t.length > 0);
    const maxTokenLen = tokens.length > 0 ? Math.max(...tokens.map((t) => t.length)) : 0;
    let pending = "";
    return {
      push: (chunkText) => {
        if (tokens.length === 0) return chunkText;
        let combined = pending + chunkText;
        if (!combined) return "";
        for (const [token, original] of entries) {
          if (combined.includes(token)) {
            combined = combined.replaceAll(token, original);
          }
        }
        const maxCheck = Math.min(combined.length, maxTokenLen - 1);
        let matchedSuffixLen = 0;
        for (let len = maxCheck; len >= 1; len--) {
          const suffix = combined.slice(combined.length - len);
          if (tokens.some((t) => t.startsWith(suffix))) {
            matchedSuffixLen = len;
            break;
          }
        }
        if (matchedSuffixLen > 0) {
          const emit = combined.slice(0, combined.length - matchedSuffixLen);
          pending = combined.slice(combined.length - matchedSuffixLen);
          return emit;
        }
        pending = "";
        return combined;
      },
      flush: () => {
        if (!pending) return "";
        const finalOut = this.restore(pending, vault);
        pending = "";
        return finalOut;
      }
    };
  }
  /**
   * Transforms an async stream of UnifiedApiStreamChunk, seamlessly restoring
   * surrogate PII tokens even when split across multiple arbitrary SSE chunk boundaries.
   */
  restoreStream(stream, vault) {
    const entriesCount = vault instanceof Map ? vault.size : Object.keys(vault || {}).length;
    if (!vault || entriesCount === 0) {
      return stream;
    }
    const contentRestorer = this.createStreamTextRestorer(vault);
    const reasoningRestorer = this.createStreamTextRestorer(vault);
    const toolArgsRestorers = /* @__PURE__ */ new Map();
    const getToolRestorer = (index) => {
      let restorer = toolArgsRestorers.get(index);
      if (!restorer) {
        restorer = this.createStreamTextRestorer(vault);
        toolArgsRestorers.set(index, restorer);
      }
      return restorer;
    };
    return (async function* () {
      let lastChunkMeta = {
        id: "stream-flush",
        model: "default"
      };
      for await (const chunk of stream) {
        lastChunkMeta = {
          id: chunk.id,
          model: chunk.model,
          provider: chunk.provider
        };
        const restoredChoices = chunk.choices.map((choice) => {
          const delta = { ...choice.delta };
          if (typeof delta.content === "string") {
            delta.content = contentRestorer.push(delta.content);
          }
          if (typeof delta.reasoning_content === "string") {
            delta.reasoning_content = reasoningRestorer.push(
              delta.reasoning_content
            );
          }
          if (Array.isArray(delta.tool_calls)) {
            delta.tool_calls = delta.tool_calls.map((tc) => {
              if (tc.function?.arguments) {
                const restorer = getToolRestorer(tc.index ?? 0);
                return {
                  ...tc,
                  function: {
                    ...tc.function,
                    arguments: restorer.push(tc.function.arguments)
                  }
                };
              }
              return tc;
            });
          }
          if (choice.finishReason !== null) {
            const flushedContent = contentRestorer.flush();
            if (flushedContent) {
              delta.content = (delta.content ?? "") + flushedContent;
            }
            const flushedReasoning = reasoningRestorer.flush();
            if (flushedReasoning) {
              delta.reasoning_content = (delta.reasoning_content ?? "") + flushedReasoning;
            }
          }
          return {
            ...choice,
            delta
          };
        });
        yield {
          ...chunk,
          choices: restoredChoices
        };
      }
      const remainingContent = contentRestorer.flush();
      const remainingReasoning = reasoningRestorer.flush();
      if (remainingContent || remainingReasoning) {
        yield {
          id: lastChunkMeta.id,
          model: lastChunkMeta.model,
          provider: lastChunkMeta.provider,
          choices: [
            {
              delta: {
                role: "assistant",
                ...remainingContent ? { content: remainingContent } : {},
                ...remainingReasoning ? { reasoning_content: remainingReasoning } : {}
              },
              finishReason: null
            }
          ]
        };
      }
    })();
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
   * Matches a providerId against configured providerRules (supporting exact id or prefix match like 'groq-123' -> 'groq').
   */
  matchProviderRule(providerId) {
    if (!providerId || !this.options.providerRules) return null;
    if (this.options.providerRules[providerId]) {
      return {
        key: providerId,
        rule: this.options.providerRules[providerId]
      };
    }
    const lowerId = providerId.toLowerCase();
    for (const [ruleKey, rule] of Object.entries(this.options.providerRules)) {
      const lowerKey = ruleKey.toLowerCase();
      if (lowerId === lowerKey || lowerId.startsWith(`${lowerKey}-`)) {
        return { key: ruleKey, rule };
      }
    }
    return null;
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
    const matchedProvider = this.matchProviderRule(providerId);
    if (matchedProvider) {
      return matchedProvider.rule;
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
    const matchedProvider = this.matchProviderRule(checkOptions?.providerId);
    const scope = this.options.modelRules?.[request.model] ? "model" : matchedProvider ? "provider" : baseKey.startsWith("user:") ? "user" : "global";
    const scopeKey = scope === "model" ? `${baseKey}:m:${request.model}` : scope === "provider" && matchedProvider ? `${baseKey}:p:${matchedProvider.key}` : baseKey;
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
          providerId: matchedProvider?.key ?? checkOptions?.providerId
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
          providerId: matchedProvider?.key ?? checkOptions?.providerId
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
        await this.storage.increment(reqKeyCurrent, ttlSeconds);
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
    const matchedProvider = this.matchProviderRule(providerId);
    const scope = this.options.modelRules?.[request.model] ? "model" : matchedProvider ? "provider" : baseKey.startsWith("user:") ? "user" : "global";
    const scopeKey = scope === "model" ? `${baseKey}:m:${request.model}` : scope === "provider" && matchedProvider ? `${baseKey}:p:${matchedProvider.key}` : baseKey;
    const windowMs = rule.windowMs || 6e4;
    const currentWindowId = Math.floor(Date.now() / windowMs);
    const tokKeyCurrent = `gw:rl:tok:${scopeKey}:${currentWindowId}`;
    const curr = await this.storage.get(tokKeyCurrent) || 0;
    const updated = Math.max(0, curr + delta);
    const ttlSeconds = Math.ceil(windowMs * 2 / 1e3);
    await this.storage.set(tokKeyCurrent, updated, ttlSeconds);
  }
};

// src/core/RealtimeClient.ts
var RealtimeSession = class {
  ws = null;
  options;
  isAlive = false;
  constructor(options) {
    this.options = options;
  }
  /**
   * Resolves the WebSocket URL based on provider and model.
   */
  resolveUrl() {
    if (this.options.url) return this.options.url;
    const provider = this.options.provider || "openai";
    const model = this.options.model || (provider === "openai" ? "gpt-4o-realtime-preview" : "gemini-2.0-flash-exp");
    if (provider === "openai") {
      return `wss://api.openai.com/v1/realtime?model=${model}`;
    }
    if (provider === "gemini") {
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
    }
    throw new Error(
      `Unable to resolve WebSocket URL for custom provider without explicit options.url.`
    );
  }
  /**
   * Establishes real-time WebSocket connection.
   */
  async connect() {
    const targetUrl = this.resolveUrl();
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error(
        "WebSocket is not available in the current runtime environment."
      );
    }
    return new Promise((resolve, reject) => {
      try {
        const protocols = this.options.provider === "openai" ? ["realtime", `openai-insecure-api-key.${this.options.apiKey}`] : void 0;
        this.ws = protocols ? new WebSocketCtor(targetUrl, protocols) : new WebSocketCtor(targetUrl);
        this.ws.onopen = () => {
          this.isAlive = true;
          this.options.onOpen?.();
          this.initializeSession();
          resolve(this);
        };
        this.ws.onclose = (event) => {
          this.isAlive = false;
          this.options.onClose?.(event.code, event.reason);
        };
        this.ws.onerror = (_event) => {
          const err = new Error("Realtime WebSocket connection error.");
          this.options.onError?.(err);
          if (!this.isAlive) {
            reject(err);
          }
        };
        this.ws.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  /**
   * Sends initial session setup event.
   */
  initializeSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.options.provider === "openai") {
      const sessionUpdate = {
        type: "session.update",
        session: {
          modalities: this.options.modalities ?? ["text", "audio"],
          instructions: this.options.instructions ?? "You are a helpful real-time AI assistant.",
          voice: this.options.voice ?? "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5
          }
        }
      };
      this.ws.send(JSON.stringify(sessionUpdate));
    }
  }
  /**
   * Parses and dispatches incoming WebSocket message events.
   */
  handleIncomingMessage(rawData) {
    try {
      const text = typeof rawData === "string" ? rawData : String(rawData);
      const parsed = JSON.parse(text);
      this.options.onRawMessage?.(parsed);
      if (parsed.type === "response.audio_transcript.delta" && typeof parsed.delta === "string") {
        this.options.onTextDelta?.(parsed.delta);
      } else if (parsed.type === "response.audio.delta" && typeof parsed.delta === "string") {
        this.options.onAudioDelta?.(parsed.delta);
      } else if (parsed.type === "response.text.delta" && typeof parsed.delta === "string") {
        this.options.onTextDelta?.(parsed.delta);
      }
    } catch {
    }
  }
  /**
   * Sends a user text message turn.
   */
  sendText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime session is not open.");
    }
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    };
    this.ws.send(JSON.stringify(event));
    this.ws.send(JSON.stringify({ type: "response.create" }));
  }
  /**
   * Appends PCM16 audio chunks in base64 format.
   */
  sendAudio(base64Audio) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime session is not open.");
    }
    const event = {
      type: "input_audio_buffer.append",
      audio: base64Audio
    };
    this.ws.send(JSON.stringify(event));
  }
  /**
   * Commits the current audio buffer to trigger model response.
   */
  commitAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    this.ws.send(JSON.stringify({ type: "response.create" }));
  }
  /**
   * Closes the real-time WebSocket session.
   */
  close() {
    if (this.ws) {
      this.isAlive = false;
      this.ws.close();
      this.ws = null;
    }
  }
  get connected() {
    return this.isAlive && this.ws?.readyState === WebSocket.OPEN;
  }
};
var RealtimeClient = class {
  /**
   * Connects to a real-time multimodal session.
   */
  async connect(options) {
    const session = new RealtimeSession(options);
    return session.connect();
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
  const serviceVersion = options.serviceVersion || "2.11.0";
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
  /**
   * Returns the primary candidate provider ID according to the configured routing strategy.
   */
  getPrimaryCandidateProviderId(request) {
    if (this.providers.length === 0) return void 0;
    if (this.strategy === "load-balance") {
      return this.providers[this.currentProviderIndex % this.providers.length]?.id;
    }
    if (this.strategy === "lowest-cost" && request) {
      const sorted = [...this.providers].sort(
        (a, b) => this.estimateRequestCost(a, request) - this.estimateRequestCost(b, request)
      );
      return sorted[0]?.id;
    }
    if (this.strategy === "lowest-latency") {
      const sorted = [...this.providers].sort((a, b) => {
        const reqA = this.metrics.providerMetrics[a.id]?.requests ?? 0;
        const reqB = this.metrics.providerMetrics[b.id]?.requests ?? 0;
        if (reqA === 0 && reqB > 0) return -1;
        if (reqB === 0 && reqA > 0) return 1;
        const latA = this.metrics.providerMetrics[a.id]?.averageLatencyMs ?? 0;
        const latB = this.metrics.providerMetrics[b.id]?.averageLatencyMs ?? 0;
        return latA - latB;
      });
      return sorted[0]?.id;
    }
    if (this.strategy === "adaptive" || this.strategy === "smart-hybrid") {
      const sorted = [...this.providers].sort(
        (a, b) => this.calculateAdaptiveScore(b, request) - this.calculateAdaptiveScore(a, request)
      );
      return sorted[0]?.id;
    }
    return this.providers[0]?.id;
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
  hashString64(raw) {
    let h1 = 3735928559 ^ raw.length;
    let h2 = 1103547991 ^ raw.length;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }
  computeCacheKey(request) {
    const raw = JSON.stringify({
      m: request.model,
      msgs: request.messages,
      t: request.temperature,
      max: request.maxTokens,
      tools: request.tools ? GeminiAgentBooster.canonicalizeTools(request.tools) : void 0,
      tc: request.toolChoice,
      rf: request.responseFormat,
      tb: request.thinkingBudget,
      re: request.reasoningEffort,
      cc: request.cachedContent,
      gs: request.googleSearch,
      ce: request.codeExecution
    });
    return `cache:${request.model}:${this.hashString64(raw)}`;
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
    if ((request.model === "gemini-4-pro" || request.model === "gemini-4-argon" || request.model === "gemini-4-flash") && provider.name === "Gemini" && !list.includes("gemini-3.8-flash")) {
      list.push("gemini-3.8-flash");
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
                      yield {
                        ...chunk,
                        provider: provider.id
                      };
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
      inp: request.input,
      dim: request.dimensions
    });
    return `cache:emb:${request.model}:${this.hashString64(raw)}`;
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
        if (matchedText.length === 0) {
          globalRegex.lastIndex++;
          continue;
        }
        const isAllowed = this.allowedPatterns.some((allowed) => {
          if (allowed.test(matchedText)) return true;
          const allowedClone = new RegExp(
            allowed.source,
            allowed.flags.replace("g", "")
          );
          const textMatch = allowedClone.exec(text);
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
          const redactedReplacement = `[SECURITY_REDACTED: ${rule.category}]`;
          sanitizedText = sanitizedText.replace(
            matchedText,
            () => redactedReplacement
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
      } else if (Array.isArray(msg.content)) {
        const updatedParts = msg.content.map((part) => {
          if (part.type === "text" && typeof part.text === "string") {
            const scanResult = this.scan(part.text);
            if (!scanResult.safe) {
              for (const v of scanResult.violations) {
                allViolations.push({ ...v, messageIndex: i });
              }
            }
            if (this.action === "sanitize") {
              return {
                ...part,
                text: scanResult.sanitizedText
              };
            }
          }
          return part;
        });
        updatedMessages.push({
          ...msg,
          content: updatedParts
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
  llmo;
  mcp;
  memory;
  rag;
  realtime = new RealtimeClient();
  consensus;
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
    if (options.llmo) {
      if (options.llmo === true) {
        this.llmo = new LlmOptimizer();
      } else {
        this.llmo = new LlmOptimizer(options.llmo);
      }
    }
    this.memory = new EpisodicMemory({
      storage: this.storage,
      ...options.memory
    });
    this.rag = new HybridRagEngine(options.rag);
    this.consensus = {
      create: async (consensusOptions) => {
        const engine = new ConsensusEngine();
        return engine.execute(this, consensusOptions);
      }
    };
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
          if (this.isReversiblePII) {
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
        let tools = request.tools;
        let thinkingBudget = request.thinkingBudget;
        let requestedModel = request.model;
        if (this.llmo) {
          const opt = this.llmo.optimize(
            {
              model: this.resolveModel(request.model),
              messages,
              tools,
              thinkingBudget
            },
            request.llmo
          );
          messages = opt.messages;
          tools = opt.tools;
          thinkingBudget = opt.thinkingBudget;
          if (opt.cascadeModel) {
            requestedModel = opt.cascadeModel;
          }
        }
        const resolvedModel = this.resolveModel(requestedModel);
        const fullReq = {
          model: resolvedModel,
          messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
          fallbackModels: request.fallbackModels,
          thinkingBudget,
          reasoningEffort: request.reasoningEffort,
          cachedContent: request.cachedContent,
          googleSearch: request.googleSearch,
          codeExecution: request.codeExecution,
          user: request.user,
          llmo: request.llmo
        };
        let estimatedTokens = 0;
        let candidateProviderId;
        if (this.rateLimiter) {
          candidateProviderId = this.router.getPrimaryCandidateProviderId(fullReq);
          estimatedTokens = this.rateLimiter.estimateTokens(fullReq);
          const check = await this.rateLimiter.check(fullReq, {
            estimatedTokens,
            providerId: candidateProviderId
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
            res.provider || candidateProviderId
          );
        }
        if (request.stream) {
          let streamResult = res;
          if (this.rateLimiter) {
            const limiter = this.rateLimiter;
            const upstream = streamResult;
            streamResult = (async function* () {
              let actualStreamTokens;
              let streamProviderId = candidateProviderId;
              try {
                for await (const chunk of upstream) {
                  if (chunk.provider) {
                    streamProviderId = chunk.provider;
                  }
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
                    estimatedTokens,
                    streamProviderId
                  );
                }
              }
            })();
          }
          if (this.guardrails && piiVault && piiVault.size > 0) {
            streamResult = this.guardrails.restoreStream(
              streamResult,
              piiVault
            );
          }
          return streamResult;
        }
        if (this.guardrails && piiVault && piiVault.size > 0 && "choices" in res) {
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
        const candidateProviderId = this.router.getPrimaryCandidateProviderId(dummyReq);
        const inputTokens = Array.isArray(request.input) ? request.input.reduce(
          (acc, str) => acc + Math.ceil(str.length / 4),
          0
        ) : Math.ceil(request.input.length / 4);
        const check = await this.rateLimiter.check(dummyReq, {
          estimatedTokens: inputTokens,
          providerId: candidateProviderId
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
    const base = this.router.getMetrics();
    if (this.llmo) {
      return {
        ...base,
        llmoMetrics: this.llmo.getMetrics()
      };
    }
    return base;
  }
  /**
   * Helper to analyze and optimize prompt messages using LLMO (Large Language Model Optimization).
   */
  optimizePrompt(request, options) {
    const optimizer = this.llmo ?? new LlmOptimizer();
    return optimizer.optimize(request, options);
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
   * Helper to locate the configured Gemini provider for context caching and frontier tools.
   */
  getGeminiProvider() {
    return this.router.getProviders().find(
      (p) => p instanceof GeminiProvider || p.name === "Gemini" || p.id.startsWith("gemini") || typeof p.createCachedContent === "function"
    );
  }
  /**
   * First-class Google Context Caching management control plane (>32k static prefix token caching).
   */
  contextCache = {
    /**
     * Evaluates whether a prompt or request meets the token threshold for context caching (default: 32,768 tokens).
     */
    evaluateEligibility: (request, minTokenThreshold) => {
      return GeminiAgentBooster.evaluateContextCacheEligibility(
        request,
        minTokenThreshold
      );
    },
    /**
     * Creates a cached content resource on Google Gemini for large static prompts.
     */
    create: async (options) => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          "Context caching requires a configured Gemini provider."
        );
      }
      return provider.createCachedContent(options);
    },
    /**
     * Retrieves metadata for an existing cached content resource by name.
     */
    get: async (name) => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          "Context caching requires a configured Gemini provider."
        );
      }
      return provider.getCachedContent(name);
    },
    /**
     * Lists active cached content resources.
     */
    list: async (pageSize) => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          "Context caching requires a configured Gemini provider."
        );
      }
      return provider.listCachedContents(pageSize);
    },
    /**
     * Deletes a cached content resource by name.
     */
    delete: async (name) => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          "Context caching requires a configured Gemini provider."
        );
      }
      return provider.deleteCachedContent(name);
    }
  };
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
  /**
   * Runs a streaming autonomous multi-step tool-calling agent loop.
   *
   * Yields real-time `AgentStreamEvent` items (`step-start`, `text-delta`, `reasoning-delta`,
   * `tool-call-start`, `tool-call-result`, `step-finish`, and `done`) while accumulating
   * fragmented streaming tool call arguments and executing MCP tools between turns.
   */
  async *runWithToolsStream(options) {
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
      yield { type: "step-start", stepIndex };
      const stepStart = Date.now();
      const req = {
        ...options,
        messages: currentMessages,
        stream: true,
        tools: tools.length > 0 ? tools : void 0
      };
      const stream = await this.chat.completions.create(req);
      let responseId = `agent-step-${stepIndex}`;
      let responseModel = options.model || "default";
      let responseProvider;
      let contentAcc = "";
      let reasoningAcc = "";
      let finishReason = "stop";
      let stepUsage;
      let stepGrounding;
      const toolCallsMap = /* @__PURE__ */ new Map();
      for await (const chunk of stream) {
        if (chunk.id) responseId = chunk.id;
        if (chunk.model) responseModel = chunk.model;
        if (chunk.provider) responseProvider = chunk.provider;
        if (chunk.usage) stepUsage = chunk.usage;
        if (chunk.grounding) stepGrounding = chunk.grounding;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finishReason) {
          finishReason = choice.finishReason;
        }
        const delta = choice.delta;
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoningAcc += delta.reasoning_content;
          yield {
            type: "reasoning-delta",
            stepIndex,
            reasoningDelta: delta.reasoning_content,
            chunk
          };
        }
        if (typeof delta.content === "string" && delta.content) {
          contentAcc += delta.content;
          yield {
            type: "text-delta",
            stepIndex,
            textDelta: delta.content,
            chunk
          };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || {
              id: "",
              name: "",
              arguments: ""
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
            toolCallsMap.set(idx, existing);
          }
        }
      }
      const assembledToolCalls = Array.from(toolCallsMap.entries()).sort(([a], [b]) => a - b).map(([idx, tc]) => ({
        id: tc.id || `call_${stepIndex}_${idx}`,
        type: "function",
        function: {
          name: tc.name,
          arguments: tc.arguments || "{}"
        }
      }));
      const assistantMessage = {
        role: "assistant",
        content: contentAcc.length > 0 ? contentAcc : null,
        ...reasoningAcc.length > 0 ? { reasoning_content: reasoningAcc } : {},
        ...assembledToolCalls.length > 0 ? { tool_calls: assembledToolCalls } : {},
        ...stepGrounding ? { grounding: stepGrounding } : {}
      };
      latestResponse = {
        id: responseId,
        model: responseModel,
        provider: responseProvider,
        choices: [
          {
            message: assistantMessage,
            finishReason: assembledToolCalls.length > 0 ? "tool_calls" : finishReason
          }
        ],
        usage: stepUsage,
        grounding: stepGrounding
      };
      if (stepUsage) {
        const promptTokens = stepUsage.promptTokens || 0;
        const completionTokens = stepUsage.completionTokens || 0;
        totalTokens += stepUsage.totalTokens || promptTokens + completionTokens;
      }
      if (assembledToolCalls.length === 0) {
        currentMessages.push(assistantMessage);
        break;
      }
      currentMessages.push(assistantMessage);
      yield {
        type: "tool-call-start",
        stepIndex,
        toolCalls: assembledToolCalls
      };
      const toolExecutions = await Promise.all(
        assembledToolCalls.map(async (tc) => {
          const mcpRes = await bridge.executeToolCall(tc, {
            signal: options.signal,
            user: options.user,
            timeoutMs: options.toolTimeoutMs
          });
          const textOutput = mcpRes.content.map((c) => {
            if (c.type === "text") return c.text;
            if (c.type === "resource") {
              return c.resource.text ?? `[Resource: ${c.resource.uri}]`;
            }
            return `[Image: ${c.mimeType}]`;
          }).join("\n");
          const toolMessage = {
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: textOutput
          };
          return {
            tc,
            mcpRes,
            toolMessage
          };
        })
      );
      const toolResults = [];
      for (const item of toolExecutions) {
        toolResults.push(item.toolMessage);
        currentMessages.push(item.toolMessage);
        yield {
          type: "tool-call-result",
          stepIndex,
          toolCallId: item.tc.id,
          toolName: item.tc.function.name,
          result: item.mcpRes,
          toolMessage: item.toolMessage
        };
      }
      const durationMs = Date.now() - stepStart;
      const step = {
        stepIndex,
        assistantMessage,
        toolCalls: assembledToolCalls,
        toolResults,
        durationMs,
        usage: stepUsage
      };
      steps.push(step);
      if (options.onStep) {
        await options.onStep(step);
      }
      yield {
        type: "step-finish",
        stepIndex,
        step
      };
    }
    const endCost = this.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));
    const finalResult = {
      response: latestResponse,
      messages: currentMessages,
      steps,
      totalSteps: steps.length,
      totalTokens,
      totalCostUsd
    };
    yield {
      type: "done",
      result: finalResult
    };
    return finalResult;
  }
  /**
   * Instantiate an in-process multi-agent swarm orchestrator
   * supporting role-based specialist delegation, A2A handoffs, and shared memory.
   */
  swarm(options) {
    return new AgentSwarm(this, options);
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
      cachedContent: this.settings?.cachedContent,
      googleSearch: this.settings?.googleSearch,
      codeExecution: this.settings?.codeExecution,
      user: this.settings?.user,
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
      cachedContent: this.settings?.cachedContent,
      googleSearch: this.settings?.googleSearch,
      codeExecution: this.settings?.codeExecution,
      user: this.settings?.user,
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
 * Gemini Agent Booster & KV-Cache Prefix Optimizer (2026 Frontier Edition)
 *
 * Implements:
 * 1. Dynamic Thinking Budget Allocation (`thinkingBudget: 'auto'`) based on multi-signal prompt complexity.
 * 2. Deterministic KV-Cache Prefix Pinning (canonical lexicographical tool & JSON schema sorting).
 * 3. Context Caching Eligibility & FinOps Savings Analyzer (>32k token static prefix detection).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
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
 * SinapsAI - In-Process Multi-Agent Swarm & Agent-to-Agent (A2A) Handoff Protocol
 *
 * Implements an in-memory, zero-dependency multi-agent orchestrator featuring:
 * - Role-based specialist agent definitions with custom system prompts and models
 * - Automated handoff tool synthesis (transfer_to_<agent>) with cycle/loop detection
 * - Shared context memory (SwarmContext) updated atomically across agent turns
 * - Standard A2A Agent Card exporter conforming to /.well-known/agent.json spec
 * - Both synchronous (run) and real-time streaming (runStream) execution modes
 * - Concurrency and PII / Security guardrail compatibility
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Speculative Multi-Draft Consensus & Model Arbitration Engine
 *
 * Implements:
 * 1. Parallel multi-model speculative drafting.
 * 2. Pairwise semantic similarity consensus validation (cosine similarity).
 * 3. Automatic escalation to a Judge Model when drafts diverge beyond threshold.
 * 4. Resilient fail-soft fallback with latency and cost telemetry.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Long-Term Episodic Vector Memory Engine
 *
 * Implements:
 * 1. User & tenant-partitioned memory storage.
 * 2. Zero-dependency cosine similarity vector search with local TF or dense embeddings.
 * 3. Dynamic context injection ([LONG-TERM MEMORY]) into conversational turns.
 * 4. Pluggable persistence with StateStorage (InMemory, KV, Redis, D1).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Hybrid RAG Engine (BM25 + Dense Cosine + Reciprocal Rank Fusion)
 *
 * Implements:
 * 1. Semantic paragraph chunker with configurable max token / size and overlap.
 * 2. Pure in-memory Okapi BM25 inverted index for lexical keyword precision.
 * 3. Dense vector cosine similarity for deep semantic understanding.
 * 4. Reciprocal Rank Fusion (RRF) combining sparse + dense rank lists.
 * 5. Zero external dependencies, pure Web Standards.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Universal LLM Optimization Engine (LLMO)
 *
 * Implements:
 * 1. Universal Prompt Token Minification & Whitespace Pruning (code-block aware).
 * 2. System Instruction Deduplication & Normalization.
 * 3. Deterministic KV-Cache Prefix Alignment & Tool Schema Canonicalization.
 * 4. Multi-Signal Complexity Analysis & Adaptive Model Cascading (Tier 1/2/3).
 * 5. Dynamic Thinking Budget Allocation & Output Token Optimization.
 * 6. FinOps Token & USD Savings Telemetry.
 *
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
 * Real-Time Multimodal Voice & WebSocket Control Plane
 *
 * Implements:
 * 1. Zero-dependency native WebSocket connectivity to OpenAI Realtime and Gemini Live APIs.
 * 2. Unified bidirectional session lifecycle (session.connect, sendText, sendAudio, close).
 * 3. Real-time audio and text delta event dispatching.
 * 4. In-process connection resilience and automatic failover.
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