/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  GatewayRateLimitOptions,
  GatewayRateLimitRule,
  GatewayRateLimitViolation,
  RateLimitCheckResult,
  UnifiedApiRequest,
} from '../types/index.js';
import { estimateMessageTokens } from './ContextCompressor.js';
import type { StateStorage } from './StateStorage.js';

export class GatewayRateLimitError extends Error {
  public readonly violation: GatewayRateLimitViolation;
  public readonly key: string;
  public readonly limitType: 'requests' | 'tokens';
  public readonly limit: number;
  public readonly current: number;
  public readonly resetMs: number;
  public readonly retryAfterSec: number;

  constructor(message: string, violation: GatewayRateLimitViolation) {
    super(message);
    this.name = 'GatewayRateLimitError';
    this.violation = violation;
    this.key = violation.key;
    this.limitType = violation.limitType;
    this.limit = violation.limit;
    this.current = violation.current;
    this.resetMs = violation.resetMs;
    this.retryAfterSec = violation.retryAfterSec;
  }
}

/**
 * High-performance, zero-dependency in-process Gateway Rate Limiter.
 *
 * Implements a memory-efficient sliding-window counter algorithm across both
 * in-memory and distributed StateStorage instances (Redis, Cloudflare KV, D1),
 * preventing burst spikes at window boundaries while tracking both RPM and TPM.
 */
export class GatewayRateLimiter {
  private storage: StateStorage;
  private options: GatewayRateLimitOptions;
  public readonly action: 'block' | 'warn';

  constructor(storage: StateStorage, options: GatewayRateLimitOptions = {}) {
    this.storage = storage;
    this.options = options;
    this.action = options.action || 'block';
  }

