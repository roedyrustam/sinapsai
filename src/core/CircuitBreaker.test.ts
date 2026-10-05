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
});
