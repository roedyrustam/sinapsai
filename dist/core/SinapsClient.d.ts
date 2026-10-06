import type { Provider } from '../providers/Provider.js';
import type { CreateChatCompletionRequest, CreateChatCompletionRequestNonStreaming, CreateChatCompletionRequestStreaming, CreateEmbeddingRequest, CreateEmbeddingResponse, SinapsEventHooks, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { type CacheOptions, type RouterStrategy } from './Router.js';
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
export declare class SinapsClient {
    private router;
    private storage;
    constructor(options: SinapsClientOptions);
    readonly chat: {
        completions: {
            create: {
                (request: CreateChatCompletionRequestStreaming): Promise<AsyncIterable<UnifiedApiStreamChunk>>;
                (request: CreateChatCompletionRequestNonStreaming): Promise<UnifiedApiResponse>;
                (request: CreateChatCompletionRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
            };
        };
    };
    readonly embeddings: {
        create: (request: CreateEmbeddingRequest) => Promise<CreateEmbeddingResponse>;
    };
}
//# sourceMappingURL=SinapsClient.d.ts.map