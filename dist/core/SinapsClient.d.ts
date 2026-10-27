/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { Provider } from '../providers/Provider.js';
import type { AgentStreamEvent, BatchOptions, BatchResult, BudgetOptions, CachedContentInfo, CircuitBreakerStatus, ContextCacheEligibility, CreateCachedContentOptions, CreateChatCompletionRequest, CreateChatCompletionRequestNonStreaming, CreateChatCompletionRequestStreaming, CreateEmbeddingRequest, CreateEmbeddingResponse, GatewayHealthReport, GatewayRateLimitOptions, HealthCheckOptions, OtelExportOptions, OtelResourceMetrics, PrometheusExportOptions, RunWithToolsOptions, RunWithToolsResult, RunWithToolsStreamOptions, SecurityGuardrailsOptions, SinapsEventHooks, SinapsMetrics, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import { type StreamAccumulatorOptions } from '../utils/streamAccumulator.js';
import { AgentSwarm, type AgentSwarmOptions } from './AgentSwarm.js';
import { type CircuitBreakerOptions } from './CircuitBreaker.js';
import { type ContextCompressionOptions, ContextCompressor } from './ContextCompressor.js';
import type { HedgedExecutor, HedgingOptions } from './HedgedExecutor.js';
import { McpToolBridge } from './McpBridge.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { GatewayRateLimiter } from './RateLimiter.js';
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
     * Optional budget options to cap maximum cost (USD) or cumulative tokens,
     * triggering an error or warning callback when exceeded.
     */
    budget?: BudgetOptions;
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
    /**
     * Optional context compression options to truncate conversation turns
     * (sliding-window or middle-out) when prompt messages exceed maxPromptTokens.
     */
    contextCompression?: ContextCompressionOptions;
    /**
     * Optional speculative hedged requests configuration to eliminate P99 tail latency.
     * Automatically fires backup requests after delayMs if primary provider has not responded yet.
     */
    hedging?: HedgingOptions;
    /**
     * Optional in-process gateway rate limiting configuration.
     * Enforces Requests Per Minute (RPM) and Tokens Per Minute (TPM)
     * globally, per-user, per-model, or per-provider using a sliding-window counter.
     */
    rateLimiting?: GatewayRateLimitOptions | boolean;
    /**
     * Optional Model Context Protocol (MCP) tool bridge.
     * If provided, client.mcp will use this bridge; otherwise a default in-process bridge is created.
     */
    mcpBridge?: McpToolBridge;
}
export declare class SinapsClient {
    private router;
    private storage;
    readonly guardrails?: PIIGuardrails;
    readonly securityGuardrails?: SecurityGuardrails;
    readonly contextCompressor?: ContextCompressor;
    readonly hedgedExecutor?: HedgedExecutor;
    readonly rateLimiter?: GatewayRateLimiter;
    readonly mcp: McpToolBridge;
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
     * Helper to locate the configured Gemini provider for context caching and frontier tools.
     */
    private getGeminiProvider;
    /**
     * First-class Google Context Caching management control plane (>32k static prefix token caching).
     */
    readonly contextCache: {
        /**
         * Evaluates whether a prompt or request meets the token threshold for context caching (default: 32,768 tokens).
         */
        evaluateEligibility: (request: Pick<UnifiedApiRequest, 'messages' | 'tools'>, minTokenThreshold?: number) => ContextCacheEligibility;
        /**
         * Creates a cached content resource on Google Gemini for large static prompts.
         */
        create: (options: CreateCachedContentOptions) => Promise<CachedContentInfo>;
        /**
         * Retrieves metadata for an existing cached content resource by name.
         */
        get: (name: string) => Promise<CachedContentInfo>;
        /**
         * Lists active cached content resources.
         */
        list: (pageSize?: number) => Promise<CachedContentInfo[]>;
        /**
         * Deletes a cached content resource by name.
         */
        delete: (name: string) => Promise<void>;
    };
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
    /**
     * Formats current gateway telemetry metrics into Prometheus / OpenMetrics exposition format.
     */
    exportPrometheusMetrics(options?: PrometheusExportOptions): string;
    /**
     * Alias for exportPrometheusMetrics.
     */
    toPrometheusMetrics(options?: PrometheusExportOptions): string;
    /**
     * Formats current gateway telemetry metrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
     */
    exportOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics;
    /**
     * Alias for exportOtelMetrics.
     */
    toOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics;
    /**
     * Runs an autonomous multi-step tool-calling agent loop.
     *
     * Repeatedly queries the model with available MCP tools, executes requested tool calls
     * via the McpToolBridge, feeds results back into the conversation, and returns the final
     * response and complete conversation history once the model finishes or maxSteps is reached.
     */
    runWithTools(options: RunWithToolsOptions): Promise<RunWithToolsResult>;
    /**
     * Runs a streaming autonomous multi-step tool-calling agent loop.
     *
     * Yields real-time `AgentStreamEvent` items (`step-start`, `text-delta`, `reasoning-delta`,
     * `tool-call-start`, `tool-call-result`, `step-finish`, and `done`) while accumulating
     * fragmented streaming tool call arguments and executing MCP tools between turns.
     */
    runWithToolsStream(options: RunWithToolsStreamOptions): AsyncGenerator<AgentStreamEvent, RunWithToolsResult, unknown>;
    /**
     * Instantiate an in-process multi-agent swarm orchestrator
     * supporting role-based specialist delegation, A2A handoffs, and shared memory.
     */
    swarm(options: AgentSwarmOptions): AgentSwarm;
}
//# sourceMappingURL=SinapsClient.d.ts.map