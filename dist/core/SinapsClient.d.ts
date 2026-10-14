import type { Provider } from '../providers/Provider.js';
import type { BatchOptions, BatchResult, CircuitBreakerStatus, CreateChatCompletionRequest, CreateChatCompletionRequestNonStreaming, CreateChatCompletionRequestStreaming, CreateEmbeddingRequest, CreateEmbeddingResponse, SinapsEventHooks, SinapsMetrics, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { type CacheOptions, type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';
export interface SinapsClientOptions {
    providers: Provider[];
    strategy?: RouterStrategy;
    storage?: StateStorage;
    circuitBreaker?: CircuitBreakerOptions;
    hooks?: SinapsEventHooks;
    fallbackModels?: string[];
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
    readonly batch: {
        /**
         * Executes multiple non-streaming chat completion requests concurrently with
         * built-in concurrency control, fail-soft resilience, and progress reporting.
         */
        chat: (requests: CreateChatCompletionRequestNonStreaming[], options?: BatchOptions) => Promise<BatchResult<UnifiedApiResponse>>;
        /**
         * Executes multiple text embedding requests concurrently with
         * built-in concurrency control, fail-soft resilience, and progress reporting.
         */
        embeddings: (requests: CreateEmbeddingRequest[], options?: BatchOptions) => Promise<BatchResult<CreateEmbeddingResponse>>;
        /**
         * General concurrency executor for running any custom async task over an array of items.
         */
        create: <TReq, TRes>(items: TReq[], handler: (item: TReq, index: number) => Promise<TRes>, options?: BatchOptions) => Promise<BatchResult<TRes>>;
    };
    getMetrics(): SinapsMetrics;
    getCircuitBreakerStatus(): Promise<Record<string, CircuitBreakerStatus>>;
    resetCircuitBreaker(providerId?: string): Promise<void>;
    clearCache(): Promise<void>;
}
//# sourceMappingURL=SinapsClient.d.ts.map