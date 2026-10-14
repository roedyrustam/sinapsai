/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../providers/OpenAiProvider.js';
import type {
  CreateChatCompletionRequestNonStreaming,
  CreateEmbeddingRequest,
  UnifiedApiRequest,
  UnifiedApiResponse,
} from '../types/index.js';
import { BatchExecutionError, executeBatch } from './BatchExecutor.js';
import { SinapsClient } from './SinapsClient.js';

describe('BatchExecutor', () => {
  it('handles empty batch gracefully', async () => {
    const result = await executeBatch([], async (x) => x);
    expect(result.total).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('processes items concurrently and preserves original index ordering', async () => {
    const items = [10, 20, 30, 40, 50];
    let maxConcurrent = 0;
    let active = 0;

    const result = await executeBatch(
      items,
      async (item, index) => {
        active++;
        if (active > maxConcurrent) maxConcurrent = active;
        // Introduce small varying delays to test concurrency resolution order
        await new Promise((resolve) => setTimeout(resolve, (5 - index) * 10));
        active--;
        return item * 2;
      },
      { concurrency: 2 },
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(result.total).toBe(5);
    expect(result.successful).toBe(5);
    expect(result.failed).toBe(0);

    // Verify ordering
    expect(result.results).toHaveLength(5);
    for (let i = 0; i < items.length; i++) {
      expect(result.results[i].index).toBe(i);
      expect(result.results[i].status).toBe('fulfilled');
      expect(result.results[i].value).toBe(items[i] * 2);
    }
  });

  it('supports fail-soft settled mode (stopOnError: false)', async () => {
    const items = ['ok1', 'fail2', 'ok3', 'fail4', 'ok5'];

    const result = await executeBatch(
      items,
      async (item) => {
        if (item.startsWith('fail')) {
          throw new Error(`Error on ${item}`);
        }
        return `Processed ${item}`;
      },
      { stopOnError: false },
    );

    expect(result.total).toBe(5);
    expect(result.successful).toBe(3);
    expect(result.failed).toBe(2);

    expect(result.results[0].status).toBe('fulfilled');
    expect(result.results[0].value).toBe('Processed ok1');

    expect(result.results[1].status).toBe('rejected');
    expect(result.results[1].error?.message).toBe('Error on fail2');

    expect(result.results[2].status).toBe('fulfilled');
    expect(result.results[2].value).toBe('Processed ok3');

    expect(result.results[3].status).toBe('rejected');
    expect(result.results[3].error?.message).toBe('Error on fail4');

    expect(result.results[4].status).toBe('fulfilled');
    expect(result.results[4].value).toBe('Processed ok5');
  });

  it('supports fail-fast mode (stopOnError: true)', async () => {
    const items = [1, 2, 3, 4, 5];

    await expect(
      executeBatch(
        items,
        async (item) => {
          if (item === 3) {
            throw new Error('Fatal error on 3');
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          return item * 10;
        },
        { concurrency: 1, stopOnError: true },
      ),
    ).rejects.toThrowError(BatchExecutionError);
  });

  it('triggers onProgress callback for each completed item', async () => {
    const items = ['a', 'b', 'c'];
    const progressUpdates: number[] = [];

    const result = await executeBatch(
      items,
      async (item) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item.toUpperCase();
      },
      {
        concurrency: 1,
        onProgress: (p) => {
          progressUpdates.push(p.completed);
        },
      },
    );

    expect(result.successful).toBe(3);
    expect(progressUpdates).toEqual([1, 2, 3]);
  });

  it('respects AbortSignal by stopping unprocessed items', async () => {
    const controller = new AbortController();
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    const batchPromise = executeBatch(
      items,
      async (item) => {
        if (item === 3) {
          controller.abort();
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return item;
      },
      { concurrency: 1, signal: controller.signal },
    );

    const result = await batchPromise;
    expect(result.failed).toBeGreaterThan(0);
    const abortedItem = result.results.find((r) =>
      r.error?.message.includes('aborted'),
    );
    expect(abortedItem).toBeDefined();
  });
});

describe('SinapsClient.batch integration', () => {
  it('executes batch.chat with non-streaming chat requests', async () => {
    const mockProvider = new OpenAiProvider({
      apiKey: 'test-key',
      defaultModel: 'gpt-4o-mini',
    });

    vi.spyOn(mockProvider, 'generateContent').mockImplementation(
      async (req: UnifiedApiRequest): Promise<UnifiedApiResponse> => {
        return {
          id: `chat-${req.model}`,
          model: req.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: `Response for: ${req.messages[0]?.content}`,
              },
              finishReason: 'stop',
            },
          ],
        };
      },
    );

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    const requests: CreateChatCompletionRequestNonStreaming[] = [
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Prompt 1' }],
      },
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Prompt 2' }],
      },
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Prompt 3' }],
      },
    ];

    const batchResult = await client.batch.chat(requests, { concurrency: 2 });

    expect(batchResult.total).toBe(3);
    expect(batchResult.successful).toBe(3);
    expect(batchResult.failed).toBe(0);
    expect(batchResult.results[0].value?.choices[0].message.content).toBe(
      'Response for: Prompt 1',
    );
    expect(batchResult.results[1].value?.choices[0].message.content).toBe(
      'Response for: Prompt 2',
    );
    expect(batchResult.results[2].value?.choices[0].message.content).toBe(
      'Response for: Prompt 3',
    );
  });

  it('executes batch.embeddings with multiple embedding requests', async () => {
    const mockProvider = new OpenAiProvider({
      apiKey: 'test-key',
      defaultModel: 'gpt-4o-mini',
    });

    vi.spyOn(mockProvider, 'generateEmbedding').mockImplementation(
      async (req: CreateEmbeddingRequest) => {
        return {
          object: 'list',
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3], object: 'embedding' }],
          model: req.model,
        };
      },
    );

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    const requests: CreateEmbeddingRequest[] = [
      { model: 'text-embedding-3-small', input: 'Hello world' },
      { model: 'text-embedding-3-small', input: 'AI gateway' },
    ];

    const batchResult = await client.batch.embeddings(requests, {
      concurrency: 2,
    });

    expect(batchResult.total).toBe(2);
    expect(batchResult.successful).toBe(2);
    expect(batchResult.results[0].value?.data[0].embedding).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });
});
