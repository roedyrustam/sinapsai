import type { Provider } from '../providers/Provider.js';
import type { SinapsEventHooks, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
export type RouterStrategy = 'failover' | 'load-balance' | 'lowest-cost';
export interface RouterOptions {
    strategy?: RouterStrategy;
    hooks?: SinapsEventHooks;
}
export declare class Router {
    private providers;
    private strategy;
    private circuitBreaker;
    private hooks?;
    private currentProviderIndex;
    constructor(providers: Provider[], circuitBreaker: CircuitBreaker, options?: RouterOptions);
    getProviderById(id: string): Provider | undefined;
    execute(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
}
//# sourceMappingURL=Router.d.ts.map