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
  });
});