  /**
   * Matches a providerId against configured providerRules (supporting exact id or prefix match like 'groq-123' -> 'groq').
   */
  private matchProviderRule(providerId?: string): {
    key: string;
    rule: GatewayRateLimitRule;
  } | null {
    if (!providerId || !this.options.providerRules) return null;
    if (this.options.providerRules[providerId]) {
      return {
        key: providerId,
        rule: this.options.providerRules[providerId],
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
  public resolveRule(
    model?: string,
    providerId?: string,
  ): GatewayRateLimitRule | undefined {
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
  public getKey(request: UnifiedApiRequest): string {
    if (this.options.keyGenerator) {
      return this.options.keyGenerator(request) || 'global';
    }
    if (request.user) {
      return `user:${request.user}`;
    }
    return 'global';
  }

  /**
   * Estimates the token requirement for an incoming request.
   */
  public estimateTokens(request: UnifiedApiRequest): number {
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
  public async check(
    request: UnifiedApiRequest,
    checkOptions?: {
      providerId?: string;
      estimatedTokens?: number;
      consume?: boolean;
    },
  ): Promise<RateLimitCheckResult> {
    const rule = this.resolveRule(request.model, checkOptions?.providerId);
    if (!rule) {
      return { allowed: true, resetMs: 0 };
    }

    const windowMs = rule.windowMs || 60000;
    const now = Date.now();
    const currentWindowId = Math.floor(now / windowMs);
    const elapsedInWindow = now % windowMs;
    const weight = 1 - elapsedInWindow / windowMs;
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000);
    const resetMs = Math.max(0, windowMs - elapsedInWindow);
    const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));

    const baseKey = this.getKey(request);
    const matchedProvider = this.matchProviderRule(checkOptions?.providerId);
    const scope: 'global' | 'user' | 'model' | 'provider' = this.options
      .modelRules?.[request.model]
      ? 'model'
      : matchedProvider
        ? 'provider'
        : baseKey.startsWith('user:')
          ? 'user'
          : 'global';

    const scopeKey =
      scope === 'model'
        ? `${baseKey}:m:${request.model}`
        : scope === 'provider' && matchedProvider
          ? `${baseKey}:p:${matchedProvider.key}`
          : baseKey;

    // 1. Check Requests Limit (RPM)
    let currReqCount = 0;
    let estimatedReqs = 0;
    const reqKeyCurrent = `gw:rl:req:${scopeKey}:${currentWindowId}`;
    const reqKeyPrev = `gw:rl:req:${scopeKey}:${currentWindowId - 1}`;

    if (rule.requestsPerMinute !== undefined) {
      const reqLimit = rule.requestsPerMinute;
      currReqCount = (await this.storage.get<number>(reqKeyCurrent)) || 0;
      const prevReqCount = (await this.storage.get<number>(reqKeyPrev)) || 0;
      estimatedReqs = Math.floor(prevReqCount * weight) + currReqCount;

      if (estimatedReqs >= reqLimit) {
        const violation: GatewayRateLimitViolation = {
          key: baseKey,
          scope,
          limitType: 'requests',
          limit: reqLimit,
          current: estimatedReqs,
          resetMs,
          retryAfterSec,
          model: request.model,
          providerId: matchedProvider?.key ?? checkOptions?.providerId,
        };

        this.options.onRateLimitExceeded?.(violation);
        return {
          allowed: false,
          violation,
          remainingRequests: 0,
          resetMs,
        };
      }
    }

    // 2. Check Tokens Limit (TPM)
    let currTokCount = 0;
    let estimatedToks = 0;
    const tokCost =
      checkOptions?.estimatedTokens ?? this.estimateTokens(request);
    const tokKeyCurrent = `gw:rl:tok:${scopeKey}:${currentWindowId}`;
    const tokKeyPrev = `gw:rl:tok:${scopeKey}:${currentWindowId - 1}`;

    if (rule.tokensPerMinute !== undefined) {
      const tokLimit = rule.tokensPerMinute;
      currTokCount = (await this.storage.get<number>(tokKeyCurrent)) || 0;
      const prevTokCount = (await this.storage.get<number>(tokKeyPrev)) || 0;
      estimatedToks = Math.floor(prevTokCount * weight) + currTokCount;

      if (estimatedToks + tokCost > tokLimit) {
        const violation: GatewayRateLimitViolation = {
          key: baseKey,
          scope,
          limitType: 'tokens',
          limit: tokLimit,
          current: estimatedToks,
          resetMs,
          retryAfterSec,
          model: request.model,
          providerId: matchedProvider?.key ?? checkOptions?.providerId,
        };

        this.options.onRateLimitExceeded?.(violation);
        return {
          allowed: false,
          violation,
          remainingRequests:
            rule.requestsPerMinute !== undefined
              ? Math.max(0, rule.requestsPerMinute - estimatedReqs)
              : undefined,
          remainingTokens: Math.max(0, tokLimit - estimatedToks),
          resetMs,
        };
      }
    }

    // 3. Quota allowed; consume if requested
    const shouldConsume = checkOptions?.consume !== false;
    if (shouldConsume) {
      if (rule.requestsPerMinute !== undefined) {
        await this.storage.increment(reqKeyCurrent, ttlSeconds);
      }
      if (rule.tokensPerMinute !== undefined) {
        const newTokens = currTokCount + tokCost;
        await this.storage.set(tokKeyCurrent, newTokens, ttlSeconds);
      }
    }

    const remainingRequests =
      rule.requestsPerMinute !== undefined
        ? Math.max(0, rule.requestsPerMinute - (estimatedReqs + 1))
        : undefined;

    const remainingTokens =
      rule.tokensPerMinute !== undefined
        ? Math.max(0, rule.tokensPerMinute - (estimatedToks + tokCost))
        : undefined;

    return {
      allowed: true,
      remainingRequests,
      remainingTokens,
      resetMs,
    };
  }

  /**
   * Adjusts the token counter after a response completes if the actual
   * tokens consumed differs from the initial estimate.
   */
  public async adjustTokens(
    request: UnifiedApiRequest,
    actualTokens: number,
    estimatedTokens: number,
    providerId?: string,
  ): Promise<void> {
    const delta = actualTokens - estimatedTokens;
    if (delta === 0) return;

    const rule = this.resolveRule(request.model, providerId);
    if (!rule || rule.tokensPerMinute === undefined) return;

    const baseKey = this.getKey(request);
    const matchedProvider = this.matchProviderRule(providerId);
    const scope: 'global' | 'user' | 'model' | 'provider' = this.options
      .modelRules?.[request.model]
      ? 'model'
      : matchedProvider
        ? 'provider'
        : baseKey.startsWith('user:')
          ? 'user'
          : 'global';

    const scopeKey =
      scope === 'model'
        ? `${baseKey}:m:${request.model}`
        : scope === 'provider' && matchedProvider
          ? `${baseKey}:p:${matchedProvider.key}`
          : baseKey;

    const windowMs = rule.windowMs || 60000;
    const currentWindowId = Math.floor(Date.now() / windowMs);
    const tokKeyCurrent = `gw:rl:tok:${scopeKey}:${currentWindowId}`;
    const curr = (await this.storage.get<number>(tokKeyCurrent)) || 0;
    const updated = Math.max(0, curr + delta);
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000);
    await this.storage.set(tokKeyCurrent, updated, ttlSeconds);
  }
}
