import type { Provider } from '../providers/Provider.js';
import type {
  CreateChatCompletionRequest,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  SinapsEventHooks,
  SinapsMetrics,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { type CacheOptions, Router, type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';

export interface SinapsClientOptions {
  providers: Provider[];
  strategy?: RouterStrategy;
  storage?: StateStorage;
  circuitBreaker?: CircuitBreakerOptions;
  hooks?: SinapsEventHooks;
  retries?: number;
  retryDelayMs?: number;
  cache?: CacheOptions;
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
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
      cache: options.cache,
      storage: this.storage,
    });
  }

  public readonly chat = {
    completions: {
      create: (async (
        request: CreateChatCompletionRequest,
      ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> => {
        const fullReq: UnifiedApiRequest = {
          model: request.model || 'default',
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools: request.tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
        };
        return this.router.execute(fullReq);
      }) as {
        (
          request: CreateChatCompletionRequestStreaming,
        ): Promise<AsyncIterable<UnifiedApiStreamChunk>>;
        (
          request: CreateChatCompletionRequestNonStreaming,
        ): Promise<UnifiedApiResponse>;
        (
          request: CreateChatCompletionRequest,
        ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
      },
    },
  };

  public readonly embeddings = {
    create: async (
      request: CreateEmbeddingRequest,
    ): Promise<CreateEmbeddingResponse> => {
      return this.router.executeEmbedding(request);
    },
  };

  public getMetrics(): SinapsMetrics {
    return this.router.getMetrics();
  }
}
