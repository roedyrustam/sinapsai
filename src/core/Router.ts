import type { Provider } from '../providers/Provider.js';
import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  SinapsEventHooks,
  SinapsMetrics,
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
  private metrics: SinapsMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cachedRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    providerMetrics: {},
  };

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

  public getProviderById(id: string): Provider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  public getMetrics(): SinapsMetrics {
    return {
      ...this.metrics,
      providerMetrics: Object.fromEntries(
        Object.entries(this.metrics.providerMetrics).map(([k, v]) => [
          k,
          { ...v },
        ]),
      ),
    };
  }

  private recordMetrics(
    providerId: string,
    success: boolean,
    latencyMs: number,
    promptTokens = 0,
    completionTokens = 0,
    costUsd = 0,
  ): void {
    if (!this.metrics.providerMetrics[providerId]) {
      this.metrics.providerMetrics[providerId] = {
        requests: 0,
        successes: 0,
        failures: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySumMs: 0,
        averageLatencyMs: 0,
      };
    }

    const pm = this.metrics.providerMetrics[providerId];
    pm.requests++;
    if (success) {
      pm.successes++;
      this.metrics.successfulRequests++;
    } else {
      pm.failures++;
      this.metrics.failedRequests++;
    }
    pm.promptTokens += promptTokens;
    pm.completionTokens += completionTokens;
    pm.latencySumMs += latencyMs;
    pm.averageLatencyMs = Math.round(
      pm.latencySumMs / (pm.successes + pm.failures),
    );

    this.metrics.totalPromptTokens += promptTokens;
    this.metrics.totalCompletionTokens += completionTokens;
    this.metrics.totalTokens += promptTokens + completionTokens;
    this.metrics.estimatedCostUsd = Number(
      (this.metrics.estimatedCostUsd + costUsd).toFixed(6),
    );
  }

  private estimateRequestCost(
    provider: Provider,
    request: UnifiedApiRequest,
  ): number {
    if (
      provider.promptCostPer1k !== undefined &&
      provider.completionCostPer1k !== undefined
    ) {
      let totalChars = 0;
      if (Array.isArray(request.messages)) {
        for (const msg of request.messages) {
          totalChars += msg.content?.length ?? 0;
        }
      }
      const estimatedPromptTokens = Math.max(1, Math.ceil(totalChars / 4));
      const estimatedCompletionTokens = request.maxTokens ?? 500;
      return (
        (estimatedPromptTokens / 1000) * provider.promptCostPer1k +
        (estimatedCompletionTokens / 1000) * provider.completionCostPer1k
      );
    }
    return provider.costPer1kTokens ?? Number.POSITIVE_INFINITY;
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
    this.metrics.totalRequests++;

    // Check Cache if enabled and not streaming
    if (this.cacheOptions?.enabled && !request.stream && this.storage) {
      try {
        const cacheKey = this.computeCacheKey(request);
        const cached = await this.storage.get<UnifiedApiResponse>(cacheKey);
        if (cached) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
          return cached;
        }
      } catch (_e) {
        // Ignore cache lookup errors and proceed
      }
    }

    let providersList = this.providers;

    if (this.strategy === 'lowest-cost') {
      providersList = [...this.providers].sort((a, b) => {
        const costA = this.estimateRequestCost(a, request);
        const costB = this.estimateRequestCost(b, request);
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

      // Check proactive rate-limit throttle
      if (this.storage) {
        const throttled = await this.storage.get<number>(
          `rl:req:${provider.id}`,
        );
        if (throttled !== null && throttled <= 0) {
          const error = new Error(
            `Provider ${provider.id} is proactively throttled due to rate limits`,
          );
          errors.push(error);
          previousProvider = provider;
          previousError = error;
          continue;
        }
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

            const promptTokens = apiRes.usage?.promptTokens ?? 0;
            const completionTokens = apiRes.usage?.completionTokens ?? 0;
            let costUsd = 0;
            if (
              provider.promptCostPer1k !== undefined &&
              provider.completionCostPer1k !== undefined
            ) {
              costUsd =
                (promptTokens / 1000) * provider.promptCostPer1k +
                (completionTokens / 1000) * provider.completionCostPer1k;
            } else if (provider.costPer1kTokens !== undefined) {
              costUsd =
                ((promptTokens + completionTokens) / 1000) *
                provider.costPer1kTokens;
            }

            this.recordMetrics(
              provider.id,
              true,
              latencyMs,
              promptTokens,
              completionTokens,
              costUsd,
            );

            // Adaptive rate-limit handling
            if (apiRes.rateLimit) {
              if (
                apiRes.rateLimit.remainingRequests !== undefined &&
                apiRes.rateLimit.remainingRequests <= 1
              ) {
                this.hooks?.onRateLimitWarning?.(provider, apiRes.rateLimit);
                if (this.storage) {
                  const ttlSec = apiRes.rateLimit.resetMs
                    ? Math.max(1, Math.ceil(apiRes.rateLimit.resetMs / 1000))
                    : 10;
                  await this.storage.set(`rl:req:${provider.id}`, 0, ttlSec);
                }
              }
            }

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
            if (this.storage) {
              await this.storage.set(`rl:req:${provider.id}`, 0, 10);
            }
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

          this.recordMetrics(
            provider.id,
            false,
            Date.now() - startTime,
            0,
            0,
            0,
          );
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
    this.metrics.totalRequests++;

    if (this.cacheOptions?.enabled && this.storage) {
      try {
        const cacheKey = this.computeEmbeddingCacheKey(request);
        const cached =
          await this.storage.get<CreateEmbeddingResponse>(cacheKey);
        if (cached) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
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
        const costA =
          a.promptCostPer1k ?? a.costPer1kTokens ?? Number.POSITIVE_INFINITY;
        const costB =
          b.promptCostPer1k ?? b.costPer1kTokens ?? Number.POSITIVE_INFINITY;
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

      // Check proactive rate-limit throttle
      if (this.storage) {
        const throttled = await this.storage.get<number>(
          `rl:req:${provider.id}`,
        );
        if (throttled !== null && throttled <= 0) {
          const error = new Error(
            `Provider ${provider.id} is proactively throttled due to rate limits`,
          );
          errors.push(error);
          previousProvider = provider;
          previousError = error;
          continue;
        }
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

          const promptTokens = res.usage?.promptTokens ?? 0;
          let costUsd = 0;
          if (provider.promptCostPer1k !== undefined) {
            costUsd = (promptTokens / 1000) * provider.promptCostPer1k;
          } else if (provider.costPer1kTokens !== undefined) {
            costUsd = (promptTokens / 1000) * provider.costPer1kTokens;
          }

          this.recordMetrics(
            provider.id,
            true,
            latencyMs,
            promptTokens,
            0,
            costUsd,
          );

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
            if (this.storage) {
              await this.storage.set(`rl:req:${provider.id}`, 0, 10);
            }
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
          this.recordMetrics(
            provider.id,
            false,
            Date.now() - startTime,
            0,
            0,
            0,
          );
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
