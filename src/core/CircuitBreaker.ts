import type { Provider } from '../providers/Provider.js';
import type {
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { StateStorage } from './StateStorage.js';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  onCircuitOpen?: (providerId: string) => void;
  onCircuitClose?: (providerId: string) => void;
}

export class CircuitBreaker {
  private storage: StateStorage;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private onCircuitOpen?: (providerId: string) => void;
  private onCircuitClose?: (providerId: string) => void;

  constructor(storage: StateStorage, options: CircuitBreakerOptions = {}) {
    this.storage = storage;
    this.failureThreshold = options.failureThreshold || 3;
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
      return true;
    } catch (_error) {
      // If storage fails, default to fail-open to allow the request
      return true;
    }
  }

  async recordSuccess(providerId: string): Promise<void> {
    try {
      const failures = await this.storage.get<number>(
        `cb:failures:${providerId}`,
      );
      const previousState = await this.storage.get<string>(
        `cb:state:${providerId}`,
      );

      await this.storage.delete(`cb:failures:${providerId}`);
      await this.storage.set(`cb:state:${providerId}`, 'CLOSED');

      if (
        previousState === 'OPEN' ||
        (failures !== null && failures >= this.failureThreshold)
      ) {
        this.onCircuitClose?.(providerId);
      }
    } catch (_error) {
      // Ignore storage errors so they don't fail a successful request
    }
  }

  async recordFailure(providerId: string): Promise<void> {
    try {
      const failures = await this.storage.increment(
        `cb:failures:${providerId}`,
      );
      if (failures === this.failureThreshold) {
        // Set to OPEN with TTL. When TTL expires, it becomes implicitly HALF_OPEN.
        // Next failure will immediately re-open it since failures is not reset here.
        await this.storage.set(
          `cb:state:${providerId}`,
          'OPEN',
          this.resetTimeoutMs / 1000,
        );
        this.onCircuitOpen?.(providerId);
      } else if (failures > this.failureThreshold) {
        await this.storage.set(
          `cb:state:${providerId}`,
          'OPEN',
          this.resetTimeoutMs / 1000,
        );
      }
    } catch (_error) {
      // Ignore storage errors when recording failures
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
          await this.recordFailure(provider.id);
          throw error;
        }

        await this.recordSuccess(provider.id);

        return (async function* () {
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
        })();
      }

      await this.recordSuccess(provider.id);
      return response;
    } catch (error) {
      await this.recordFailure(provider.id);
      throw error;
    }
  }
}
