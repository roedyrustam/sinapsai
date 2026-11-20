/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * OpenAI Frontier Provider (Chat Completions + Responses API + Embeddings)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { CreateEmbeddingRequest, CreateEmbeddingResponse, ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const OPENAI_MODELS: {
    readonly GPT_5_6_SOL: 'gpt-5.6-sol-medium';
    readonly GPT_5_5: 'gpt-5.5';
    readonly GPT_5_4: 'gpt-5.4';
    readonly GPT_5: 'gpt-5';
    readonly GPT_5_MINI: 'gpt-5-mini';
    readonly GPT_5_NANO: 'gpt-5-nano';
    readonly O4_MINI: 'o4-mini';
    readonly O3: 'o3';
    readonly O3_MINI: 'o3-mini';
    readonly GPT_4O: 'gpt-4o';
    readonly GPT_4O_MINI: 'gpt-4o-mini';
    readonly GPT_REALTIME: 'gpt-realtime';
    readonly TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large';
    readonly TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small';
};
export declare const OPENAI_DEFAULT_PRICING: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
}>;
export interface OpenAiProviderConfig extends ProviderConfig {
    /**
     * OpenAI endpoint mode:
     * - 'chat': Standard `/v1/chat/completions` (default)
     * - 'responses': Modern `/v1/responses` API (stateful chaining, web_search_preview, reasoning summaries)
     */
    apiMode?: 'chat' | 'responses';
    /**
     * Automatically map `role: 'system'` to `role: 'developer'` on reasoning models (o1/o3/o4/gpt-5+).
     * Default: false (preserves explicit `role: 'developer'` when sent).
     */
    useDeveloperRole?: boolean;
    /**
     * Default processing service tier ('auto' | 'default' | 'flex' | 'priority').
     */
    serviceTier?: 'auto' | 'default' | 'flex' | 'priority';
}
export declare class OpenAiProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: OpenAiProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    get defaultModel(): string | undefined;
    resolveModel(model: string): string;
    private normalizeReasoningEffort;
    private isReasoningOrGpt5Model;
    formatRequest(request: UnifiedApiRequest): any;
    /**
     * Formats a UnifiedApiRequest into OpenAI Responses API (`/v1/responses`) payload.
     */
    formatResponsesRequest(request: UnifiedApiRequest): any;
    private buildUsage;
    formatResponse(data: any): UnifiedApiResponse;
    /**
     * Parses an OpenAI Responses API (`/v1/responses`) JSON payload into UnifiedApiResponse.
     */
    formatResponsesResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    generateEmbedding(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
}
//# sourceMappingURL=OpenAiProvider.d.ts.map