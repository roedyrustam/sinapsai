import type { Provider } from '../providers/Provider.js';
import type {
  SinapsEventHooks,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { Router, type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';

export interface SinapsClientOptions {
  providers: Provider[];
  strategy?: RouterStrategy;
  storage?: StateStorage;
  circuitBreaker?: CircuitBreakerOptions;
  hooks?: SinapsEventHooks;
}

export class SinapsClient {
  private router: Router;
  private storage: StateStorage;

  constructor(options: SinapsClientOptions) {
    this.storage = options.storage || new InMemoryStorage();
    const cb = new CircuitBreaker(this.storage, {
      ...options.circuitBreaker,
      onCircuitOpen: (providerId: string) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitOpen?.(provider);
        }
      },
      onCircuitClose: (providerId: string) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitClose?.(provider);
        }
      },
    });
    this.router = new Router(options.providers, cb, {
      strategy: options.strategy,
      hooks: options.hooks,
    });
  }

  public readonly chat = {
    completions: {
      create: async (
        request: Omit<UnifiedApiRequest, 'model'> & { model?: string },
      ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> => {
        const fullReq: UnifiedApiRequest = {
          model: request.model || 'default',
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        };
        return this.router.execute(fullReq);
      },
    },
  };
}
