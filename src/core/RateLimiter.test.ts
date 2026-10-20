/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { GatewayRateLimitError, GatewayRateLimiter } from './RateLimiter.js';

describe('GatewayRateLimiter', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  const createRequest = (
    user?: string,
    model = 'test-model',
  ): UnifiedApiRequest => ({
    model,
    messages: [{ role: 'user', content: 'hello world' }],
    user,
  });

  it('should allow requests within requestsPerMinute limit', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { requestsPerMinute: 3, windowMs: 60000 },
    });

    const req = createRequest();
    const res1 = await limiter.check(req);
    expect(res1.allowed).toBe(true);
    expect(res1.remainingRequests).toBe(2);

    const res2 = await limiter.check(req);
    expect(res2.allowed).toBe(true);
    expect(res2.remainingRequests).toBe(1);

    const res3 = await limiter.check(req);
    expect(res3.allowed).toBe(true);
    expect(res3.remainingRequests).toBe(0);

    // 4th request exceeds limit
    const res4 = await limiter.check(req);
    expect(res4.allowed).toBe(false);
    expect(res4.violation).toBeDefined();
    expect(res4.violation?.limitType).toBe('requests');
    expect(res4.violation?.limit).toBe(3);
    expect(res4.violation?.current).toBe(3);
    expect(res4.violation?.retryAfterSec).toBeGreaterThan(0);
  });

  it('should enforce tokensPerMinute limit (TPM)', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { tokensPerMinute: 500, windowMs: 60000 },
    });

    const req = createRequest();
    // First check with estimated 300 tokens
    const res1 = await limiter.check(req, { estimatedTokens: 300 });
    expect(res1.allowed).toBe(true);
    expect(res1.remainingTokens).toBe(200);

    // Second check with estimated 250 tokens -> exceeds 500
    const res2 = await limiter.check(req, { estimatedTokens: 250 });
    expect(res2.allowed).toBe(false);
    expect(res2.violation?.limitType).toBe('tokens');
    expect(res2.violation?.limit).toBe(500);
    expect(res2.violation?.current).toBe(300);
  });

  it('should adjust token counter after response completes', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { tokensPerMinute: 1000, windowMs: 60000 },
    });

    const req = createRequest();
    await limiter.check(req, { estimatedTokens: 400 });

    // Actual usage was 250 instead of 400 (saved 150 tokens)
    await limiter.adjustTokens(req, 250, 400);

    // Now another 700 tokens should still fit (250 + 700 = 950 <= 1000)
    const res = await limiter.check(req, { estimatedTokens: 700 });
    expect(res.allowed).toBe(true);
  });

  it('should partition rate limits per user when user is specified', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { requestsPerMinute: 2, windowMs: 60000 },
    });

    const aliceReq = createRequest('alice');
    const bobReq = createRequest('bob');

    // Alice consumes 2 requests
    expect((await limiter.check(aliceReq)).allowed).toBe(true);
    expect((await limiter.check(aliceReq)).allowed).toBe(true);
    expect((await limiter.check(aliceReq)).allowed).toBe(false);

    // Bob still has fresh quota
    const bobRes1 = await limiter.check(bobReq);
    expect(bobRes1.allowed).toBe(true);
    expect(bobRes1.remainingRequests).toBe(1);
  });

  it('should apply model-specific rules over default rules', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { requestsPerMinute: 10 },
      modelRules: {
        'expensive-model': { requestsPerMinute: 1 },
      },
    });

    const cheapReq = createRequest(undefined, 'cheap-model');
    const expReq = createRequest(undefined, 'expensive-model');

    expect((await limiter.check(cheapReq)).allowed).toBe(true);
    expect((await limiter.check(cheapReq)).allowed).toBe(true);

    // Expensive model is capped at 1 request
    expect((await limiter.check(expReq)).allowed).toBe(true);
    const expRes2 = await limiter.check(expReq);
    expect(expRes2.allowed).toBe(false);
    expect(expRes2.violation?.limit).toBe(1);
  });

  it('should support custom keyGenerator', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { requestsPerMinute: 1 },
      keyGenerator: (req) => `ip:${req.temperature ? 'hot' : 'cold'}`,
    });

    const req1 = { ...createRequest(), temperature: 1.0 };
    const req2 = { ...createRequest(), temperature: 0.0 };

    expect((await limiter.check(req1)).allowed).toBe(true);
    expect((await limiter.check(req1)).allowed).toBe(false);

    // req2 has different partition key
    expect((await limiter.check(req2)).allowed).toBe(true);
  });

  it('should invoke onRateLimitExceeded callback on violation', async () => {
    const onExceeded = vi.fn();
    const limiter = new GatewayRateLimiter(storage, {
      defaultRule: { requestsPerMinute: 1 },
      onRateLimitExceeded: onExceeded,
    });

    const req = createRequest('charlie');
    await limiter.check(req);
    await limiter.check(req);

    expect(onExceeded).toHaveBeenCalledTimes(1);
    expect(onExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'user:charlie',
        limitType: 'requests',
        limit: 1,
      }),
    );
  });

  it('should adjust tokens when rule is configured on providerRules', async () => {
    const limiter = new GatewayRateLimiter(storage, {
      providerRules: {
        groq: { tokensPerMinute: 800, windowMs: 60000 },
      },
    });

    const req = createRequest(undefined, 'custom-model');
    // Reserve 500 tokens for groq
    const res1 = await limiter.check(req, {
      providerId: 'groq',
      estimatedTokens: 500,
    });
    expect(res1.allowed).toBe(true);

    // Actual usage was 200 (delta -300)
    await limiter.adjustTokens(req, 200, 500, 'groq');

    // Now another 500 tokens should fit (200 + 500 = 700 <= 800)
    const res2 = await limiter.check(req, {
      providerId: 'groq',
      estimatedTokens: 500,
    });
    expect(res2.allowed).toBe(true);
  });

  it('should correctly instantiate GatewayRateLimitError', () => {
    const violation = {
      key: 'user:test',
      scope: 'user' as const,
      limitType: 'requests' as const,
      limit: 10,
      current: 10,
      resetMs: 45000,
      retryAfterSec: 45,
    };

    const err = new GatewayRateLimitError('Rate limit exceeded', violation);
    expect(err.name).toBe('GatewayRateLimitError');
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.key).toBe('user:test');
    expect(err.limit).toBe(10);
    expect(err.resetMs).toBe(45000);
    expect(err.retryAfterSec).toBe(45);
  });
});
