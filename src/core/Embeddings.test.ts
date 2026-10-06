import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
} from '../types/index.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { SinapsClient } from './SinapsClient.js';

describe('Embeddings Control Plane', () => {
  let mockEmbeddingResponse: CreateEmbeddingResponse;

  beforeEach(() => {
    mockEmbeddingResponse = {
      object: 'list',
      model: 'text-embedding-3-small',
      data: [
        {
          object: 'embedding',
          index: 0,
          embedding: [0.012, -0.034, 0.056],
        },
      ],
      usage: {
        promptTokens: 5,
        totalTokens: 5,
      },
    };
  });

  const createMockEmbeddingProvider = (
    id: string,
    shouldFail = false,
    cost = 0.0001,
  ): Provider => {
    return {
      id,
      name: id,
      costPer1kTokens: cost,
      generateContent: vi.fn(),
      generateEmbedding: vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error(`Provider ${id} failed to embed`);
        return mockEmbeddingResponse;
      }),
    };
  };

  it('should generate embeddings successfully via primary provider', async () => {
    const p1 = createMockEmbeddingProvider('openai-embed');
    const client = new SinapsClient({
      providers: [p1],
    });

    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'Machine learning embeddings',
    });

    expect(res).toBe(mockEmbeddingResponse);
    expect(p1.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(res.data[0].embedding).toEqual([0.012, -0.034, 0.056]);
  });

  it('should automatically failover to secondary provider when primary fails', async () => {
    const p1 = createMockEmbeddingProvider('p1-failing', true);
    const p2 = createMockEmbeddingProvider('p2-backup', false);

    const onFallback = vi.fn();
    const client = new SinapsClient({
      strategy: 'failover',
      providers: [p1, p2],
      hooks: { onFallback },
    });

    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'Failover test sentence',
    });

    expect(res).toBe(mockEmbeddingResponse);
    expect(p1.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(p2.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('should route to lowest-cost embedding provider when lowest-cost strategy is used', async () => {
    const expensiveProvider = createMockEmbeddingProvider(
      'expensive',
      false,
      0.0005,
    );
    const cheapProvider = createMockEmbeddingProvider('cheap', false, 0.00005);

    const client = new SinapsClient({
      strategy: 'lowest-cost',
      providers: [expensiveProvider, cheapProvider],
    });

    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'Budget test',
    });

    expect(res).toBe(mockEmbeddingResponse);
    expect(cheapProvider.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(expensiveProvider.generateEmbedding).not.toHaveBeenCalled();
  });

  it('should cache embeddings in-memory and prevent duplicate API calls', async () => {
    const storage = new InMemoryStorage({ autoSweep: false });
    const p1 = createMockEmbeddingProvider('cached-provider');

    const client = new SinapsClient({
      providers: [p1],
      storage,
      cache: { enabled: true, ttlSeconds: 60 },
    });

    const req: CreateEmbeddingRequest = {
      model: 'text-embedding-3-small',
      input: 'Exact cached query',
    };

    // First call: executes provider
    const res1 = await client.embeddings.create(req);
    expect(res1).toBe(mockEmbeddingResponse);
    expect(p1.generateEmbedding).toHaveBeenCalledTimes(1);

    // Second call: served directly from cache!
    const res2 = await client.embeddings.create(req);
    expect(res2).toEqual(mockEmbeddingResponse);
    expect(p1.generateEmbedding).toHaveBeenCalledTimes(1); // Not called again!

    storage.destroy();
  });

  it('should trip circuit breaker and skip unavailable embedding provider', async () => {
    const p1 = createMockEmbeddingProvider('unreliable', true);
    const p2 = createMockEmbeddingProvider('reliable', false);

    const storage = new InMemoryStorage({ autoSweep: false });
    const client = new SinapsClient({
      providers: [p1, p2],
      storage,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 5000 },
    });

    // 1st request -> p1 fails, p2 succeeds
    await client.embeddings.create({ model: 'emb', input: 'test 1' });
    // 2nd request -> p1 fails (threshold 2 reached, circuit OPENs), p2 succeeds
    await client.embeddings.create({ model: 'emb', input: 'test 2' });

    vi.clearAllMocks();

    // 3rd request -> p1 is skipped because circuit is OPEN, goes directly to p2!
    await client.embeddings.create({ model: 'emb', input: 'test 3' });
    expect(p1.generateEmbedding).not.toHaveBeenCalled();
    expect(p2.generateEmbedding).toHaveBeenCalledTimes(1);

    storage.destroy();
  });

  it('should throw an informative error when no configured provider supports embeddings', async () => {
    const chatOnlyProvider: Provider = {
      id: 'chat-only',
      name: 'ChatOnly',
      generateContent: vi.fn(),
    };

    const client = new SinapsClient({
      providers: [chatOnlyProvider],
    });

    await expect(
      client.embeddings.create({ model: 'emb', input: 'test' }),
    ).rejects.toThrow(
      'No configured provider supports embedding generation (generateEmbedding)',
    );
  });
});
