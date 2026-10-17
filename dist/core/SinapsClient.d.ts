/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { Provider } from '../providers/Provider.js';
import type { BatchOptions, BatchResult, CircuitBreakerStatus, CreateChatCompletionRequest, CreateChatCompletionRequestNonStreaming, CreateChatCompletionRequestStreaming, CreateEmbeddingRequest, CreateEmbeddingResponse, GatewayHealthReport, HealthCheckOptions, SecurityGuardrailsOptions, SinapsEventHooks, SinapsMetrics, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type StreamAccumulatorOptions } from '../utils/streamAccumulator.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { type CacheOptions, type RouterStrategy } from './Router.js';
import { SecurityGuardrails } from './SecurityGuardrails.js';
import type { StateStorage } from './StateStorage.js';
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
    /**
     * Optional security guardrails to defend against prompt injection, jailbreaks,
     * system role hijacking, and secret exfiltration.
     */
    securityGuardrails?: SecurityGuardrailsOptions | boolean;
    /**
     * Optional dictionary of model aliases (e.g. { 'fast': 'gpt-4o-mini', 'smart': 'claude-3-7-sonnet' }).
     * Allows incoming requests to specify friendly virtual alias names which get resolved automatically.
     */
    modelAliases?: Record<string, string>;
}
export declare class SinapsClient {
    private router;
    private storage;
    readonly guardrails?: PIIGuardrails;
    readonly securityGuardrails?: SecurityGuardrails;
    private isReversiblePII;
    private modelAliases;
    private hooks?;
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
            /**
             * Safely attempts to extract and parse JSON data, returning null if invalid.
             */
            tryExtractJson: <T = unknown>(textOrResponse: string | UnifiedApiResponse) => T | null;
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
    /**
     * Helper to safely attempt JSON extraction, returning null if parsing fails.
     */
    tryExtractJson<T = unknown>(textOrResponse: string | UnifiedApiResponse): T | null;
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
    /**
     * Resolves a model name against configured model aliases.
     */
    resolveModel(modelName?: string): string;
    /**
     * Registers or updates a friendly model alias.
     */
    setModelAlias(alias: string, targetModel: string): void;
    /**
     * Returns all currently registered model aliases.
     */
    getModelAliases(): Record<string, string>;
    /**
     * Removes a registered model alias.
     */
    removeModelAlias(alias: string): boolean;
    /**
     * Checks the health and liveness of all configured providers.
     */
    checkHealth(options?: HealthCheckOptions): Promise<GatewayHealthReport>;
}
//# sourceMappingURL=SinapsClient.d.ts.map