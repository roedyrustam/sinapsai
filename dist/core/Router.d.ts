import type { Provider } from '../providers/Provider.js';
import type { CacheOptions, CircuitBreakerStatus, CreateEmbeddingRequest, CreateEmbeddingResponse, SemanticCacheOptions, SinapsEventHooks, SinapsMetrics, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import type { StateStorage } from './StateStorage.js';
export type { CacheOptions, SemanticCacheOptions };
export type RouterStrategy = 'failover' | 'load-balance' | 'lowest-cost' | 'lowest-latency';
export interface RouterOptions {
    strategy?: RouterStrategy;
    hooks?: SinapsEventHooks;
    fallbackModels?: string[];
    retries?: number;
    retryDelayMs?: number;
    cache?: CacheOptions;
    storage?: StateStorage;
}
export declare class Router {
    private providers;
    private strategy;
    private circuitBreaker;
    private hooks?;
    private fallbackModels?;
    private currentProviderIndex;
    private retries;
    private retryDelayMs;
    private cacheOptions?;
    private storage?;
    private semanticEntries;
    private metrics;
    constructor(providers: Provider[], circuitBreaker: CircuitBreaker, options?: RouterOptions);
    getProviderById(id: string): Provider | undefined;
    getMetrics(): SinapsMetrics;
    getCircuitBreakerStatus(): Promise<Record<string, CircuitBreakerStatus>>;
    resetCircuitBreaker(providerId?: string): Promise<void>;
    clearCache(): Promise<void>;
    private recordMetrics;
    private estimateRequestCost;
    private computeCacheKey;
    private isRetryableError;
    private getCandidateModels;
    private getSemanticCacheConfig;
    private getEmbeddingForText;
    execute(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    private computeEmbeddingCacheKey;
    executeEmbedding(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
}
//# sourceMappingURL=Router.d.ts.map