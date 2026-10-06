import type { Provider } from '../providers/Provider.js';
import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  SinapsEventHooks,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import type { StateStorage } from './StateStorage.js';

export type RouterStrategy = 'failover' | 'load-balance' | 'lowest-cost';

export interface CacheOptions {
  enabled?: boolean;
  ttlSeconds?: number;
}

export interface RouterOptions {
  strategy?: RouterStrategy;
  hooks?: SinapsEventHooks;
  retries?: number;
  retryDelayMs?: number;
  cache?: CacheOptions;
  storage?: StateStorage;
}

export class Router {
  private providers: Provider[];
  private strategy: RouterStrategy;
  private circuitBreaker: CircuitBreaker;
  private hooks?: SinapsEventHooks;
  private currentProviderIndex = 0;
  private retries: number;
  private retryDelayMs: number;
  private cacheOptions?: CacheOptions;
  private storage?: StateStorage;

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
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.cacheOptions = options.cache;
    this.storage = options.storage;
  }

  getProviderById(id: string): Provider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  private computeCacheKey(request: UnifiedApiRequest): string {
    const raw = JSON.stringify({
      m: request.model,
      msgs: request.messages,
      t: request.temperature,
      max: request.maxTokens,
    });
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash * 33) ^ raw.charCodeAt(i);
    }
    return `cache:${request.model}:${(hash >>> 0).toString(16)}`;
  }

  private isRetryableError(error: Error): boolean {
    const status = (error as Error & { status?: number }).status;
    if (status) {
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return false;
      }
      return true;
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes('invalid api key') ||
      msg.includes('unauthorized') ||
      msg.includes('not found') ||
      msg.includes('permission denied')
    ) {
      return false;
    }
    return true;
  }

  async execute(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    // Check Cache if enabled and not streaming
    if (this.cacheOptions?.enabled && !request.stream && this.storage) {
      try {
        const cacheKey = this.computeCacheKey(request);
        const cached = await this.storage.get<UnifiedApiResponse>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (_e) {
        // Ignore cache lookup errors and proceed
      }
    }

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

      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;

      while (true) {
        const startTime = Date.now();
        try {
          const res = await this.circuitBreaker.execute(provider, request);
          const latencyMs = Date.now() - startTime;

          if (!request.stream && 'choices' in (res as UnifiedApiResponse)) {
            const apiRes = res as UnifiedApiResponse;
            this.hooks?.onSuccess?.(provider, apiRes, latencyMs);

            if (this.cacheOptions?.enabled && this.storage) {
              try {
                const cacheKey = this.computeCacheKey(request);
                await this.storage.set(
                  cacheKey,
                  apiRes,
                  this.cacheOptions.ttlSeconds ?? 300,
                );
              } catch (_e) {
                // Ignore cache set error
              }
            }
          }

          return res;
        } catch (error) {
          const err = error as Error;

          // Simple rate limit heuristic
          if (
            (err as Error & { status?: number }).status === 429 ||
            err.message.includes('429') ||
            err.message.toLowerCase().includes('rate limit')
          ) {
            this.hooks?.onRateLimit?.(provider, err);
          }

          if (
            attempt < maxRetries &&
            this.isRetryableError(err) &&
            !request.signal?.aborted &&
            (await this.circuitBreaker.isAvailable(provider.id))
          ) {
            attempt++;
            const jitter = Math.random() * 50;
            const delay = Math.min(
              baseDelay * 2 ** (attempt - 1) + jitter,
              10000,
            );
            this.hooks?.onRetry?.(provider, err, attempt, delay);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          errors.push(err);
          previousProvider = provider;
          previousError = err;
          break;
        }
      }
    }

    throw new AggregateError(errors, 'All providers failed or are unavailable');
  }

  private computeEmbeddingCacheKey(request: CreateEmbeddingRequest): string {
    const raw = JSON.stringify({
      m: request.model,
      inp: request.input,
    });
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash * 33) ^ raw.charCodeAt(i);
    }
    return `cache:emb:${request.model}:${(hash >>> 0).toString(16)}`;
  }

  async executeEmbedding(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    if (this.cacheOptions?.enabled && this.storage) {
      try {
        const cacheKey = this.computeEmbeddingCacheKey(request);
        const cached =
          await this.storage.get<CreateEmbeddingResponse>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (_e) {
        // Ignore cache lookup errors
      }
    }

    const eligibleProviders = this.providers.filter(
      (p) => typeof p.generateEmbedding === 'function',
    );

    if (eligibleProviders.length === 0) {
      throw new Error(
        'No configured provider supports embedding generation (generateEmbedding)',
      );
    }

    let providersList = eligibleProviders;

    if (this.strategy === 'lowest-cost') {
      providersList = [...eligibleProviders].sort((a, b) => {
        const costA = a.costPer1kTokens ?? Infinity;
        const costB = b.costPer1kTokens ?? Infinity;
        if (costA === costB) return 0;
        return costA < costB ? -1 : 1;
      });
    }

    const maxAttempts = providersList.length;
    let startIndex = 0;

    if (this.strategy === 'load-balance') {
      startIndex = this.currentProviderIndex % providersList.length;
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

      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;

      while (true) {
        const startTime = Date.now();
        try {
          if (!provider.generateEmbedding) {
            throw new Error(
              `Provider ${provider.id} does not support generateEmbedding`,
            );
          }
          const res = await provider.generateEmbedding(request);
          const latencyMs = Date.now() - startTime;

          await this.circuitBreaker.recordSuccess(provider.id);
          this.hooks?.onEmbeddingSuccess?.(provider, res, latencyMs);

          if (this.cacheOptions?.enabled && this.storage) {
            try {
              const cacheKey = this.computeEmbeddingCacheKey(request);
              await this.storage.set(
                cacheKey,
                res,
                this.cacheOptions.ttlSeconds ?? 300,
              );
            } catch (_e) {
              // Ignore cache set error
            }
          }

          return res;
        } catch (error) {
          const err = error as Error;

          if (
            (err as Error & { status?: number }).status === 429 ||
            err.message.includes('429') ||
            err.message.toLowerCase().includes('rate limit')
          ) {
            this.hooks?.onRateLimit?.(provider, err);
          }

          if (
            attempt < maxRetries &&
            this.isRetryableError(err) &&
            !request.signal?.aborted &&
            (await this.circuitBreaker.isAvailable(provider.id))
          ) {
            attempt++;
            const jitter = Math.random() * 50;
            const delay = Math.min(
              baseDelay * 2 ** (attempt - 1) + jitter,
              10000,
            );
            this.hooks?.onRetry?.(provider, err, attempt, delay);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          await this.circuitBreaker.recordFailure(provider.id);
          errors.push(err);
          previousProvider = provider;
          previousError = err;
          break;
        }
      }
    }

    throw new AggregateError(
      errors,
      'All eligible embedding providers failed or are unavailable',
    );
  }
}
