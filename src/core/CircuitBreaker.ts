/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type {
  CircuitBreakerStatus,
  CircuitState,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { StateStorage } from './StateStorage.js';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoverySuccessThreshold?: number;
  resetTimeoutMs?: number;
  onCircuitOpen?: (providerId: string) => void;
  onCircuitClose?: (providerId: string) => void;
}

export class CircuitBreaker {
  private storage: StateStorage;
  private failureThreshold: number;
  private recoverySuccessThreshold: number;
  private resetTimeoutMs: number;
  private onCircuitOpen?: (providerId: string) => void;
  private onCircuitClose?: (providerId: string) => void;

  constructor(storage: StateStorage, options: CircuitBreakerOptions = {}) {
    this.storage = storage;
    this.failureThreshold = options.failureThreshold || 3;
    this.recoverySuccessThreshold = options.recoverySuccessThreshold || 1;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.onCircuitOpen = options.onCircuitOpen;
    this.onCircuitClose = options.onCircuitClose;
  }

  async isAvailable(providerId: string): Promise<boolean> {
    try {
      const state = await this.storage.get<string>(`cb:state:${providerId}`);
      if (state === 'OPEN') {
        return false;
      }
      const failures = await this.storage.get<number>(
        `cb:failures:${providerId}`,
      );
      if (failures !== null && failures >= this.failureThreshold) {
        // Circuit is in HALF_OPEN state.
        // If a canary probe is already in flight, deny concurrent requests to prevent thundering herd.
        const probing = await this.storage.get<number>(
          `cb:probe:${providerId}`,
        );
        if (probing !== null && probing > 0) {
          return false;
        }
      }
      return true;
    } catch (_error) {
      // If storage fails, default to fail-open to allow the request
      return true;
    }
  }

  async recordSuccess(providerId: string): Promise<void> {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      const failures = await this.storage.get<number>(
        `cb:failures:${providerId}`,
      );
      const state = await this.storage.get<string>(`cb:state:${providerId}`);

      if (
        state === 'OPEN' ||
        (failures !== null && failures >= this.failureThreshold)
      ) {
        const successes = await this.storage.increment(
          `cb:successes:${providerId}`,
        );
        if (successes >= this.recoverySuccessThreshold) {
          await this.storage.delete(`cb:failures:${providerId}`);
          await this.storage.delete(`cb:successes:${providerId}`);
          await this.storage.set(`cb:state:${providerId}`, 'CLOSED');
          this.onCircuitClose?.(providerId);
        }
      } else {
        await this.storage.delete(`cb:failures:${providerId}`);
        await this.storage.delete(`cb:successes:${providerId}`);
        await this.storage.set(`cb:state:${providerId}`, 'CLOSED');
      }
    } catch (_error) {
      // Ignore storage errors so they don't fail a successful request
    }
  }

  async recordFailure(providerId: string): Promise<void> {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      await this.storage.delete(`cb:successes:${providerId}`);
      const failures = await this.storage.increment(
        `cb:failures:${providerId}`,
      );
      if (failures >= this.failureThreshold) {
        await this.storage.set(
          `cb:state:${providerId}`,
          'OPEN',
          this.resetTimeoutMs / 1000,
        );
        if (failures === this.failureThreshold) {
          this.onCircuitOpen?.(providerId);
        }
      }
    } catch (_error) {
      // Ignore storage errors when recording failures
    }
  }

  async getStatus(providerId: string): Promise<CircuitBreakerStatus> {
    try {
      const rawState =
        (await this.storage.get<string>(`cb:state:${providerId}`)) || 'CLOSED';
      const failures =
        (await this.storage.get<number>(`cb:failures:${providerId}`)) || 0;
      const successes =
        (await this.storage.get<number>(`cb:successes:${providerId}`)) || 0;

      let state: CircuitState = 'CLOSED';
      if (rawState === 'OPEN') {
        state = 'OPEN';
      } else if (failures >= this.failureThreshold) {
        state = 'HALF_OPEN';
      }

      return {
        state,
        failures,
        successes,
      };
    } catch (_error) {
      return {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
      };
    }
  }

  async reset(providerId: string): Promise<void> {
    try {
      await this.storage.delete(`cb:probe:${providerId}`);
      await this.storage.delete(`cb:failures:${providerId}`);
      await this.storage.delete(`cb:successes:${providerId}`);
      await this.storage.set(`cb:state:${providerId}`, 'CLOSED');
      this.onCircuitClose?.(providerId);
    } catch (_error) {
      // Ignore storage errors during reset
    }
  }

  async execute(
    provider: Provider,
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    if (!(await this.isAvailable(provider.id))) {
      throw new Error(`Circuit breaker is OPEN for provider: ${provider.id}`);
    }

    try {
      const failures = await this.storage.get<number>(
        `cb:failures:${provider.id}`,
      );
      if (failures !== null && failures >= this.failureThreshold) {
        await this.storage.set(
          `cb:probe:${provider.id}`,
          1,
          Math.max(1, Math.ceil(this.resetTimeoutMs / 1000)),
        );
      }
    } catch (_error) {
      // Ignore storage errors setting probe lease
    }

    try {
      const response = await provider.generateContent(request);

      if (
        response != null &&
        typeof response === 'object' &&
        Symbol.asyncIterator in response
      ) {
        const iterable = response as AsyncIterable<UnifiedApiStreamChunk>;
        const iterator = iterable[Symbol.asyncIterator]();
        let firstResult: IteratorResult<UnifiedApiStreamChunk>;
        try {
          firstResult = await iterator.next();
        } catch (error) {
          const isAbort =
            request.signal?.aborted ||
            (error as Error)?.name === 'AbortError' ||
            (error as Error)?.message?.toLowerCase().includes('aborted');
          if (!isAbort) {
            await this.recordFailure(provider.id);
          } else {
            try {
              await this.storage.delete(`cb:probe:${provider.id}`);
            } catch (_e) {}
          }
          throw error;
        }

        const self = this;
        return (async function* () {
          try {
            if (!firstResult.done) {
              yield firstResult.value;
              // The rest of the chunks
              let nextResult: IteratorResult<UnifiedApiStreamChunk>;
              nextResult = await iterator.next();
              while (!nextResult.done) {
                yield nextResult.value;
                nextResult = await iterator.next();
              }
            }
            await self.recordSuccess(provider.id);
          } catch (streamError) {
            const isAbort =
              request.signal?.aborted ||
              (streamError as Error)?.name === 'AbortError' ||
              (streamError as Error)?.message
                ?.toLowerCase()
                .includes('aborted');
            if (!isAbort) {
              await self.recordFailure(provider.id);
            } else {
              try {
                await self.storage.delete(`cb:probe:${provider.id}`);
              } catch (_e) {}
            }
            throw streamError;
          } finally {
            try {
              await self.storage.delete(`cb:probe:${provider.id}`);
            } catch (_e) {}
          }
        })();
      }

      await this.recordSuccess(provider.id);
      return response;
    } catch (error) {
      const isAbort =
        request.signal?.aborted ||
        (error as Error)?.name === 'AbortError' ||
        (error as Error)?.message?.toLowerCase().includes('aborted');
      if (!isAbort) {
        await this.recordFailure(provider.id);
      } else {
        try {
          await this.storage.delete(`cb:probe:${provider.id}`);
        } catch (_e) {}
      }
      throw error;
    }
  }
}
