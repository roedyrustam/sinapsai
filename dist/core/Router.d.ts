/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { Provider } from '../providers/Provider.js';
import type { BudgetOptions, CacheOptions, CircuitBreakerStatus, CreateEmbeddingRequest, CreateEmbeddingResponse, GatewayHealthReport, HealthCheckOptions, SemanticCacheOptions, SinapsEventHooks, SinapsMetrics, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { BudgetExceededError } from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import type { StateStorage } from './StateStorage.js';
export type { BudgetOptions, CacheOptions, SemanticCacheOptions };
export { BudgetExceededError };
export type RouterStrategy = 'failover' | 'load-balance' | 'lowest-cost' | 'lowest-latency' | 'adaptive' | 'smart-hybrid';
export interface RouterOptions {
    strategy?: RouterStrategy;
    hooks?: SinapsEventHooks;
    fallbackModels?: string[];
    retries?: number;
    retryDelayMs?: number;
    cache?: CacheOptions;
    storage?: StateStorage;
    budget?: BudgetOptions;
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
    private budgetOptions?;
    private semanticEntries;
    private metrics;
    constructor(providers: Provider[], circuitBreaker: CircuitBreaker, options?: RouterOptions);
    getProviderById(id: string): Provider | undefined;
    getMetrics(): SinapsMetrics;
    getCircuitBreakerStatus(): Promise<Record<string, CircuitBreakerStatus>>;
    resetCircuitBreaker(providerId?: string): Promise<void>;
    clearCache(): Promise<void>;
    /**
     * Evaluates health and liveness across all configured providers.
     * Performs passive inspection of circuit states and metrics by default,
     * or active probe pings if options.ping is true.
     */
    checkHealth(options?: HealthCheckOptions): Promise<GatewayHealthReport>;
    private recordMetrics;
    private checkBudget;
    private estimateRequestCost;
    calculateAdaptiveScore(provider: Provider, request?: UnifiedApiRequest): number;
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