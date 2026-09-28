import type { Provider } from '../providers/Provider.js';
import type {
  SinapsEventHooks,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';

export type RouterStrategy = 'failover' | 'load-balance' | 'lowest-cost';

export interface RouterOptions {
  strategy?: RouterStrategy;
  hooks?: SinapsEventHooks;
}

export class Router {
  private providers: Provider[];
  private strategy: RouterStrategy;
  private circuitBreaker: CircuitBreaker;
  private hooks?: SinapsEventHooks;
  private currentProviderIndex = 0;

  constructor(
    providers: Provider[],
    circuitBreaker: CircuitBreaker,
    options: RouterOptions = {},
  ) {
    if (!providers || providers.length === 0) {
      throw new Error('At least one provider must be configured');
    }
    this.providers = providers;
    this.strategy = options.strategy || 'failover';
    this.circuitBreaker = circuitBreaker;
    this.hooks = options.hooks;
  }

  getProviderById(id: string): Provider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  async execute(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    let providersList = this.providers;

    if (this.strategy === 'lowest-cost') {
      providersList = [...this.providers].sort((a, b) => {
        const costA = a.costPer1kTokens ?? Infinity;
        const costB = b.costPer1kTokens ?? Infinity;
        if (costA === costB) return 0;
        return costA < costB ? -1 : 1;
      });
    }

    const maxAttempts = providersList.length;
    let startIndex = 0;

    if (this.strategy === 'load-balance') {
      startIndex = this.currentProviderIndex;
      this.currentProviderIndex =
        (this.currentProviderIndex + 1) % providersList.length;
    }

    const errors: Error[] = [];
    let previousProvider: Provider | null = null;
    let previousError: Error | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      const index = (startIndex + i) % providersList.length;
      const provider = providersList[index];

      if (previousProvider && previousError) {
        this.hooks?.onFallback?.(previousError, previousProvider, provider);
      }

      const isAvailable = await this.circuitBreaker.isAvailable(provider.id);
      if (!isAvailable) {
        const error = new Error(
          `Provider ${provider.id} is unavailable (Circuit OPEN)`,
        );
        errors.push(error);
        previousProvider = provider;
        previousError = error;
        continue;
      }

      try {
        return await this.circuitBreaker.execute(provider, request);
      } catch (error) {
        const err = error as Error;
        errors.push(err);

        // Simple rate limit heuristic
        if (
          (err as Error & { status?: number }).status === 429 ||
          err.message.includes('429') ||
          err.message.toLowerCase().includes('rate limit')
        ) {
          this.hooks?.onRateLimit?.(provider, err);
        }

        previousProvider = provider;
        previousError = err;
      }
    }

    throw new AggregateError(errors, 'All providers failed or are unavailable');
  }
}
