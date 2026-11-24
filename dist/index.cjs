'use strict';

var chunk2YGUZY3W_cjs = require('./chunk-2YGUZY3W.cjs');
var chunkVHS6ENEV_cjs = require('./chunk-VHS6ENEV.cjs');
var chunkUXDEFCQW_cjs = require('./chunk-UXDEFCQW.cjs');
var chunkFXM6QR2P_cjs = require('./chunk-FXM6QR2P.cjs');
require('./chunk-EUP4MQRP.cjs');
var chunkX4KJ57AC_cjs = require('./chunk-X4KJ57AC.cjs');
var chunkGH6B7K2T_cjs = require('./chunk-GH6B7K2T.cjs');
var chunkACOBN5TU_cjs = require('./chunk-ACOBN5TU.cjs');
var chunkSMYSGG7U_cjs = require('./chunk-SMYSGG7U.cjs');
var chunkSQYIGFDL_cjs = require('./chunk-SQYIGFDL.cjs');
require('./chunk-RDUHOW5V.cjs');

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

Object.defineProperty(exports, "SinapsEmbeddingModel", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.SinapsEmbeddingModel; }
});
Object.defineProperty(exports, "SinapsLanguageModel", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.SinapsLanguageModel; }
});
Object.defineProperty(exports, "SinapsLanguageModelV2", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.SinapsLanguageModelV2; }
});
Object.defineProperty(exports, "SinapsLanguageModelV3", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.SinapsLanguageModelV3; }
});
Object.defineProperty(exports, "convertPromptToSinapsMessages", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.convertPromptToSinapsMessages; }
});
Object.defineProperty(exports, "convertToolsAndMode", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.convertToolsAndMode; }
});
Object.defineProperty(exports, "convertV2CallOptions", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.convertV2CallOptions; }
});
Object.defineProperty(exports, "convertV2PromptToSinapsMessages", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.convertV2PromptToSinapsMessages; }
});
Object.defineProperty(exports, "createSinapsAI", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.createSinapsAI; }
});
Object.defineProperty(exports, "createSinapsAIV2", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.createSinapsAIV2; }
});
Object.defineProperty(exports, "createSinapsAIV3", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.createSinapsAIV3; }
});
Object.defineProperty(exports, "mapFinishReason", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.mapFinishReason; }
});
Object.defineProperty(exports, "sinapsai", {
  enumerable: true,
  get: function () { return chunk2YGUZY3W_cjs.sinapsai; }
});
Object.defineProperty(exports, "AnySchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.AnySchemaNode; }
});
Object.defineProperty(exports, "ArraySchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.ArraySchemaNode; }
});
Object.defineProperty(exports, "BatchExecutionError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.BatchExecutionError; }
});
Object.defineProperty(exports, "BooleanSchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.BooleanSchemaNode; }
});
Object.defineProperty(exports, "BudgetExceededError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.BudgetExceededError; }
});
Object.defineProperty(exports, "CanaryProber", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.CanaryProber; }
});
Object.defineProperty(exports, "CircuitBreaker", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.CircuitBreaker; }
});
Object.defineProperty(exports, "ClusteredSemanticCache", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.ClusteredSemanticCache; }
});
Object.defineProperty(exports, "ContextCompressor", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.ContextCompressor; }
});
Object.defineProperty(exports, "DEFAULT_CASCADE_TIERS", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.DEFAULT_CASCADE_TIERS; }
});
Object.defineProperty(exports, "DashboardServer", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.DashboardServer; }
});
Object.defineProperty(exports, "DatasetDistiller", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.DatasetDistiller; }
});
Object.defineProperty(exports, "EnumSchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.EnumSchemaNode; }
});
Object.defineProperty(exports, "FRONTIER_CASCADE_PRESETS", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.FRONTIER_CASCADE_PRESETS; }
});
Object.defineProperty(exports, "FRONTIER_CASCADE_TIERS", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.FRONTIER_CASCADE_TIERS; }
});
Object.defineProperty(exports, "GatewayRateLimitError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.GatewayRateLimitError; }
});
Object.defineProperty(exports, "GatewayRateLimiter", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.GatewayRateLimiter; }
});
Object.defineProperty(exports, "HedgedExecutor", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.HedgedExecutor; }
});
Object.defineProperty(exports, "KvCacheOptimizer", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.KvCacheOptimizer; }
});
Object.defineProperty(exports, "LlmEvals", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.LlmEvals; }
});
Object.defineProperty(exports, "LlmOptimizer", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.LlmOptimizer; }
});
Object.defineProperty(exports, "NumberSchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.NumberSchemaNode; }
});
Object.defineProperty(exports, "ObjectSchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.ObjectSchemaNode; }
});
Object.defineProperty(exports, "PIIGuardrails", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.PIIGuardrails; }
});
Object.defineProperty(exports, "RealtimeClient", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.RealtimeClient; }
});
Object.defineProperty(exports, "RealtimeSession", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.RealtimeSession; }
});
Object.defineProperty(exports, "Router", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.Router; }
});
Object.defineProperty(exports, "SchemaValidationError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.SchemaValidationError; }
});
Object.defineProperty(exports, "SecurityGuardrailError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.SecurityGuardrailError; }
});
Object.defineProperty(exports, "SecurityGuardrails", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.SecurityGuardrails; }
});
Object.defineProperty(exports, "SinapsClient", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.SinapsClient; }
});
Object.defineProperty(exports, "SpeculativeStreamVerifier", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.SpeculativeStreamVerifier; }
});
Object.defineProperty(exports, "StringSchemaNode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.StringSchemaNode; }
});
Object.defineProperty(exports, "VirtualKeyError", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.VirtualKeyError; }
});
Object.defineProperty(exports, "VirtualKeyManager", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.VirtualKeyManager; }
});
Object.defineProperty(exports, "VisionOptimizer", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.VisionOptimizer; }
});
Object.defineProperty(exports, "accumulateStream", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.accumulateStream; }
});
Object.defineProperty(exports, "canonicalizeTools", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.canonicalizeTools; }
});
Object.defineProperty(exports, "deduplicateSystemInstructions", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.deduplicateSystemInstructions; }
});
Object.defineProperty(exports, "estimateMessageTokens", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.estimateMessageTokens; }
});
Object.defineProperty(exports, "estimateTextTokens", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.estimateTextTokens; }
});
Object.defineProperty(exports, "estimateTotalTokens", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.estimateTotalTokens; }
});
Object.defineProperty(exports, "evaluateResponseConfidence", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.evaluateResponseConfidence; }
});
Object.defineProperty(exports, "executeBatch", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.executeBatch; }
});
Object.defineProperty(exports, "exportOtelTraces", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.exportOtelTraces; }
});
Object.defineProperty(exports, "formatOtelMetrics", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.formatOtelMetrics; }
});
Object.defineProperty(exports, "formatPrometheusMetrics", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.formatPrometheusMetrics; }
});
Object.defineProperty(exports, "generateSpanId", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.generateSpanId; }
});
Object.defineProperty(exports, "generateTraceId", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.generateTraceId; }
});
Object.defineProperty(exports, "isSinapsSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.isSinapsSchema; }
});
Object.defineProperty(exports, "isStandardSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.isStandardSchema; }
});
Object.defineProperty(exports, "isZodSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.isZodSchema; }
});
Object.defineProperty(exports, "jsonSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.jsonSchema; }
});
Object.defineProperty(exports, "minifyProsePreservingCode", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.minifyProsePreservingCode; }
});
Object.defineProperty(exports, "s", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.s; }
});
Object.defineProperty(exports, "toOtelTracePayload", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.toOtelTracePayload; }
});
Object.defineProperty(exports, "toStandardJsonSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.toStandardJsonSchema; }
});
Object.defineProperty(exports, "tool", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.tool; }
});
Object.defineProperty(exports, "validateSchema", {
  enumerable: true,
  get: function () { return chunkVHS6ENEV_cjs.validateSchema; }
});
Object.defineProperty(exports, "AutonomousDriftHealer", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.AutonomousDriftHealer; }
});
Object.defineProperty(exports, "MCP_PROTOCOL_VERSION", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.MCP_PROTOCOL_VERSION; }
});
Object.defineProperty(exports, "MCP_SUPPORTED_PROTOCOL_VERSIONS", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.MCP_SUPPORTED_PROTOCOL_VERSIONS; }
});
Object.defineProperty(exports, "McpClientConnector", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.McpClientConnector; }
});
Object.defineProperty(exports, "McpToolBridge", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.McpToolBridge; }
});
Object.defineProperty(exports, "coerceToolArguments", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.coerceToolArguments; }
});
Object.defineProperty(exports, "extractBalancedJson", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.extractBalancedJson; }
});
Object.defineProperty(exports, "extractJsonFromText", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.extractJsonFromText; }
});
Object.defineProperty(exports, "tryExtractJson", {
  enumerable: true,
  get: function () { return chunkUXDEFCQW_cjs.tryExtractJson; }
});
Object.defineProperty(exports, "Bm25Index", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.Bm25Index; }
});
Object.defineProperty(exports, "CognitiveBrain", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.CognitiveBrain; }
});
Object.defineProperty(exports, "EpisodicMemory", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.EpisodicMemory; }
});
Object.defineProperty(exports, "FaithfulnessSentinel", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.FaithfulnessSentinel; }
});
Object.defineProperty(exports, "HybridRagEngine", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.HybridRagEngine; }
});
Object.defineProperty(exports, "KnowledgeGraph", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.KnowledgeGraph; }
});
Object.defineProperty(exports, "chunkDocument", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.chunkDocument; }
});
Object.defineProperty(exports, "reciprocalRankFusion", {
  enumerable: true,
  get: function () { return chunkFXM6QR2P_cjs.reciprocalRankFusion; }
});
Object.defineProperty(exports, "ANTHROPIC_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ANTHROPIC_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "ANTHROPIC_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ANTHROPIC_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "ANTHROPIC_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ANTHROPIC_MODELS; }
});
Object.defineProperty(exports, "AnthropicProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.AnthropicProvider; }
});
Object.defineProperty(exports, "AwsBedrockProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.AwsBedrockProvider; }
});
Object.defineProperty(exports, "AzureOpenAiProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.AzureOpenAiProvider; }
});
Object.defineProperty(exports, "BEDROCK_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.BEDROCK_MODELS; }
});
Object.defineProperty(exports, "COHERE_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.COHERE_MODELS; }
});
Object.defineProperty(exports, "CohereProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.CohereProvider; }
});
Object.defineProperty(exports, "DEEPSEEK_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.DEEPSEEK_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "DEEPSEEK_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.DEEPSEEK_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "DEEPSEEK_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.DEEPSEEK_MODELS; }
});
Object.defineProperty(exports, "DeepSeekProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.DeepSeekProvider; }
});
Object.defineProperty(exports, "GROQ_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.GROQ_MODELS; }
});
Object.defineProperty(exports, "GROQ_REASONING_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.GROQ_REASONING_MODELS; }
});
Object.defineProperty(exports, "GroqProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.GroqProvider; }
});
Object.defineProperty(exports, "MISTRAL_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MISTRAL_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "MISTRAL_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MISTRAL_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "MISTRAL_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MISTRAL_MODELS; }
});
Object.defineProperty(exports, "MOONSHOT_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MOONSHOT_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "MOONSHOT_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MOONSHOT_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "MOONSHOT_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MOONSHOT_MODELS; }
});
Object.defineProperty(exports, "MistralProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MistralProvider; }
});
Object.defineProperty(exports, "MoonshotProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.MoonshotProvider; }
});
Object.defineProperty(exports, "OPENAI_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OPENAI_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "OPENAI_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OPENAI_MODELS; }
});
Object.defineProperty(exports, "OPENROUTER_DEFAULT_FREE_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OPENROUTER_DEFAULT_FREE_FALLBACKS; }
});
Object.defineProperty(exports, "OPENROUTER_FREE_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OPENROUTER_FREE_MODELS; }
});
Object.defineProperty(exports, "OPENROUTER_FREE_MODEL_CATALOG", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OPENROUTER_FREE_MODEL_CATALOG; }
});
Object.defineProperty(exports, "OllamaProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OllamaProvider; }
});
Object.defineProperty(exports, "OpenAiProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OpenAiProvider; }
});
Object.defineProperty(exports, "OpenRouterProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.OpenRouterProvider; }
});
Object.defineProperty(exports, "QWEN_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.QWEN_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "QWEN_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.QWEN_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "QWEN_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.QWEN_MODELS; }
});
Object.defineProperty(exports, "QwenProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.QwenProvider; }
});
Object.defineProperty(exports, "XAI_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.XAI_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "XAI_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.XAI_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "XAI_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.XAI_MODELS; }
});
Object.defineProperty(exports, "XAiProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.XAiProvider; }
});
Object.defineProperty(exports, "ZHIPU_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ZHIPU_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "ZHIPU_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ZHIPU_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "ZHIPU_MODELS", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ZHIPU_MODELS; }
});
Object.defineProperty(exports, "ZhipuProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.ZhipuProvider; }
});
Object.defineProperty(exports, "createOpenRouterFreeProvider", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.createOpenRouterFreeProvider; }
});
Object.defineProperty(exports, "getSignatureKey", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.getSignatureKey; }
});
Object.defineProperty(exports, "hmacSha256", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.hmacSha256; }
});
Object.defineProperty(exports, "isOpenRouterFreeModel", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.isOpenRouterFreeModel; }
});
Object.defineProperty(exports, "sha256Hex", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.sha256Hex; }
});
Object.defineProperty(exports, "signAwsRequest", {
  enumerable: true,
  get: function () { return chunkX4KJ57AC_cjs.signAwsRequest; }
});
Object.defineProperty(exports, "FRONTIER_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.FRONTIER_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "FRONTIER_MODELS", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.FRONTIER_MODELS; }
});
Object.defineProperty(exports, "FrontierModelRegistry", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.FrontierModelRegistry; }
});
Object.defineProperty(exports, "GEMINI_AVAILABILITY_FALLBACKS", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.GEMINI_AVAILABILITY_FALLBACKS; }
});
Object.defineProperty(exports, "GEMINI_DEFAULT_PRICING", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.GEMINI_DEFAULT_PRICING; }
});
Object.defineProperty(exports, "GEMINI_MODELS", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.GEMINI_MODELS; }
});
Object.defineProperty(exports, "GeminiAgentBooster", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.GeminiAgentBooster; }
});
Object.defineProperty(exports, "GeminiProvider", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.GeminiProvider; }
});
Object.defineProperty(exports, "canonicalizeJsonValue", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.canonicalizeJsonValue; }
});
Object.defineProperty(exports, "linkAbortSignal", {
  enumerable: true,
  get: function () { return chunkGH6B7K2T_cjs.linkAbortSignal; }
});
Object.defineProperty(exports, "AgentPersonaRegistry", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.AgentPersonaRegistry; }
});
Object.defineProperty(exports, "AgentSwarm", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.AgentSwarm; }
});
Object.defineProperty(exports, "AgentWalletExceededError", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.AgentWalletExceededError; }
});
Object.defineProperty(exports, "ConsensusEngine", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.ConsensusEngine; }
});
Object.defineProperty(exports, "DurableWorkflowEngine", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.DurableWorkflowEngine; }
});
Object.defineProperty(exports, "InMemoryStorage", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.InMemoryStorage; }
});
Object.defineProperty(exports, "SemanticRouter", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.SemanticRouter; }
});
Object.defineProperty(exports, "SwarmContext", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.SwarmContext; }
});
Object.defineProperty(exports, "TournamentConsensusEngine", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.TournamentConsensusEngine; }
});
Object.defineProperty(exports, "calculatePairwiseSimilarity", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.calculatePairwiseSimilarity; }
});
Object.defineProperty(exports, "computeTermFrequencyVector", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.computeTermFrequencyVector; }
});
Object.defineProperty(exports, "createFastSemanticEmbedding", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.createFastSemanticEmbedding; }
});
Object.defineProperty(exports, "deepMergeContext", {
  enumerable: true,
  get: function () { return chunkACOBN5TU_cjs.deepMergeContext; }
});
Object.defineProperty(exports, "SINAPSAI_VERSION", {
  enumerable: true,
  get: function () { return chunkSMYSGG7U_cjs.SINAPSAI_VERSION; }
});
Object.defineProperty(exports, "cosineSimilarity", {
  enumerable: true,
  get: function () { return chunkSQYIGFDL_cjs.cosineSimilarity; }
});
Object.defineProperty(exports, "extractPromptText", {
  enumerable: true,
  get: function () { return chunkSQYIGFDL_cjs.extractPromptText; }
});
exports.BudgetGuardrails = BudgetGuardrails;
exports.CloudflareKVStorage = CloudflareKVStorage;
exports.D1Storage = D1Storage;
exports.RedisStorage = RedisStorage;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map