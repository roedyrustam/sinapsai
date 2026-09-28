import type { Provider } from '../providers/Provider.js';
import type { SinapsEventHooks, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';
export interface SinapsClientOptions {
    providers: Provider[];
    strategy?: RouterStrategy;
    storage?: StateStorage;
    circuitBreaker?: CircuitBreakerOptions;
    hooks?: SinapsEventHooks;
}
export declare class SinapsClient {
    private router;
    private storage;
    constructor(options: SinapsClientOptions);
    readonly chat: {
        completions: {
            create: (request: Omit<UnifiedApiRequest, 'model'> & {
                model?: string;
            }) => Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
        };
    };
}
//# sourceMappingURL=SinapsClient.d.ts.map