/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { Provider } from '../providers/Provider.js';
import type { BatchOptions, BatchResult, CircuitBreakerStatus, CreateChatCompletionRequest, CreateChatCompletionRequestNonStreaming, CreateChatCompletionRequestStreaming, CreateEmbeddingRequest, CreateEmbeddingResponse, SinapsEventHooks, SinapsMetrics, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { type CacheOptions, type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';
import { type StreamAccumulatorOptions } from '../utils/streamAccumulator.js';
export interface ExtendedPIIGuardrailsOptions extends PIIGuardrailsOptions {
    /**
     * When true, applies reversible tokenization to outgoing messages and
     * automatically restores the original PII values into the non-streaming LLM response.
     * Default: false
     */
    reversible?: boolean;
}
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
    /**
     * Optional PII guardrails configuration.
     * When enabled, automatically redacts or tokenizes personally identifiable information
     * (email, phone, credit card, SSN, IP) from all outgoing messages before
     * they are sent to LLM providers.
     */
    piiGuardrails?: ExtendedPIIGuardrailsOptions | boolean;
}
export declare class SinapsClient {
    private router;
    private storage;
    readonly guardrails?: PIIGuardrails;
    private isReversiblePII;
    constructor(options: SinapsClientOptions);
    readonly chat: {
        completions: {
            create: {
                (request: CreateChatCompletionRequestStreaming): Promise<AsyncIterable<UnifiedApiStreamChunk>>;
                (request: CreateChatCompletionRequestNonStreaming): Promise<UnifiedApiResponse>;
                (request: CreateChatCompletionRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
            };
            /**
             * Accumulates a streaming response into a complete UnifiedApiResponse.
             */
            accumulateStream: (stream: AsyncIterable<UnifiedApiStreamChunk>, options?: StreamAccumulatorOptions) => Promise<UnifiedApiResponse>;
            /**
             * Safely extracts and parses JSON data from a response or text string.
             */
            extractJson: <T = unknown>(textOrResponse: string | UnifiedApiResponse) => T;
        };
    };
    /**
     * Helper to accumulate streaming chunks into a single UnifiedApiResponse.
     */
    accumulateStream(stream: AsyncIterable<UnifiedApiStreamChunk>, options?: StreamAccumulatorOptions): Promise<UnifiedApiResponse>;
    /**
     * Helper to safely extract JSON from LLM text responses or response objects.
     */
    extractJson<T = unknown>(textOrResponse: string | UnifiedApiResponse): T;
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