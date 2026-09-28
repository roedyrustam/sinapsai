import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { StateStorage } from './StateStorage.js';
export interface CircuitBreakerOptions {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    onCircuitOpen?: (providerId: string) => void;
    onCircuitClose?: (providerId: string) => void;
}
export declare class CircuitBreaker {
    private storage;
    private failureThreshold;
    private resetTimeoutMs;
    private onCircuitOpen?;
    private onCircuitClose?;
    constructor(storage: StateStorage, options?: CircuitBreakerOptions);
    isAvailable(providerId: string): Promise<boolean>;
    recordSuccess(providerId: string): Promise<void>;
    recordFailure(providerId: string): Promise<void>;
    execute(provider: Provider, request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
}
//# sourceMappingURL=CircuitBreaker.d.ts.map