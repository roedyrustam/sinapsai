/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type {
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { Router } from './Router.js';

describe('Router', () => {
  let storage: InMemoryStorage;
  let circuitBreaker: CircuitBreaker;
  let mockRequest: UnifiedApiRequest;
  let mockResponse: UnifiedApiResponse;

  beforeEach(() => {
    storage = new InMemoryStorage();
    circuitBreaker = new CircuitBreaker(storage, {
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });
    mockRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    };
    mockResponse = {
      id: '1',
      model: 'test',
      choices: [
        { message: { role: 'assistant', content: 'hi' }, finishReason: 'stop' },
      ],
    };
  });

  const createMockProvider = (name: string, shouldFail = false) => {
    return {
      id: name,
      name,
      generateContent: vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error(`Provider ${name} failed`);
        return mockResponse;
      }),
    } as Provider;
  };

  describe('failover strategy', () => {
    it('should use the first provider if it succeeds', async () => {
      const p1 = createMockProvider('p1');
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'failover',
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).not.toHaveBeenCalled();
    });

    it('should fallback to the second provider if the first fails', async () => {
      const p1 = createMockProvider('p1', true);
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'failover',
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should skip open circuit providers', async () => {
      const p1 = createMockProvider('p1', true);
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'failover',
      });

      // First failure
      await router.execute(mockRequest);
      // Second failure (threshold is 2, so circuit opens)
      await router.execute(mockRequest);

      // Reset mock counts
      vi.clearAllMocks();

      // Third request, p1 should be skipped because circuit is OPEN
      await router.execute(mockRequest);
      expect(p1.generateContent).not.toHaveBeenCalled();
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('lowest-cost strategy', () => {
    it('should order providers by cost and use the cheapest one', async () => {
      const p1 = createMockProvider('p1');
      p1.costPer1kTokens = 0.05;
      const p2 = createMockProvider('p2');
      p2.costPer1kTokens = 0.01; // p2 is cheaper
      const p3 = createMockProvider('p3');
      p3.costPer1kTokens = 0.1;

      const router = new Router([p1, p2, p3], circuitBreaker, {
        strategy: 'lowest-cost',
      });
      await router.execute(mockRequest);

      // p2 should be called first because it's the cheapest
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
      expect(p1.generateContent).not.toHaveBeenCalled();
      expect(p3.generateContent).not.toHaveBeenCalled();
    });

    it('should fallback to the next cheapest provider if the cheapest fails', async () => {
      const p1 = createMockProvider('p1');
      p1.costPer1kTokens = 0.05; // 2nd cheapest
      const p2 = createMockProvider('p2', true); // fails
      p2.costPer1kTokens = 0.01; // 1st cheapest
      const p3 = createMockProvider('p3');
      p3.costPer1kTokens = 0.1; // 3rd cheapest

      const router = new Router([p1, p2, p3], circuitBreaker, {
        strategy: 'lowest-cost',
      });
      await router.execute(mockRequest);

      expect(p2.generateContent).toHaveBeenCalledTimes(1); // tried but failed
      expect(p1.generateContent).toHaveBeenCalledTimes(1); // tried 2nd and succeeded
      expect(p3.generateContent).not.toHaveBeenCalled(); // 3rd never tried
    });

    it('should support providers with no cost specified (defaults to Infinity)', async () => {
      const p1 = createMockProvider('p1');
      // no cost for p1
      const p2 = createMockProvider('p2');
      p2.costPer1kTokens = 0.5;

      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'lowest-cost',
      });
      await router.execute(mockRequest);

      // p2 should be called because it has a defined cost (0.5 < Infinity)
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
      expect(p1.generateContent).not.toHaveBeenCalled();
    });
  });

  describe('lowest-latency strategy', () => {
    it('should probe unprobed providers and then select the lowest latency provider', async () => {
      // p1 takes 50ms, p2 takes 10ms
      const p1 = {
        id: 'p1',
        name: 'p1',
        generateContent: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 40));
          return mockResponse;
        }),
      } as unknown as Provider;

      const p2 = {
        id: 'p2',
        name: 'p2',
        generateContent: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 5));
          return mockResponse;
        }),
      } as unknown as Provider;

      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'lowest-latency',
      });

      // Request 1: p1 is unprobed, p1 is called
      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);

      // Request 2: p2 is still unprobed (req=0), so p2 is probed next
      await router.execute(mockRequest);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);

      // Request 3: both probed, but p2 latency (~5ms) < p1 latency (~40ms), so p2 should be chosen
      await router.execute(mockRequest);
      expect(p2.generateContent).toHaveBeenCalledTimes(2);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should fallback to second lowest latency provider if lowest latency provider fails', async () => {
      const p1 = {
        id: 'p1',
        name: 'p1',
        generateContent: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 40));
          return mockResponse;
        }),
      } as unknown as Provider;

      let p2Fail = false;
      const p2 = {
        id: 'p2',
        name: 'p2',
        generateContent: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 5));
          if (p2Fail) throw new Error('p2 transient failure');
          return mockResponse;
        }),
      } as unknown as Provider;

      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'lowest-latency',
      });

      // Probe both
      await router.execute(mockRequest);
      await router.execute(mockRequest);

      // Now p2 is faster. Make p2 fail so it falls back to p1
      p2Fail = true;
      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(p2.generateContent).toHaveBeenCalledTimes(2); // failed
      expect(p1.generateContent).toHaveBeenCalledTimes(2); // succeeded fallback
    });

    it('should track cachedPromptTokens in router metrics', async () => {
      const cachedResponse: UnifiedApiResponse = {
        id: 'res-cached',
        model: 'test-model',
        choices: [
          {
            message: { role: 'assistant', content: 'cached response' },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cachedPromptTokens: 80,
        },
      };

      const p1 = {
        id: 'p1',
        name: 'p1',
        generateContent: vi.fn().mockResolvedValue(cachedResponse),
      } as unknown as Provider;

      const router = new Router([p1], circuitBreaker, {
        strategy: 'failover',
      });

      await router.execute(mockRequest);
      const metrics = router.getMetrics();
      expect(metrics.totalCachedPromptTokens).toBe(80);
      expect(metrics.providerMetrics.p1.cachedPromptTokens).toBe(80);
    });
  });

  describe('load-balance strategy', () => {
    it('should rotate between providers', async () => {
      const p1 = createMockProvider('p1');
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'load-balance',
      });

      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).not.toHaveBeenCalled();

      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);

      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(2);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should skip failed providers in the rotation if they become OPEN', async () => {
      const p1 = createMockProvider('p1', true);
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'load-balance',
      });

      // Request 1: p1 is chosen (index 0). It fails. Router falls back to p2 (index 1).
      // p1 has 1 failure. Current index becomes 1.
      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);

      // Current index is 1 for the next request.
      // Request 2: p2 is chosen (index 1). It succeeds. Current index becomes 0.
      await router.execute(mockRequest);
      expect(p2.generateContent).toHaveBeenCalledTimes(2);

      // Current index is 0.
      // Request 3: p1 is chosen (index 0). It fails. p1 has 2 failures (threshold met, circuit opens).
      // Router falls back to p2. Current index becomes 1.
      await router.execute(mockRequest);
      expect(p1.generateContent).toHaveBeenCalledTimes(2);
      expect(p2.generateContent).toHaveBeenCalledTimes(3);

      vi.clearAllMocks();

      // Request 4: index is 1. p2 is chosen. Succeeds. Index becomes 0.
      await router.execute(mockRequest);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
      expect(p1.generateContent).not.toHaveBeenCalled();

      // Request 5: index is 0. p1 is chosen. It is OPEN. Skipped immediately. Router tries p2. Index becomes 1.
      await router.execute(mockRequest);
      expect(p1.generateContent).not.toHaveBeenCalled();
      expect(p2.generateContent).toHaveBeenCalledTimes(2);
    });
  });

  it('should throw AggregateError if all providers fail', async () => {
    const p1 = createMockProvider('p1', true);
    const p2 = createMockProvider('p2', true);
    const router = new Router([p1, p2], circuitBreaker, {
      strategy: 'failover',
    });

    await expect(router.execute(mockRequest)).rejects.toThrowError(
      'All providers failed',
    );
  });

  describe('Event Hooks', () => {
    it('should trigger onFallback and onRateLimit hooks when a provider fails with 429', async () => {
      const p1 = createMockProvider('p1');
      p1.generateContent = vi
        .fn()
        .mockRejectedValue(new Error('Rate limit exceeded 429'));
      const p2 = createMockProvider('p2');

      const hooks = {
        onFallback: vi.fn(),
        onRateLimit: vi.fn(),
      };

      const router = new Router([p1, p2], circuitBreaker, { hooks });
      await router.execute(mockRequest);

      expect(hooks.onRateLimit).toHaveBeenCalledTimes(1);
      expect(hooks.onRateLimit).toHaveBeenCalledWith(p1, expect.any(Error));

      expect(hooks.onFallback).toHaveBeenCalledTimes(1);
      expect(hooks.onFallback).toHaveBeenCalledWith(expect.any(Error), p1, p2);
    });
  });

  describe('streaming', () => {
    it('should pass through async iterable when stream is true', async () => {
      const p1 = createMockProvider('p1');
      p1.generateContent = vi.fn().mockImplementation(async (req) => {
        if (req.stream) {
          return (async function* () {
            yield {
              id: 'stream1',
              choices: [{ delta: { content: 'chunk1' } }],
            };
            yield {
              id: 'stream1',
              choices: [{ delta: { content: 'chunk2' } }],
            };
          })();
        }
        return mockResponse;
      });

      const router = new Router([p1], circuitBreaker, { strategy: 'failover' });
      const res = await router.execute({ ...mockRequest, stream: true });

      const chunks = [];
      for await (const chunk of res as AsyncIterable<UnifiedApiStreamChunk>) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(2);
      expect(chunks[0].choices[0].delta.content).toBe('chunk1');
      expect(chunks[1].choices[0].delta.content).toBe('chunk2');
    });

    it('should fallback if stream throws before or on the first chunk', async () => {
      const p1 = createMockProvider('p1');
      p1.generateContent = vi.fn().mockImplementation(async (req) => {
        if (req.stream) {
          // biome-ignore lint/correctness/useYield: for testing fallback
          return (async function* () {
            throw new Error('Connection failed before first chunk');
          })();
        }
        return mockResponse;
      });

      const p2 = createMockProvider('p2');
      p2.generateContent = vi.fn().mockImplementation(async (req) => {
        if (req.stream) {
          return (async function* () {
            yield {
              id: 'stream2',
              choices: [{ delta: { content: 'p2_chunk1' } }],
            };
          })();
        }
        return mockResponse;
      });

      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'failover',
      });
      const res = await router.execute({ ...mockRequest, stream: true });

      const chunks = [];
      for await (const chunk of res as AsyncIterable<UnifiedApiStreamChunk>) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0].choices[0].delta.content).toBe('p2_chunk1');
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should NOT fallback if stream throws after the first chunk', async () => {
      const p1 = createMockProvider('p1');
      p1.generateContent = vi.fn().mockImplementation(async (req) => {
        if (req.stream) {
          return (async function* () {
            yield {
              id: 'stream1',
              choices: [{ delta: { content: 'chunk1' } }],
            };
            throw new Error('Connection lost mid-stream');
          })();
        }
        return mockResponse;
      });

      const p2 = createMockProvider('p2');

      const router = new Router([p1, p2], circuitBreaker, {
        strategy: 'failover',
      });
      const res = await router.execute({ ...mockRequest, stream: true });

      const chunks = [];
      await expect(async () => {
        for await (const chunk of res as AsyncIterable<UnifiedApiStreamChunk>) {
          chunks.push(chunk);
        }
      }).rejects.toThrow('Connection lost mid-stream');

      expect(chunks).toHaveLength(1); // got first chunk before error
      expect(chunks[0].choices[0].delta.content).toBe('chunk1');
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).not.toHaveBeenCalled(); // No fallback!
    });

    it('should continue to execute and failover smoothly even if StateStorage completely throws', async () => {
      const faultyStorage = {
        get: vi.fn().mockRejectedValue(new Error('Storage GET failed')),
        set: vi.fn().mockRejectedValue(new Error('Storage SET failed')),
        delete: vi.fn().mockRejectedValue(new Error('Storage DELETE failed')),
        increment: vi
          .fn()
          .mockRejectedValue(new Error('Storage INCREMENT failed')),
      };

      const cb = new CircuitBreaker(faultyStorage);
      const p1 = createMockProvider('p1', true);
      const p2 = createMockProvider('p2', false);
      const router = new Router([p1, p2], cb, { strategy: 'failover' });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should trigger onSuccess hook with provider, response, and latencyMs', async () => {
      const onSuccess = vi.fn();
      const p1 = createMockProvider('p1');
      const router = new Router([p1], circuitBreaker, {
        hooks: { onSuccess },
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(
        p1,
        mockResponse,
        expect.any(Number),
      );
    });

    it('should retry a failing provider when retries are configured and fire onRetry', async () => {
      const onRetry = vi.fn();
      const p1 = createMockProvider('p1');
      let calls = 0;
      p1.generateContent = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls <= 2) {
          const err = new Error('503 Service Unavailable');
          (err as Error & { status?: number }).status = 503;
          throw err;
        }
        return mockResponse;
      });

      const cb = new CircuitBreaker(storage, { failureThreshold: 5 });
      const router = new Router([p1], cb, {
        retries: 2,
        retryDelayMs: 10,
        hooks: { onRetry },
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(calls).toBe(3); // 1 initial + 2 retries
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should stop retrying immediately if circuit breaker trips during retries and fallback to next provider', async () => {
      const p1 = createMockProvider('p1');
      let p1Calls = 0;
      p1.generateContent = vi.fn().mockImplementation(async () => {
        p1Calls++;
        const err = new Error('500 Internal Server Error');
        (err as Error & { status?: number }).status = 500;
        throw err;
      });

      const p2 = createMockProvider('p2');

      // Circuit trips after 2 failures, but retries configured to 5
      const cb = new CircuitBreaker(storage, { failureThreshold: 2 });
      const router = new Router([p1, p2], cb, {
        retries: 5,
        retryDelayMs: 10,
        strategy: 'failover',
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      // p1 was called 2 times (initial + 1 retry = 2 failures -> trips circuit -> stops further retries!)
      expect(p1Calls).toBe(2);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should not retry non-retryable errors (e.g. 401 Unauthorized)', async () => {
      const onRetry = vi.fn();
      const p1 = createMockProvider('p1');
      p1.generateContent = vi.fn().mockImplementation(async () => {
        const err = new Error('401 Unauthorized');
        (err as Error & { status?: number }).status = 401;
        throw err;
      });

      const p2 = createMockProvider('p2');

      const router = new Router([p1, p2], circuitBreaker, {
        retries: 3,
        retryDelayMs: 10,
        hooks: { onRetry },
      });

      const res = await router.execute(mockRequest);
      expect(res).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1); // No retries for 401!
      expect(onRetry).not.toHaveBeenCalled();
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should cache non-streaming responses when cache is enabled', async () => {
      const p1 = createMockProvider('p1');
      const router = new Router([p1], circuitBreaker, {
        storage,
        cache: { enabled: true, ttlSeconds: 60 },
      });

      // First call: executes provider
      const res1 = await router.execute(mockRequest);
      expect(res1).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);

      // Second call: served from cache!
      const res2 = await router.execute(mockRequest);
      expect(res2).toEqual(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1); // NOT called again

      // Clear cache
      await router.clearCache();
      const res3 = await router.execute(mockRequest);
      expect(res3).toEqual(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(2); // Called again after cache cleared!
    });

    it('should query and reset circuit breaker statuses across providers', async () => {
      const p1 = createMockProvider('p1');
      const p2 = createMockProvider('p2');
      const router = new Router([p1, p2], circuitBreaker, { storage });

      const statuses = await router.getCircuitBreakerStatus();
      expect(statuses.p1.state).toBe('CLOSED');
      expect(statuses.p2.state).toBe('CLOSED');

      await circuitBreaker.recordFailure('p1');
      await circuitBreaker.recordFailure('p1');
      await circuitBreaker.recordFailure('p1');

      const tripped = await router.getCircuitBreakerStatus();
      expect(tripped.p1.state).toBe('OPEN');

      await router.resetCircuitBreaker('p1');
      const resetOne = await router.getCircuitBreakerStatus();
      expect(resetOne.p1.state).toBe('CLOSED');

      await router.resetCircuitBreaker(); // Reset all
      const resetAll = await router.getCircuitBreakerStatus();
      expect(resetAll.p1.state).toBe('CLOSED');
      expect(resetAll.p2.state).toBe('CLOSED');
    });
  });

  describe('Streaming Metrics & TTFT Tracking', () => {
    it('should track streaming metrics, tokens, TTFT, and trigger onStreamSuccess hook', async () => {
      const onStreamSuccess = vi.fn();
      const mockStreamChunk1: UnifiedApiStreamChunk = {
        id: 'chunk-1',
        model: 'test-model',
        choices: [{ delta: { content: 'Hello ' }, finishReason: null }],
      };
      const mockStreamChunk2: UnifiedApiStreamChunk = {
        id: 'chunk-2',
        model: 'test-model',
        choices: [{ delta: { content: 'world!' }, finishReason: 'stop' }],
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedPromptTokens: 5,
        },
      };

      const streamProvider: Provider = {
        id: 'p-stream',
        name: 'StreamProvider',
        costPer1kTokens: 0.002,
        generateContent: vi.fn().mockImplementation(async () => {
          return (async function* () {
            await new Promise((resolve) => setTimeout(resolve, 10));
            yield mockStreamChunk1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            yield mockStreamChunk2;
          })();
        }),
      };

      const router = new Router([streamProvider], circuitBreaker, {
        hooks: { onStreamSuccess },
      });

      const res = await router.execute({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      });

      const chunks: UnifiedApiStreamChunk[] = [];
      for await (const chunk of res as AsyncIterable<UnifiedApiStreamChunk>) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(onStreamSuccess).toHaveBeenCalledTimes(1);
      const [cbProvider, ttftMs, totalLatencyMs] =
        onStreamSuccess.mock.calls[0];
      expect(cbProvider.id).toBe('p-stream');
      expect(ttftMs).toBeGreaterThanOrEqual(5);
      expect(totalLatencyMs).toBeGreaterThanOrEqual(ttftMs);

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.totalPromptTokens).toBe(12);
      expect(metrics.totalCompletionTokens).toBe(8);
      expect(metrics.totalTokens).toBe(20);
      expect(metrics.totalCachedPromptTokens).toBe(5);
      expect(metrics.providerMetrics['p-stream'].requests).toBe(1);
      expect(metrics.providerMetrics['p-stream'].successes).toBe(1);
      expect(metrics.providerMetrics['p-stream'].cachedPromptTokens).toBe(5);
    });

    it('should record metric failure when streaming errors mid-flight', async () => {
      const failingStreamProvider: Provider = {
        id: 'p-stream-fail',
        name: 'FailingStreamProvider',
        generateContent: vi.fn().mockImplementation(async () => {
          return (async function* () {
            yield {
              id: 'c1',
              model: 'test',
              choices: [{ delta: { content: 'chunk 1' }, finishReason: null }],
            };
            throw new Error('Mid-stream network timeout');
          })();
        }),
      };

      const router = new Router([failingStreamProvider], circuitBreaker);
      const res = await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'Fail mid stream' }],
        stream: true,
      });

      const streamIterator = (res as AsyncIterable<UnifiedApiStreamChunk>)[
        Symbol.asyncIterator
      ]();
      await expect(streamIterator.next()).resolves.toBeDefined();
      await expect(streamIterator.next()).rejects.toThrow(
        'Mid-stream network timeout',
      );

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.failedRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.providerMetrics['p-stream-fail'].failures).toBe(1);
    });
  });

  describe('Hierarchical Model-Level Fallback', () => {
    it('should fallback to candidate model on same provider when primary model fails with 429 and trigger onModelFallback', async () => {
      const onModelFallback = vi.fn();
      const p1 = createMockProvider('p1');
      p1.fallbackModels = ['gpt-4o-mini'];

      const p2 = createMockProvider('p2');

      p1.generateContent = vi.fn().mockImplementation(async (req) => {
        if (req.model === 'gpt-4o') {
          const err = new Error('429 Rate Limit Exceeded on gpt-4o');
          (err as Error & { status?: number }).status = 429;
          throw err;
        }
        return {
          ...mockResponse,
          model: 'gpt-4o-mini',
        };
      });

      const router = new Router([p1, p2], circuitBreaker, {
        hooks: { onModelFallback },
      });

      const res = (await router.execute({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      })) as UnifiedApiResponse;

      expect(res.model).toBe('gpt-4o-mini');
      expect(p1.generateContent).toHaveBeenCalledTimes(2);
      expect(p1.generateContent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ model: 'gpt-4o' }),
      );
      expect(p1.generateContent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: 'gpt-4o-mini' }),
      );
      expect(onModelFallback).toHaveBeenCalledTimes(1);
      const [err, provider, fromM, toM] = onModelFallback.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect(provider.id).toBe('p1');
      expect(fromM).toBe('gpt-4o');
      expect(toM).toBe('gpt-4o-mini');
      expect(p2.generateContent).not.toHaveBeenCalled();
    });

    it('should failover to second provider when all candidate models on first provider fail', async () => {
      const onModelFallback = vi.fn();
      const onFallback = vi.fn();
      const p1 = createMockProvider('p1');
      p1.fallbackModels = ['model-b'];

      p1.generateContent = vi.fn().mockImplementation(async (req) => {
        const err = new Error(`Model ${req.model} failed`);
        (err as Error & { status?: number }).status = 503;
        throw err;
      });

      const p2 = createMockProvider('p2');
      p2.generateContent = vi.fn().mockResolvedValue({
        ...mockResponse,
        model: 'model-c',
      });

      const cb = new CircuitBreaker(storage, { failureThreshold: 5 });
      const router = new Router([p1, p2], cb, {
        hooks: { onModelFallback, onFallback },
      });

      const res = (await router.execute({
        model: 'model-a',
        fallbackModels: ['model-c'],
        messages: [{ role: 'user', content: 'Hi' }],
      })) as UnifiedApiResponse;

      expect(res.model).toBe('model-c');
      // p1 tried model-a, then model-b, then model-c (all failed)
      expect(p1.generateContent).toHaveBeenCalledTimes(3);
      // p2 was called and succeeded!
      expect(p2.generateContent).toHaveBeenCalled();
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledWith(expect.any(Error), p1, p2);
    });

    it('should immediately failover without testing more models on provider when receiving 401 Unauthorized', async () => {
      const p1 = createMockProvider('p1');
      p1.fallbackModels = ['model-b', 'model-c'];
      p1.generateContent = vi.fn().mockImplementation(async () => {
        const err = new Error('401 Invalid API Key');
        (err as Error & { status?: number }).status = 401;
        throw err;
      });

      const p2 = createMockProvider('p2');
      p2.generateContent = vi.fn().mockResolvedValue(mockResponse);

      const router = new Router([p1, p2], circuitBreaker);

      const res = await router.execute({
        model: 'model-a',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(res).toBe(mockResponse);
      // Because 401 is an auth error, p1 should ONLY be called once and NOT try model-b or model-c!
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(p2.generateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Semantic In-Process Response Caching', () => {
    it('should serve semantically similar queries from cache using customEmbed and trigger onSemanticCacheHit', async () => {
      const onSemanticCacheHit = vi.fn();
      const p1 = createMockProvider('p1');

      // Simple mock embedding function
      const customEmbed = vi.fn().mockImplementation(async (text: string) => {
        if (text.toLowerCase().includes('france')) {
          // Both questions about France have almost identical vectors
          return [0.99, 0.05, 0.01];
        }
        // Questions about football have orthogonal vectors
        return [0.01, 0.99, 0.02];
      });

      const router = new Router([p1], circuitBreaker, {
        storage,
        cache: {
          enabled: true,
          ttlSeconds: 60,
          semantic: {
            enabled: true,
            similarityThreshold: 0.9,
            customEmbed,
          },
        },
        hooks: { onSemanticCacheHit },
      });

      // Request 1: What is the capital of France?
      const res1 = (await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      })) as UnifiedApiResponse;

      expect(res1).toBe(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(onSemanticCacheHit).not.toHaveBeenCalled();

      // Request 2: Can you tell me the capital of France? (Different phrasing, same semantics)
      const res2 = (await router.execute({
        model: 'test',
        messages: [
          { role: 'user', content: 'Can you tell me the capital of France?' },
        ],
      })) as UnifiedApiResponse;

      expect(res2).toEqual(mockResponse);
      // p1 was NOT called again! It was served from semantic cache!
      expect(p1.generateContent).toHaveBeenCalledTimes(1);
      expect(onSemanticCacheHit).toHaveBeenCalledTimes(1);
      const [_req, _cachedRes, similarity] = onSemanticCacheHit.mock.calls[0];
      expect(similarity).toBeGreaterThanOrEqual(0.95);

      // Request 3: Who won the World Cup? (Semantically unrelated)
      await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'Who won the World Cup?' }],
      });
      // Should NOT match France cache, so provider is called
      expect(p1.generateContent).toHaveBeenCalledTimes(2);
    });

    it('should utilize provider generateEmbedding when customEmbed is not specified', async () => {
      const onSemanticCacheHit = vi.fn();
      const p1: Provider = {
        id: 'p-embed-capable',
        name: 'Provider with Embeddings',
        generateContent: vi.fn().mockResolvedValue(mockResponse),
        generateEmbedding: vi.fn().mockImplementation(async (req) => {
          const text = req.input as string;
          if (text.includes('weather')) {
            return {
              object: 'list',
              model: 'embed-model',
              data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
            };
          }
          return {
            object: 'list',
            model: 'embed-model',
            data: [{ object: 'embedding', index: 0, embedding: [0, 1] }],
          };
        }),
      };

      const router = new Router([p1], circuitBreaker, {
        storage,
        cache: {
          enabled: true,
          semantic: true, // Default config (similarityThreshold: 0.90)
        },
        hooks: { onSemanticCacheHit },
      });

      // First query
      await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'How is the weather today?' }],
      });
      expect(p1.generateContent).toHaveBeenCalledTimes(1);

      // Second similar query
      const res2 = await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'Tell me the weather report' }],
      });

      expect(res2).toEqual(mockResponse);
      expect(p1.generateContent).toHaveBeenCalledTimes(1); // Cache hit!
      expect(onSemanticCacheHit).toHaveBeenCalledTimes(1);
    });

    it('should clear semantic cache when router.clearCache() is called', async () => {
      const p1 = createMockProvider('p1');
      const customEmbed = vi.fn().mockResolvedValue([1, 0, 0]);

      const router = new Router([p1], circuitBreaker, {
        storage,
        cache: {
          enabled: true,
          semantic: { customEmbed },
        },
      });

      await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'Hello 1' }],
      });
      expect(p1.generateContent).toHaveBeenCalledTimes(1);

      // Clear cache
      await router.clearCache();

      // Subsequent query should miss and call provider again
      await router.execute({
        model: 'test',
        messages: [{ role: 'user', content: 'Hello 2' }],
      });
      expect(p1.generateContent).toHaveBeenCalledTimes(2);
    });
  });
});
