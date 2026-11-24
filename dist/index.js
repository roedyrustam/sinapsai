export { SinapsEmbeddingModel, SinapsLanguageModel, SinapsLanguageModelV2, SinapsLanguageModelV3, convertPromptToSinapsMessages, convertToolsAndMode, convertV2CallOptions, convertV2PromptToSinapsMessages, createSinapsAI, createSinapsAIV2, createSinapsAIV3, mapFinishReason, sinapsai } from './chunk-6ZYDPVHL.js';
export { AnySchemaNode, ArraySchemaNode, BatchExecutionError, BooleanSchemaNode, BudgetExceededError, CanaryProber, CircuitBreaker, ClusteredSemanticCache, ContextCompressor, DEFAULT_CASCADE_TIERS, DashboardServer, DatasetDistiller, EnumSchemaNode, FRONTIER_CASCADE_PRESETS, FRONTIER_CASCADE_TIERS, GatewayRateLimitError, GatewayRateLimiter, HedgedExecutor, KvCacheOptimizer, LlmEvals, LlmOptimizer, NumberSchemaNode, ObjectSchemaNode, PIIGuardrails, RealtimeClient, RealtimeSession, Router, SchemaValidationError, SecurityGuardrailError, SecurityGuardrails, SinapsClient, SpeculativeStreamVerifier, StringSchemaNode, VirtualKeyError, VirtualKeyManager, VisionOptimizer, accumulateStream, canonicalizeTools, deduplicateSystemInstructions, estimateMessageTokens, estimateTextTokens, estimateTotalTokens, evaluateResponseConfidence, executeBatch, exportOtelTraces, formatOtelMetrics, formatPrometheusMetrics, generateSpanId, generateTraceId, isSinapsSchema, isStandardSchema, isZodSchema, jsonSchema, minifyProsePreservingCode, s, toOtelTracePayload, toStandardJsonSchema, tool, validateSchema } from './chunk-RKVI53LP.js';
export { AutonomousDriftHealer, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_PROTOCOL_VERSIONS, McpClientConnector, McpToolBridge, coerceToolArguments, extractBalancedJson, extractJsonFromText, tryExtractJson } from './chunk-GXNERADB.js';
export { Bm25Index, CognitiveBrain, EpisodicMemory, FaithfulnessSentinel, HybridRagEngine, KnowledgeGraph, chunkDocument, reciprocalRankFusion } from './chunk-AW2XY6VC.js';
import './chunk-HSD3MD5I.js';
export { ANTHROPIC_AVAILABILITY_FALLBACKS, ANTHROPIC_DEFAULT_PRICING, ANTHROPIC_MODELS, AnthropicProvider, AwsBedrockProvider, AzureOpenAiProvider, BEDROCK_MODELS, COHERE_MODELS, CohereProvider, DEEPSEEK_AVAILABILITY_FALLBACKS, DEEPSEEK_DEFAULT_PRICING, DEEPSEEK_MODELS, DeepSeekProvider, GROQ_MODELS, GROQ_REASONING_MODELS, GroqProvider, MISTRAL_AVAILABILITY_FALLBACKS, MISTRAL_DEFAULT_PRICING, MISTRAL_MODELS, MOONSHOT_AVAILABILITY_FALLBACKS, MOONSHOT_DEFAULT_PRICING, MOONSHOT_MODELS, MistralProvider, MoonshotProvider, OPENAI_DEFAULT_PRICING, OPENAI_MODELS, OPENROUTER_DEFAULT_FREE_FALLBACKS, OPENROUTER_FREE_MODELS, OPENROUTER_FREE_MODEL_CATALOG, OllamaProvider, OpenAiProvider, OpenRouterProvider, QWEN_AVAILABILITY_FALLBACKS, QWEN_DEFAULT_PRICING, QWEN_MODELS, QwenProvider, XAI_AVAILABILITY_FALLBACKS, XAI_DEFAULT_PRICING, XAI_MODELS, XAiProvider, ZHIPU_AVAILABILITY_FALLBACKS, ZHIPU_DEFAULT_PRICING, ZHIPU_MODELS, ZhipuProvider, createOpenRouterFreeProvider, getSignatureKey, hmacSha256, isOpenRouterFreeModel, sha256Hex, signAwsRequest } from './chunk-NKBYPB2E.js';
export { FRONTIER_AVAILABILITY_FALLBACKS, FRONTIER_MODELS, FrontierModelRegistry, GEMINI_AVAILABILITY_FALLBACKS, GEMINI_DEFAULT_PRICING, GEMINI_MODELS, GeminiAgentBooster, GeminiProvider, canonicalizeJsonValue, linkAbortSignal } from './chunk-K4ACMRST.js';
export { AgentPersonaRegistry, AgentSwarm, AgentWalletExceededError, ConsensusEngine, DurableWorkflowEngine, InMemoryStorage, SemanticRouter, SwarmContext, TournamentConsensusEngine, calculatePairwiseSimilarity, computeTermFrequencyVector, createFastSemanticEmbedding, deepMergeContext } from './chunk-7ANXE55O.js';
export { SINAPSAI_VERSION } from './chunk-3J6SD35J.js';
export { cosineSimilarity, extractPromptText } from './chunk-2H32LEA7.js';
import './chunk-2TM2T5AP.js';

/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

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
  async increment(key, ttlSeconds) {
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
    const options = {};
    if (ttlSeconds && ttlSeconds > 0) {
      options.expirationTtl = Math.max(60, ttlSeconds);
    }
    await this.kv.put(prefixedKey, JSON.stringify(newValue), options);
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
  async increment(key, ttlSeconds) {
    await this.ensureTable();
    const current = await this.get(key);
    const newValue = (current ?? 0) + 1;
    const expiresAt = current === null && ttlSeconds && ttlSeconds > 0 ? Math.floor(Date.now() / 1e3) + ttlSeconds : null;
    if (current === null && expiresAt !== null) {
      await this.db.prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, ?)`
      ).bind(key, JSON.stringify(newValue), expiresAt).run();
    } else {
      await this.db.prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, (SELECT expires_at FROM ${this.tableName} WHERE key = ?))`
      ).bind(key, JSON.stringify(newValue), key).run();
    }
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
  async increment(key, ttlSeconds) {
    const prefixedKey = this.key(key);
    const val = await this.redis.incr(prefixedKey);
    if (val === 1 && ttlSeconds && ttlSeconds > 0 && typeof this.redis.expire === "function") {
      await this.redis.expire(prefixedKey, ttlSeconds);
    }
    return val;
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
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
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
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export { BudgetGuardrails, CloudflareKVStorage, D1Storage, RedisStorage };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map