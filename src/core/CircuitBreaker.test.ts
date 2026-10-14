/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse } from '../types/index.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';

describe('CircuitBreaker', () => {
  let storage: InMemoryStorage;
  let circuitBreaker: CircuitBreaker;
  let mockRequest: UnifiedApiRequest;
  let mockResponse: UnifiedApiResponse;

  beforeEach(() => {
    storage = new InMemoryStorage();
    circuitBreaker = new CircuitBreaker(storage, {
      failureThreshold: 2,
      resetTimeoutMs: 100,
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

  it('should allow requests when closed', async () => {
    const provider = createMockProvider('test');
    const res = await circuitBreaker.execute(provider, mockRequest);
    expect(res).toBe(mockResponse);
  });

  it('should open after failureThreshold is reached', async () => {
    const provider = createMockProvider('test', true);

    // 1st failure
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Provider test failed',
    );
    // 2nd failure - reaches threshold, opens circuit
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Provider test failed',
    );

    // 3rd attempt - should fail fast
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Circuit breaker is OPEN for provider: test',
    );
    expect(provider.generateContent).toHaveBeenCalledTimes(2);
  });

  it('should reset (half-open) after resetTimeoutMs and trigger onCircuitClose', async () => {
    const onCircuitOpen = vi.fn();
    const onCircuitClose = vi.fn();
    circuitBreaker = new CircuitBreaker(storage, {
      failureThreshold: 2,
      resetTimeoutMs: 100,
      onCircuitOpen,
      onCircuitClose,
    });

    const provider = createMockProvider('test', true);

    // Fail until open
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();

    // Verify it's open
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Circuit breaker is OPEN',
    );
    expect(onCircuitOpen).toHaveBeenCalledWith('test');
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);

    // Wait for resetTimeoutMs
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should try again (half-open)
    provider.generateContent = vi.fn().mockResolvedValue(mockResponse); // change to succeed
    const res = await circuitBreaker.execute(provider, mockRequest);
    expect(res).toBe(mockResponse);
    expect(provider.generateContent).toHaveBeenCalledTimes(1); // 1 success after reset
    expect(onCircuitClose).toHaveBeenCalledWith('test');
    expect(onCircuitClose).toHaveBeenCalledTimes(1);

    // Next request should also succeed
    const res2 = await circuitBreaker.execute(provider, mockRequest);
    expect(res2).toBe(mockResponse);
    // Should not trigger onCircuitClose again since it's already closed
    expect(onCircuitClose).toHaveBeenCalledTimes(1);
  });

  it('should reopen immediately if half-open request fails', async () => {
    const provider = createMockProvider('test', true);

    // Fail until open
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();

    // Verify it's open
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Circuit breaker is OPEN',
    );

    // Wait for resetTimeoutMs
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Try again, but it still fails
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Provider test failed',
    );

    // Should immediately be OPEN again, without needing 2 failures
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Circuit breaker is OPEN',
    );
  });

  it('should require recoverySuccessThreshold successful probes before closing', async () => {
    const onCircuitClose = vi.fn();
    circuitBreaker = new CircuitBreaker(storage, {
      failureThreshold: 2,
      recoverySuccessThreshold: 2,
      resetTimeoutMs: 100,
      onCircuitClose,
    });

    const provider = createMockProvider('test-rec', true);

    // Fail until open
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();
    await expect(
      circuitBreaker.execute(provider, mockRequest),
    ).rejects.toThrow();

    // Verify it is open
    await expect(circuitBreaker.execute(provider, mockRequest)).rejects.toThrow(
      'Circuit breaker is OPEN',
    );

    // Wait for resetTimeoutMs
    await new Promise((resolve) => setTimeout(resolve, 150));

    // First probe succeeds
    provider.generateContent = vi.fn().mockResolvedValue(mockResponse);
    const res1 = await circuitBreaker.execute(provider, mockRequest);
    expect(res1).toBe(mockResponse);
    // Not closed yet because threshold is 2!
    expect(onCircuitClose).not.toHaveBeenCalled();

    // Second probe succeeds
    const res2 = await circuitBreaker.execute(provider, mockRequest);
    expect(res2).toBe(mockResponse);
    // Now it should be closed!
    expect(onCircuitClose).toHaveBeenCalledWith('test-rec');
    expect(onCircuitClose).toHaveBeenCalledTimes(1);
  });

  describe('Storage Resilience', () => {
    it('should fail-open and allow request if storage.get throws', async () => {
      const provider = createMockProvider('test_storage_read');
      vi.spyOn(storage, 'get').mockRejectedValue(new Error('Storage failure'));

      const res = await circuitBreaker.execute(provider, mockRequest);
      expect(res).toBe(mockResponse);
      expect(provider.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should not mask provider success if storage throws during recordSuccess', async () => {
      const provider = createMockProvider('test_storage_write_success');
      vi.spyOn(storage, 'delete').mockRejectedValue(
        new Error('Storage failure'),
      );

      const res = await circuitBreaker.execute(provider, mockRequest);
      expect(res).toBe(mockResponse);
    });

    it('should not crash if storage throws during recordFailure, but should still throw the original provider error', async () => {
      const provider = createMockProvider('test_storage_write_fail', true);
      vi.spyOn(storage, 'increment').mockRejectedValue(
        new Error('Storage failure'),
      );

      await expect(
        circuitBreaker.execute(provider, mockRequest),
      ).rejects.toThrow('Provider test_storage_write_fail failed');
    });
  });

  describe('getStatus & reset', () => {
    it('should report CLOSED status initially and after manual reset', async () => {
      const status = await circuitBreaker.getStatus('p-initial');
      expect(status.state).toBe('CLOSED');
      expect(status.failures).toBe(0);

      // Record 3 failures to trip it
      await circuitBreaker.recordFailure('p-initial');
      await circuitBreaker.recordFailure('p-initial');
      await circuitBreaker.recordFailure('p-initial');

      const trippedStatus = await circuitBreaker.getStatus('p-initial');
      expect(trippedStatus.state).toBe('OPEN');
      expect(trippedStatus.failures).toBe(3);

      // Manually reset
      await circuitBreaker.reset('p-initial');
      const resetStatus = await circuitBreaker.getStatus('p-initial');
      expect(resetStatus.state).toBe('CLOSED');
      expect(resetStatus.failures).toBe(0);
    });
  });

  describe('Streaming Execution & Mid-Stream Failure', () => {
    it('should successfully stream chunks through circuit breaker', async () => {
      const mockStreamProvider: Provider = {
        id: 'stream-provider',
        name: 'StreamProvider',
        generateContent: vi.fn().mockImplementation(async () => {
          return (async function* () {
            yield {
              id: 'c1',
              model: 'test',
              choices: [{ delta: { content: 'chunk 1' }, finishReason: null }],
            };
            yield {
              id: 'c2',
              model: 'test',
              choices: [
                { delta: { content: 'chunk 2' }, finishReason: 'stop' },
              ],
            };
          })();
        }),
      };

      const res = await circuitBreaker.execute(mockStreamProvider, {
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test chunk iteration
      const chunks: any[] = [];
      // biome-ignore lint/suspicious/noExplicitAny: test chunk iteration
      for await (const chunk of res as AsyncIterable<any>) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].choices[0].delta.content).toBe('chunk 1');
      expect(chunks[1].choices[0].delta.content).toBe('chunk 2');

      const status = await circuitBreaker.getStatus('stream-provider');
      expect(status.state).toBe('CLOSED');
      expect(status.failures).toBe(0);
    });

    it('should record failure and trip circuit breaker if mid-stream disconnect occurs', async () => {
      const failingStreamProvider: Provider = {
        id: 'stream-fail-provider',
        name: 'StreamFailProvider',
        generateContent: vi.fn().mockImplementation(async () => {
          return (async function* () {
            yield {
              id: 'c1',
              model: 'test',
              choices: [{ delta: { content: 'chunk 1' }, finishReason: null }],
            };
            // Simulate socket disconnect on chunk 2
            throw new Error('Connection reset by peer mid-stream');
          })();
        }),
      };

      // 1st failure
      const res1 = await circuitBreaker.execute(failingStreamProvider, {
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      });
      // biome-ignore lint/suspicious/noExplicitAny: test chunk iteration
      const it1 = (res1 as AsyncIterable<any>)[Symbol.asyncIterator]();
      await expect(it1.next()).resolves.toBeDefined(); // 1st chunk works
      await expect(it1.next()).rejects.toThrow(
        'Connection reset by peer mid-stream',
      ); // mid-stream throws

      // 2nd failure
      const res2 = await circuitBreaker.execute(failingStreamProvider, {
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      });
      // biome-ignore lint/suspicious/noExplicitAny: test chunk iteration
      const it2 = (res2 as AsyncIterable<any>)[Symbol.asyncIterator]();
      await it2.next();
      await expect(it2.next()).rejects.toThrow(
        'Connection reset by peer mid-stream',
      );

      // Now threshold (2) is reached -> Circuit should be OPEN!
      await expect(
        circuitBreaker.execute(failingStreamProvider, {
          model: 'test',
          messages: [{ role: 'user', content: 'test' }],
          stream: true,
        }),
      ).rejects.toThrow(
        'Circuit breaker is OPEN for provider: stream-fail-provider',
      );
    });

    it('should NOT record failure if stream error is an intentional client abort', async () => {
      const abortController = new AbortController();
      const abortStreamProvider: Provider = {
        id: 'stream-abort-provider',
        name: 'StreamAbortProvider',
        generateContent: vi.fn().mockImplementation(async () => {
          return (async function* () {
            yield {
              id: 'c1',
              model: 'test',
              choices: [{ delta: { content: 'chunk 1' }, finishReason: null }],
            };
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          })();
        }),
      };

      const res = await circuitBreaker.execute(abortStreamProvider, {
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
        signal: abortController.signal,
      });

      // biome-ignore lint/suspicious/noExplicitAny: test chunk iteration
      const it = (res as AsyncIterable<any>)[Symbol.asyncIterator]();
      await it.next();
      await expect(it.next()).rejects.toThrow('aborted');

      // Verify circuit breaker status was NOT incremented as a failure
      const status = await circuitBreaker.getStatus('stream-abort-provider');
      expect(status.failures).toBe(0);
      expect(status.state).toBe('CLOSED');
    });
  });
});
