import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse } from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { Router } from './Router.js';
import { SinapsClient } from './SinapsClient.js';

describe('parseRateLimitHeaders', () => {
  it('should parse standard x-ratelimit headers and retry-after', () => {
    const headers = new Headers({
      'x-ratelimit-remaining-requests': '42',
      'x-ratelimit-remaining-tokens': '12500',
      'retry-after': '3.5',
    });
    const parsed = parseRateLimitHeaders(headers);
    expect(parsed).toEqual({
      remainingRequests: 42,
      remainingTokens: 12500,
      resetMs: 3500,
    });
  });

  it('should parse anthropic ratelimit headers', () => {
    const headers = new Headers({
      'anthropic-ratelimit-requests-remaining': '5',
      'anthropic-ratelimit-tokens-remaining': '20000',
    });
    const parsed = parseRateLimitHeaders(headers);
    expect(parsed?.remainingRequests).toBe(5);
    expect(parsed?.remainingTokens).toBe(20000);
  });

  it('should return undefined when no rate limit headers are present', () => {
    const headers = new Headers({
      'content-type': 'application/json',
    });
    expect(parseRateLimitHeaders(headers)).toBeUndefined();
    expect(parseRateLimitHeaders(undefined)).toBeUndefined();
  });
});

describe('Telemetry Metrics & Dual-Pricing Routing', () => {
  let storage: InMemoryStorage;
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    storage = new InMemoryStorage();
    circuitBreaker = new CircuitBreaker(storage);
  });

  it('should accumulate telemetry metrics on successful requests and cache hits', async () => {
    const mockResponse: UnifiedApiResponse = {
      id: 'res-1',
      model: 'test-model',
      choices: [
        {
          message: { role: 'assistant', content: 'hello' },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };

    const provider: Provider = {
      id: 'p-costly',
      name: 'Costly Provider',
      promptCostPer1k: 0.01,
      completionCostPer1k: 0.03,
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    };

    const router = new Router([provider], circuitBreaker, {
      cache: { enabled: true, ttlSeconds: 60 },
      storage,
    });

    const req: UnifiedApiRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'test message' }],
    };

    // 1st request (uncached)
    await router.execute(req);

    let metrics = router.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(1);
    expect(metrics.cachedRequests).toBe(0);
    expect(metrics.totalPromptTokens).toBe(100);
    expect(metrics.totalCompletionTokens).toBe(50);
    expect(metrics.totalTokens).toBe(150);
    // Cost: (100 / 1000) * 0.01 + (50 / 1000) * 0.03 = 0.001 + 0.0015 = 0.0025
    expect(metrics.estimatedCostUsd).toBe(0.0025);
    expect(metrics.providerMetrics['p-costly'].requests).toBe(1);
    expect(metrics.providerMetrics['p-costly'].successes).toBe(1);
    expect(metrics.providerMetrics['p-costly'].promptTokens).toBe(100);

    // 2nd request (cache hit)
    const cachedRes = await router.execute(req);
    expect(cachedRes).toEqual(mockResponse);

    metrics = router.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(2);
    expect(metrics.cachedRequests).toBe(1);
  });

  it('should track failed requests in metrics', async () => {
    const provider: Provider = {
      id: 'p-fail',
      name: 'Failing Provider',
      generateContent: vi.fn().mockRejectedValue(new Error('Boom!')),
    };

    const router = new Router([provider], circuitBreaker, { storage });

    const req: UnifiedApiRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(router.execute(req)).rejects.toThrow();

    const metrics = router.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.failedRequests).toBe(1);
    expect(metrics.providerMetrics['p-fail'].failures).toBe(1);
  });

  it('should route via weighted dual-token pricing in lowest-cost strategy', async () => {
    // Provider A: Cheap prompt, expensive completion
    // Prompt: $0.001/1k, Completion: $0.050/1k
    const providerA: Provider = {
      id: 'provider-a',
      name: 'Provider A',
      promptCostPer1k: 0.001,
      completionCostPer1k: 0.05,
      generateContent: vi.fn().mockResolvedValue({
        id: 'res-a',
        model: 'model-a',
        choices: [{ message: { role: 'assistant', content: 'A' } }],
      }),
    };

    // Provider B: Moderate prompt, cheap completion
    // Prompt: $0.010/1k, Completion: $0.005/1k
    const providerB: Provider = {
      id: 'provider-b',
      name: 'Provider B',
      promptCostPer1k: 0.01,
      completionCostPer1k: 0.005,
      generateContent: vi.fn().mockResolvedValue({
        id: 'res-b',
        model: 'model-b',
        choices: [{ message: { role: 'assistant', content: 'B' } }],
      }),
    };

    const router = new Router([providerA, providerB], circuitBreaker, {
      strategy: 'lowest-cost',
      storage,
    });

    // Scenario 1: Huge prompt (10,000 chars ~ 2500 tokens), small completion (50 tokens)
    // Cost A: (2500/1000)*0.001 + (50/1000)*0.050 = 0.0025 + 0.0025 = 0.005
    // Cost B: (2500/1000)*0.010 + (50/1000)*0.005 = 0.0250 + 0.00025 = 0.02525
    // Expected: Provider A is chosen first!
    const longPrompt = 'a'.repeat(10000);
    await router.execute({
      model: 'smart',
      messages: [{ role: 'user', content: longPrompt }],
      maxTokens: 50,
    });
    expect(providerA.generateContent).toHaveBeenCalledTimes(1);
    expect(providerB.generateContent).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // Scenario 2: Tiny prompt (20 chars ~ 5 tokens), huge completion (4000 tokens)
    // Cost A: (5/1000)*0.001 + (4000/1000)*0.050 = 0.000005 + 0.200 = 0.200
    // Cost B: (5/1000)*0.010 + (4000/1000)*0.005 = 0.00005 + 0.020 = 0.020
    // Expected: Provider B is chosen first!
    await router.execute({
      model: 'smart',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 4000,
    });
    expect(providerB.generateContent).toHaveBeenCalledTimes(1);
    expect(providerA.generateContent).not.toHaveBeenCalled();
  });

  it('should trigger onRateLimitWarning and proactively throttle provider', async () => {
    const onRateLimitWarning = vi.fn();

    const provider1: Provider = {
      id: 'p-throttled',
      name: 'Throttled Provider',
      generateContent: vi.fn().mockResolvedValue({
        id: 'res-1',
        model: 'm1',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        rateLimit: {
          remainingRequests: 0,
          resetMs: 2000,
        },
      }),
    };

    const provider2: Provider = {
      id: 'p-backup',
      name: 'Backup Provider',
      generateContent: vi.fn().mockResolvedValue({
        id: 'res-2',
        model: 'm2',
        choices: [{ message: { role: 'assistant', content: 'backup ok' } }],
      }),
    };

    const router = new Router([provider1, provider2], circuitBreaker, {
      strategy: 'failover',
      storage,
      hooks: { onRateLimitWarning },
    });

    const req: UnifiedApiRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    };

    // 1st call uses provider1 and extracts rate limit warning
    const res1 = (await router.execute(req)) as UnifiedApiResponse;
    expect(res1.id).toBe('res-1');
    expect(onRateLimitWarning).toHaveBeenCalledWith(
      provider1,
      expect.objectContaining({ remainingRequests: 0 }),
    );

    // 2nd call: provider1 is proactively throttled, seamlessly fails over to provider2 without calling provider1!
    const res2 = (await router.execute(req)) as UnifiedApiResponse;
    expect(res2.id).toBe('res-2');
    expect(provider1.generateContent).toHaveBeenCalledTimes(1); // not called again!
    expect(provider2.generateContent).toHaveBeenCalledTimes(1);
  });

  it('should expose getMetrics via SinapsClient', async () => {
    const provider: Provider = {
      id: 'client-p',
      name: 'Client Provider',
      promptCostPer1k: 0.002,
      completionCostPer1k: 0.004,
      generateContent: vi.fn().mockResolvedValue({
        id: 'res',
        model: 'model',
        choices: [{ message: { role: 'assistant', content: 'done' } }],
        usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
      }),
    };

    const client = new SinapsClient({
      providers: [provider],
      storage,
    });

    await client.chat.completions.create({
      model: 'test',
      messages: [{ role: 'user', content: 'hello client' }],
    });

    const metrics = client.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.totalTokens).toBe(100);
    expect(metrics.estimatedCostUsd).toBeGreaterThan(0);
    expect(metrics.providerMetrics['client-p'].successes).toBe(1);
  });
});
