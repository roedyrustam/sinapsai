/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type {
  BudgetOptions,
  CacheOptions,
  CircuitBreakerStatus,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  GatewayHealthReport,
  HealthCheckOptions,
  OtelExportOptions,
  OtelResourceMetrics,
  PrometheusExportOptions,
  ProviderHealth,
  SemanticCacheOptions,
  SinapsEventHooks,
  SinapsMetrics,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { BudgetExceededError } from '../types/index.js';
import {
  formatOtelMetrics,
  formatPrometheusMetrics,
} from '../utils/metricsExporter.js';
import { cosineSimilarity, extractPromptText } from '../utils/similarity.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import { HedgedExecutor, type HedgingOptions } from './HedgedExecutor.js';
import type { StateStorage } from './StateStorage.js';

export type {
  BudgetOptions,
  CacheOptions,
  HedgingOptions,
  SemanticCacheOptions,
};
export { BudgetExceededError };

export type RouterStrategy =
  | 'failover'
  | 'load-balance'
  | 'lowest-cost'
  | 'lowest-latency'
  | 'adaptive'
  | 'smart-hybrid';

export interface RouterOptions {
  strategy?: RouterStrategy;
  hooks?: SinapsEventHooks;
  fallbackModels?: string[];
  retries?: number;
  retryDelayMs?: number;
  cache?: CacheOptions;
  storage?: StateStorage;
  budget?: BudgetOptions;
  hedging?: HedgingOptions;
}

interface SemanticCacheEntry {
  model: string;
  prompt: string;
  embedding: number[];
  response: UnifiedApiResponse;
  expiresAt: number;
}

export class Router {
  private providers: Provider[];
  private strategy: RouterStrategy;
  private circuitBreaker: CircuitBreaker;
  private hooks?: SinapsEventHooks;
  private fallbackModels?: string[];
  private currentProviderIndex = 0;
  private retries: number;
  private retryDelayMs: number;
  private cacheOptions?: CacheOptions;
  private storage?: StateStorage;
  private budgetOptions?: BudgetOptions;
  private hedgingOptions?: HedgingOptions;
  private hedgedExecutor?: HedgedExecutor;
  private semanticEntries: SemanticCacheEntry[] = [];
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
    this.fallbackModels = options.fallbackModels;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.cacheOptions = options.cache;
    this.storage = options.storage;
    this.budgetOptions = options.budget;
    this.hedgingOptions = options.hedging;
    if (options.hedging && options.hedging.enabled !== false) {
      this.hedgedExecutor = new HedgedExecutor({
        ...options.hedging,
        onHedgeFired:
          options.hedging.onHedgeFired || options.hooks?.onHedgeFired,
        onHedgeWon: options.hedging.onHedgeWon || options.hooks?.onHedgeWon,
      });
    }
  }

  public getProviderById(id: string): Provider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  public getProviders(): Provider[] {
    return [...this.providers];
  }

  public getHedgedExecutor(): HedgedExecutor | undefined {
    return this.hedgedExecutor;
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

  public async getCircuitBreakerStatus(): Promise<
    Record<string, CircuitBreakerStatus>
  > {
    const statuses: Record<string, CircuitBreakerStatus> = {};
    for (const p of this.providers) {
      statuses[p.id] = await this.circuitBreaker.getStatus(p.id);
    }
    return statuses;
  }

  public async resetCircuitBreaker(providerId?: string): Promise<void> {
    if (providerId) {
      await this.circuitBreaker.reset(providerId);
    } else {
      for (const p of this.providers) {
        await this.circuitBreaker.reset(p.id);
      }
    }
  }

  public async clearCache(): Promise<void> {
    if (this.storage && typeof this.storage.clear === 'function') {
      await this.storage.clear();
    }
    this.semanticEntries = [];
  }

  /**
   * Evaluates health and liveness across all configured providers.
   * Performs passive inspection of circuit states and metrics by default,
   * or active probe pings if options.ping is true.
   */
  public async checkHealth(
    options: HealthCheckOptions = {},
  ): Promise<GatewayHealthReport> {
    const providerHealthList: ProviderHealth[] = [];

    for (const p of this.providers) {
      const cbStatus = await this.circuitBreaker.getStatus(p.id);
      const metric = this.metrics.providerMetrics[p.id];
      const totalReqs = metric ? metric.requests : 0;
      const successes = metric ? metric.successes : 0;
      const successRate = totalReqs > 0 ? successes / totalReqs : 1.0;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (cbStatus.state === 'OPEN') {
        status = 'unhealthy';
      } else if (
        cbStatus.state === 'HALF_OPEN' ||
        (totalReqs >= 5 && successRate < 0.6)
      ) {
        status = 'degraded';
      }

      let latencyMs: number | undefined = metric?.averageLatencyMs;
      let error: string | undefined;

      if (options.ping) {
        const start = Date.now();
        try {
          const timeoutMs = options.timeoutMs ?? 3000;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          await p.generateContent({
            model:
              p.defaultModel ||
              (p.resolveModel ? p.resolveModel('default') : 'default'),
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
            signal: controller.signal,
          });
          clearTimeout(timer);
          latencyMs = Date.now() - start;
        } catch (err: unknown) {
          const e = err as Error;
          error = e?.message || 'Health probe failed';
          status = 'unhealthy';
        }
      }

      providerHealthList.push({
        id: p.id,
        status,
        circuitState: cbStatus.state,
        latencyMs,
        error,
        successRate: Number(successRate.toFixed(4)),
      });
    }

    const allUnhealthy = providerHealthList.every(
      (ph) => ph.status === 'unhealthy',
    );
    const allHealthy = providerHealthList.every(
      (ph) => ph.status === 'healthy',
    );
    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' = allUnhealthy
      ? 'unhealthy'
      : allHealthy
        ? 'healthy'
        : 'degraded';

    return {
      status: overallStatus,
      timestamp: Date.now(),
      providers: providerHealthList,
    };
  }

  private recordMetrics(
    providerId: string,
    success: boolean,
    latencyMs: number,
    promptTokens = 0,
    completionTokens = 0,
    costUsd = 0,
    cachedPromptTokens = 0,
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
      pm.latencySumMs += latencyMs;
      pm.averageLatencyMs = Math.round(pm.latencySumMs / pm.successes);
    } else {
      pm.failures++;
      this.metrics.failedRequests++;
    }
    pm.promptTokens += promptTokens;
    pm.completionTokens += completionTokens;

    this.metrics.totalPromptTokens += promptTokens;
    this.metrics.totalCompletionTokens += completionTokens;
    this.metrics.totalTokens += promptTokens + completionTokens;
    if (cachedPromptTokens > 0) {
      this.metrics.totalCachedPromptTokens =
        (this.metrics.totalCachedPromptTokens || 0) + cachedPromptTokens;
      pm.cachedPromptTokens = (pm.cachedPromptTokens || 0) + cachedPromptTokens;
    }
    this.metrics.estimatedCostUsd = Number(
      (this.metrics.estimatedCostUsd + costUsd).toFixed(6),
    );

    if (
      this.budgetOptions?.action === 'warn' &&
      this.budgetOptions.onBudgetWarning
    ) {
      const costExceeded =
        this.budgetOptions.maxCostUsd !== undefined &&
        this.metrics.estimatedCostUsd >= this.budgetOptions.maxCostUsd;
      const tokensExceeded =
        this.budgetOptions.maxTotalTokens !== undefined &&
        this.metrics.totalTokens >= this.budgetOptions.maxTotalTokens;
      if (costExceeded || tokensExceeded) {
        this.budgetOptions.onBudgetWarning(
          this.metrics.estimatedCostUsd,
          this.budgetOptions.maxCostUsd ?? 0,
        );
      }
    }
  }

  private checkBudget(): void {
    if (!this.budgetOptions) return;

    const {
      maxCostUsd,
      maxTotalTokens,
      action = 'block',
      onBudgetWarning,
    } = this.budgetOptions;

    const costExceeded =
      maxCostUsd !== undefined && this.metrics.estimatedCostUsd >= maxCostUsd;
    const tokensExceeded =
      maxTotalTokens !== undefined &&
      this.metrics.totalTokens >= maxTotalTokens;

    if (costExceeded || tokensExceeded) {
      if (action === 'warn') {
        if (onBudgetWarning) {
          onBudgetWarning(this.metrics.estimatedCostUsd, maxCostUsd ?? 0);
        }
      } else {
        const reason = costExceeded
          ? `Budget cost limit exceeded: $${this.metrics.estimatedCostUsd} >= $${maxCostUsd}`
          : `Budget token limit exceeded: ${this.metrics.totalTokens} >= ${maxTotalTokens} tokens`;
        throw new BudgetExceededError(reason, {
          currentCostUsd: this.metrics.estimatedCostUsd,
          limitUsd: maxCostUsd,
          currentTotalTokens: this.metrics.totalTokens,
          limitTokens: maxTotalTokens,
        });
      }
    }
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
          if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text') {
                totalChars += part.text.length;
              } else if (part.type === 'image_url') {
                totalChars += 1600; // ~400 tokens per image equivalent
              } else if (part.type === 'input_audio') {
                totalChars += 2000;
              }
            }
          }
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

  public calculateAdaptiveScore(
    provider: Provider,
    request?: UnifiedApiRequest,
  ): number {
    const pm = this.metrics.providerMetrics[provider.id];

    // Optimistic baseline for cold-start exploration
    if (!pm || pm.requests === 0) {
      return 100;
    }

    // 1. Reliability (Laplace smoothed success rate)
    const successRate = (pm.successes + 1) / (pm.requests + 2);

    // 2. Latency score (faster = higher score)
    const avgLatency = Math.max(30, pm.averageLatencyMs || 200);
    const latencyScore = 1000 / avgLatency;

    // 3. Cost factor
    let costFactor = 1.0;
    if (request) {
      const estimatedCost = this.estimateRequestCost(provider, request);
      if (estimatedCost === 0) {
        costFactor = 1.5; // Free tier bonus
      } else if (Number.isFinite(estimatedCost) && estimatedCost > 0) {
        costFactor = 1 / (1 + estimatedCost * 50);
      }
    }

    return successRate ** 2 * latencyScore * costFactor * 100;
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

  private getCandidateModels(
    provider: Provider,
    request: UnifiedApiRequest,
  ): string[] {
    const list: string[] = [];
    if (request.model) {
      list.push(request.model);
    }

    if (provider.fallbackModels && Array.isArray(provider.fallbackModels)) {
      for (const m of provider.fallbackModels) {
        if (m && !list.includes(m)) {
          list.push(m);
        }
      }
    }

    const requestFallbacks =
      request.fallbackModels ?? this.fallbackModels ?? [];
    for (const m of requestFallbacks) {
      if (m && !list.includes(m)) {
        list.push(m);
      }
    }

    return list.length > 0 ? list : ['default'];
  }

  private getSemanticCacheConfig(): SemanticCacheOptions | null {
    if (!this.cacheOptions?.semantic) {
      return null;
    }
    if (typeof this.cacheOptions.semantic === 'boolean') {
      return this.cacheOptions.semantic ? { enabled: true } : null;
    }
    return {
      enabled: this.cacheOptions.semantic.enabled !== false,
      ...this.cacheOptions.semantic,
    };
  }

  private async getEmbeddingForText(
    text: string,
    config: SemanticCacheOptions,
  ): Promise<number[] | null> {
    try {
      if (typeof config.customEmbed === 'function') {
        return await config.customEmbed(text);
      }

      const hasEmbeddingProvider = this.providers.some(
        (p) => typeof p.generateEmbedding === 'function',
      );
      if (!hasEmbeddingProvider) {
        return null;
      }

      const res = await this.executeEmbedding({
        model: config.embeddingModel || 'default',
        input: text,
      });

      return res.data[0]?.embedding ?? null;
    } catch (_error) {
      return null;
    }
  }

  async execute(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    this.checkBudget();
    this.metrics.totalRequests++;

    // 1. Check exact Cache if enabled and not streaming
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

    // 2. Check semantic Cache if enabled and not streaming
    let queryEmbedding: number[] | null = null;
    const semanticConfig = this.getSemanticCacheConfig();
    if (
      this.cacheOptions?.enabled &&
      semanticConfig?.enabled &&
      !request.stream
    ) {
      const promptText = extractPromptText(request.messages);
      queryEmbedding = await this.getEmbeddingForText(
        promptText,
        semanticConfig,
      );

      if (queryEmbedding && queryEmbedding.length > 0) {
        const now = Date.now();
        this.semanticEntries = this.semanticEntries.filter(
          (e) => e.expiresAt > now,
        );

        let bestMatch: SemanticCacheEntry | null = null;
        let bestSim = -1;

        for (const entry of this.semanticEntries) {
          if (entry.model === request.model) {
            const sim = cosineSimilarity(queryEmbedding, entry.embedding);
            if (sim > bestSim) {
              bestSim = sim;
              bestMatch = entry;
            }
          }
        }

        const threshold = semanticConfig.similarityThreshold ?? 0.9;
        if (bestMatch && bestSim >= threshold) {
          this.metrics.cachedRequests++;
          this.metrics.successfulRequests++;
          this.hooks?.onSemanticCacheHit?.(
            request,
            bestMatch.response,
            bestSim,
          );
          return bestMatch.response;
        }
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
    } else if (this.strategy === 'lowest-latency') {
      providersList = [...this.providers].sort((a, b) => {
        const reqA = this.metrics.providerMetrics[a.id]?.requests ?? 0;
        const reqB = this.metrics.providerMetrics[b.id]?.requests ?? 0;
        if (reqA === 0 && reqB > 0) return -1;
        if (reqB === 0 && reqA > 0) return 1;
        const latA = this.metrics.providerMetrics[a.id]?.averageLatencyMs ?? 0;
        const latB = this.metrics.providerMetrics[b.id]?.averageLatencyMs ?? 0;
        if (latA === latB) return 0;
        return latA < latB ? -1 : 1;
      });
    } else if (
      this.strategy === 'adaptive' ||
      this.strategy === 'smart-hybrid'
    ) {
      providersList = [...this.providers].sort((a, b) => {
        const scoreA = this.calculateAdaptiveScore(a, request);
        const scoreB = this.calculateAdaptiveScore(b, request);
        if (scoreA === scoreB) return 0;
        return scoreA > scoreB ? -1 : 1;
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

    // Speculative Hedging: Race primary and backup providers if enabled for non-streaming requests
    if (
      this.hedgedExecutor &&
      this.hedgingOptions?.enabled !== false &&
      !request.stream &&
      providersList.length > 1
    ) {
      const availableProviders: Provider[] = [];
      for (const p of providersList) {
        if (this.storage) {
          const throttled = await this.storage.get<number>(`rl:req:${p.id}`);
          if (throttled !== null && throttled <= 0) continue;
        }
        if (await this.circuitBreaker.isAvailable(p.id)) {
          availableProviders.push(p);
        }
      }

      if (availableProviders.length > 1) {
        try {
          const raceResult = await this.hedgedExecutor.execute(
            availableProviders,
            request,
            async (p, reqWithSignal) => {
              return this.executeSingleProvider(p, reqWithSignal);
            },
          );

          await this.saveResponseToCache(
            request,
            raceResult.response,
            queryEmbedding,
            semanticConfig,
          );

          raceResult.response.provider = raceResult.winnerProvider.id;
          return raceResult.response;
        } catch (hedgeErr) {
          errors.push(hedgeErr as Error);
        }
      }
    }

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

      // Candidate models for this provider (Primary requested model + fallbacks)
      const candidateModels = this.getCandidateModels(provider, request);
      let lastModelError: Error | null = null;

      // For non-streaming requests, execute with candidate fallback models and retries
      if (!request.stream) {
        try {
          const apiRes = await this.executeSingleProvider(provider, request);
          await this.saveResponseToCache(
            request,
            apiRes,
            queryEmbedding,
            semanticConfig,
          );
          return apiRes;
        } catch (err) {
          lastModelError = err as Error;
        }
      } else {
        // Candidate models for streaming requests
        for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
          const isStillAvailable = await this.circuitBreaker.isAvailable(
            provider.id,
          );
          if (!isStillAvailable) {
            break;
          }

          const currentModel = candidateModels[mIdx];
          const currentRequest: UnifiedApiRequest =
            currentModel === request.model
              ? request
              : { ...request, model: currentModel };

          const maxRetries = provider.retries ?? this.retries;
          const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
          let attempt = 0;

          while (true) {
            const startTime = Date.now();
            try {
              const res = await this.circuitBreaker.execute(
                provider,
                currentRequest,
              );

              if (
                res != null &&
                typeof res === 'object' &&
                Symbol.asyncIterator in res
              ) {
                const self = this;
                const iterable = res as AsyncIterable<UnifiedApiStreamChunk>;
                let firstChunkTime = 0;
                let collectedPromptTokens = 0;
                let collectedCompletionTokens = 0;
                let collectedCachedPromptTokens = 0;

                return (async function* () {
                  try {
                    for await (const chunk of iterable) {
                      if (!firstChunkTime) {
                        firstChunkTime = Date.now();
                      }
                      if (chunk.usage) {
                        collectedPromptTokens =
                          chunk.usage.promptTokens || collectedPromptTokens;
                        collectedCompletionTokens =
                          chunk.usage.completionTokens ||
                          collectedCompletionTokens;
                        collectedCachedPromptTokens =
                          chunk.usage.cachedPromptTokens ||
                          collectedCachedPromptTokens;
                      }
                      yield chunk;
                    }
                    const totalLatencyMs = Date.now() - startTime;
                    const ttftMs = firstChunkTime
                      ? firstChunkTime - startTime
                      : totalLatencyMs;

                    let costUsd = 0;
                    if (
                      provider.promptCostPer1k !== undefined &&
                      provider.completionCostPer1k !== undefined
                    ) {
                      const uncached = Math.max(
                        0,
                        collectedPromptTokens - collectedCachedPromptTokens,
                      );
                      const effectivePrompt =
                        uncached + collectedCachedPromptTokens * 0.25;
                      costUsd =
                        (effectivePrompt / 1000) * provider.promptCostPer1k +
                        (collectedCompletionTokens / 1000) *
                          provider.completionCostPer1k;
                    } else if (provider.costPer1kTokens !== undefined) {
                      const uncached = Math.max(
                        0,
                        collectedPromptTokens - collectedCachedPromptTokens,
                      );
                      const effectiveTokens =
                        uncached +
                        collectedCachedPromptTokens * 0.25 +
                        collectedCompletionTokens;
                      costUsd =
                        (effectiveTokens / 1000) * provider.costPer1kTokens;
                    }

                    self.recordMetrics(
                      provider.id,
                      true,
                      totalLatencyMs,
                      collectedPromptTokens,
                      collectedCompletionTokens,
                      costUsd,
                      collectedCachedPromptTokens,
                    );

                    self.hooks?.onStreamSuccess?.(
                      provider,
                      ttftMs,
                      totalLatencyMs,
                    );
                  } catch (streamError) {
                    const isAbort =
                      request.signal?.aborted ||
                      (streamError as Error)?.name === 'AbortError' ||
                      (streamError as Error)?.message
                        ?.toLowerCase()
                        .includes('aborted');
                    if (!isAbort) {
                      self.recordMetrics(
                        provider.id,
                        false,
                        Date.now() - startTime,
                        0,
                        0,
                        0,
                      );
                    }
                    throw streamError;
                  }
                })();
              }
            } catch (error) {
              const err = error as Error;

              if (request.signal?.aborted) {
                throw err;
              }

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
              lastModelError = err;

              const isAuthError =
                (err as Error & { status?: number }).status === 401 ||
                err.message.toLowerCase().includes('unauthorized') ||
                err.message.toLowerCase().includes('invalid api key');

              if (isAuthError) {
                break;
              }

              if (mIdx + 1 < candidateModels.length) {
                const nextModel = candidateModels[mIdx + 1];
                this.hooks?.onModelFallback?.(
                  err,
                  provider,
                  currentModel,
                  nextModel,
                );
              }
              break;
            }
          }

          const isAuthError =
            (lastModelError as Error & { status?: number })?.status === 401 ||
            lastModelError?.message?.toLowerCase().includes('unauthorized') ||
            lastModelError?.message?.toLowerCase().includes('invalid api key');
          if (isAuthError) {
            break;
          }
        }
      }

      if (lastModelError) {
        errors.push(lastModelError);
        previousProvider = provider;
        previousError = lastModelError;
      }
    }

    throw new AggregateError(errors, 'All providers failed or are unavailable');
  }

  private async executeSingleProvider(
    provider: Provider,
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse> {
    const candidateModels = this.getCandidateModels(provider, request);
    let lastModelError: Error | null = null;

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const isStillAvailable = await this.circuitBreaker.isAvailable(
        provider.id,
      );
      if (!isStillAvailable) {
        break;
      }

      const currentModel = candidateModels[mIdx];
      const currentRequest: UnifiedApiRequest =
        currentModel === request.model
          ? request
          : { ...request, model: currentModel };

      const maxRetries = provider.retries ?? this.retries;
      const baseDelay = provider.retryDelayMs ?? this.retryDelayMs;
      let attempt = 0;

      while (true) {
        const startTime = Date.now();
        try {
          const res = await this.circuitBreaker.execute(
            provider,
            currentRequest,
          );
          const latencyMs = Date.now() - startTime;

          if ('choices' in (res as UnifiedApiResponse)) {
            const apiRes = res as UnifiedApiResponse;
            this.hooks?.onSuccess?.(provider, apiRes, latencyMs);

            const promptTokens = apiRes.usage?.promptTokens ?? 0;
            const completionTokens = apiRes.usage?.completionTokens ?? 0;
            const cachedPromptTokens = apiRes.usage?.cachedPromptTokens ?? 0;
            let costUsd = 0;
            if (
              provider.promptCostPer1k !== undefined &&
              provider.completionCostPer1k !== undefined
            ) {
              const uncached = Math.max(0, promptTokens - cachedPromptTokens);
              const effectivePrompt = uncached + cachedPromptTokens * 0.25;
              costUsd =
                (effectivePrompt / 1000) * provider.promptCostPer1k +
                (completionTokens / 1000) * provider.completionCostPer1k;
            } else if (provider.costPer1kTokens !== undefined) {
              const uncached = Math.max(0, promptTokens - cachedPromptTokens);
              const effectiveTokens =
                uncached + cachedPromptTokens * 0.25 + completionTokens;
              costUsd = (effectiveTokens / 1000) * provider.costPer1kTokens;
            }
            this.recordMetrics(
              provider.id,
              true,
              latencyMs,
              promptTokens,
              completionTokens,
              costUsd,
              cachedPromptTokens,
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

            apiRes.provider = provider.id;
            return apiRes;
          }
          throw new Error('Invalid response structure received from provider');
        } catch (error) {
          const err = error as Error;

          if (request.signal?.aborted) {
            throw err;
          }

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

          const isAbort =
            request.signal?.aborted ||
            err?.name === 'AbortError' ||
            err?.message?.toLowerCase().includes('aborted');

          if (!isAbort) {
            this.recordMetrics(
              provider.id,
              false,
              Date.now() - startTime,
              0,
              0,
              0,
            );
          }

          lastModelError = err;

          const isAuthError =
            (err as Error & { status?: number }).status === 401 ||
            err.message.toLowerCase().includes('unauthorized') ||
            err.message.toLowerCase().includes('invalid api key');

          if (isAuthError) {
            break;
          }

          if (mIdx + 1 < candidateModels.length) {
            const nextModel = candidateModels[mIdx + 1];
            this.hooks?.onModelFallback?.(
              err,
              provider,
              currentModel,
              nextModel,
            );
          }
          break;
        }
      }

      const isAuthError =
        (lastModelError as Error & { status?: number })?.status === 401 ||
        lastModelError?.message?.toLowerCase().includes('unauthorized') ||
        lastModelError?.message?.toLowerCase().includes('invalid api key');
      if (isAuthError) {
        break;
      }
    }

    throw (
      lastModelError ||
      new Error(`Provider ${provider.id} failed to execute request`)
    );
  }

  private async saveResponseToCache(
    request: UnifiedApiRequest,
    apiRes: UnifiedApiResponse,
    queryEmbedding: number[] | null,
    semanticConfig?: SemanticCacheOptions | null,
  ): Promise<void> {
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

    if (
      this.cacheOptions?.enabled &&
      semanticConfig?.enabled &&
      !request.stream
    ) {
      try {
        const promptText = extractPromptText(request.messages);
        let emb = queryEmbedding;
        if (!emb) {
          emb = await this.getEmbeddingForText(promptText, semanticConfig);
        }
        if (emb && emb.length > 0) {
          const maxEntries = semanticConfig.maxEntries ?? 1000;
          const ttlMs = (this.cacheOptions.ttlSeconds ?? 300) * 1000;
          if (this.semanticEntries.length >= maxEntries) {
            this.semanticEntries.shift();
          }
          this.semanticEntries.push({
            model: request.model,
            prompt: promptText,
            embedding: emb,
            response: apiRes,
            expiresAt: Date.now() + ttlMs,
          });
        }
      } catch (_e) {
        // Ignore semantic cache update error
      }
    }
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
    this.checkBudget();
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
    } else if (this.strategy === 'lowest-latency') {
      providersList = [...eligibleProviders].sort((a, b) => {
        const reqA = this.metrics.providerMetrics[a.id]?.requests ?? 0;
        const reqB = this.metrics.providerMetrics[b.id]?.requests ?? 0;
        if (reqA === 0 && reqB > 0) return -1;
        if (reqB === 0 && reqA > 0) return 1;
        const latA = this.metrics.providerMetrics[a.id]?.averageLatencyMs ?? 0;
        const latB = this.metrics.providerMetrics[b.id]?.averageLatencyMs ?? 0;
        if (latA === latB) return 0;
        return latA < latB ? -1 : 1;
      });
    } else if (
      this.strategy === 'adaptive' ||
      this.strategy === 'smart-hybrid'
    ) {
      providersList = [...eligibleProviders].sort((a, b) => {
        const scoreA = this.calculateAdaptiveScore(a);
        const scoreB = this.calculateAdaptiveScore(b);
        if (scoreA === scoreB) return 0;
        return scoreA > scoreB ? -1 : 1;
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

  /**
   * Formats current gateway telemetry metrics into Prometheus / OpenMetrics exposition format.
   */
  public exportPrometheusMetrics(options?: PrometheusExportOptions): string {
    return formatPrometheusMetrics(this.getMetrics(), options);
  }

  /**
   * Alias for exportPrometheusMetrics.
   */
  public toPrometheusMetrics(options?: PrometheusExportOptions): string {
    return this.exportPrometheusMetrics(options);
  }

  /**
   * Formats current gateway telemetry metrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
   */
  public exportOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics {
    return formatOtelMetrics(this.getMetrics(), options);
  }

  /**
   * Alias for exportOtelMetrics.
   */
  public toOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics {
    return this.exportOtelMetrics(options);
  }
}
