import type { Provider } from '../providers/Provider.js';
import type { CreateEmbeddingRequest, CreateEmbeddingResponse, SinapsEventHooks, SinapsMetrics, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
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
export declare class Router {
    private providers;
    private strategy;
    private circuitBreaker;
    private hooks?;
    private currentProviderIndex;
    private retries;
    private retryDelayMs;
    private cacheOptions?;
    private storage?;
    private metrics;
    constructor(providers: Provider[], circuitBreaker: CircuitBreaker, options?: RouterOptions);
    getProviderById(id: string): Provider | undefined;
    getMetrics(): SinapsMetrics;
    private recordMetrics;
    private estimateRequestCost;
    private computeCacheKey;
    private isRetryableError;
    execute(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    private computeEmbeddingCacheKey;
    executeEmbedding(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
}
//# sourceMappingURL=Router.d.ts.map