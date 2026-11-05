/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
/**
 * OpenRouter native provider routing controls.
 * @see https://openrouter.ai/docs/features/provider-routing
 */
export interface OpenRouterProviderPreferences {
    /** Prioritized list of provider slugs (e.g. ['together', 'deepinfra']) */
    order?: string[];
    /** Whether OpenRouter can route to backup providers on rate limit/outage (default: true) */
    allow_fallbacks?: boolean;
    /** Filter to providers supporting all request parameters */
    require_parameters?: boolean;
    /** Data collection preference ('allow' or 'deny') */
    data_collection?: 'allow' | 'deny';
    /** List of provider slugs to ignore / exclude */
    ignore?: string[];
    /** Allowed quantizations, e.g. ['int4', 'int8', 'fp8', 'fp16'] */
    quantizations?: string[];
    /** Strategy for sorting providers: 'price', 'throughput', or 'latency' */
    sort?: 'price' | 'throughput' | 'latency';
}
export interface OpenRouterProviderConfig extends ProviderConfig {
    /**
     * Optional site URL sent in the `HTTP-Referer` header for rankings on openrouter.ai.
     */
    siteUrl?: string;
    /**
     * Optional site/app title sent in the `X-Title` header for rankings on openrouter.ai.
     */
    siteName?: string;
    /**
     * Optional ordered list of fallback models sent in OpenRouter's native `models` parameter.
     * If the primary model fails (e.g. rate limit 429, downtime), OpenRouter iterates through these models in order.
     * Ideal for chaining free models (e.g. ['openrouter/free', 'google/gemma-4-31b-it:free']).
     */
    fallbackModels?: string[];
    /**
     * When true, explicitly configures OpenRouter for Free Tier usage:
     * - Sets provider name to 'OpenRouter (Free)' (if name not customized)
     * - Defaults model to 'openrouter/free'
     * - Defaults costPer1kTokens, promptCostPer1k, and completionCostPer1k to 0
     */
    isFreeTier?: boolean;
    /**
     * When true, strictly restricts all primary and fallback models to verified zero-cost models (:free or openrouter/free).
     * Any non-free models in fallback lists are automatically stripped to guarantee $0 cost and prevent accidental billing.
     */
    strictFree?: boolean;
    /**
     * Optional native OpenRouter provider routing preferences.
     */
    providerPreferences?: OpenRouterProviderPreferences;
    /**
     * Optional prompt transforms (e.g. ['middle-out'] for context window compression).
     */
    transforms?: string[];
}
export interface OpenRouterFreeProviderConfig extends Omit<OpenRouterProviderConfig, 'costPer1kTokens' | 'promptCostPer1k' | 'completionCostPer1k'> {
    /**
     * Optional preferred free model (defaults to 'openrouter/free').
     * Any model ending in ':free' or 'openrouter/free'.
     */
    model?: string;
}
export interface OpenRouterModelInfo {
    id: string;
    name: string;
    description?: string;
    contextLength?: number;
    pricing?: {
        prompt: string | number;
        completion: string | number;
    };
    supportedParameters?: string[];
    isFree: boolean;
}
/**
 * Metadata for a verified free tier model on OpenRouter.
 */
export interface OpenRouterFreeModelMeta {
    id: string;
    name: string;
    developer: string;
    contextLength: number;
    capabilities: {
        tools: boolean;
        jsonMode: boolean;
        reasoning: boolean;
        vision: boolean;
    };
    description: string;
}
/**
 * Curated catalog of verified OpenRouter free tier models ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export declare const OPENROUTER_FREE_MODEL_CATALOG: Record<string, OpenRouterFreeModelMeta>;
/**
 * Curated list of verified OpenRouter free model IDs ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export declare const OPENROUTER_FREE_MODELS: readonly ['openrouter/free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'nvidia/nemotron-3.5-content-safety:free', 'cohere/north-mini-code:free', 'liquid/lfm-2.5-2.6b:free', 'dots-studio/dots-3-note-preview:free', 'recursive/flint-v1.0:free', 'xingchen-agi/xing4.0-29b-a4b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'meta-llama/llama-3.1-8b-instruct:free', 'meta-llama/llama-3.2-3b-instruct:free', 'deepseek/deepseek-r1:free', 'deepseek/deepseek-chat:free', 'qwen/qwen-2.5-coder-32b-instruct:free', 'mistralai/mistral-7b-instruct:free'];
/**
 * Recommended default fallback chain across verified high-availability free tier models.
 * Automatically rotates to another zero-cost model if one hits rate limits (429) or downtime (503).
 */
export declare const OPENROUTER_DEFAULT_FREE_FALLBACKS: readonly string[];
/**
 * Checks whether a given model identifier belongs to OpenRouter's free tier.
 */
export declare function isOpenRouterFreeModel(model: string): boolean;
export declare class OpenRouterProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: OpenRouterProviderConfig);
    private isConfiguredModelFree;
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    get defaultModel(): string | undefined;
    resolveModel(model: string): string;
    /**
     * Look up static metadata for a free model in the catalog.
     */
    getFreeModelMeta(modelId: string): OpenRouterFreeModelMeta | undefined;
    /**
     * Check whether a model ID is a free tier model.
     */
    isFreeModel(modelId: string): boolean;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    /**
     * Fetches the dynamic list of free models directly from the OpenRouter API.
     * Matches models listed on https://openrouter.ai/models?variant=free ($0 prompt/completion pricing or :free suffix).
     */
    listFreeModels(signal?: AbortSignal): Promise<OpenRouterModelInfo[]>;
    /**
     * Fetches the dynamic list of free models directly from the OpenRouter API.
     * Matches models listed on https://openrouter.ai/models?variant=free ($0 prompt/completion pricing or :free suffix).
     */
    static fetchFreeModels(options?: {
        apiKey?: string;
        baseUrl?: string;
        signal?: AbortSignal;
    }): Promise<OpenRouterModelInfo[]>;
}
/**
 * Factory to create a pre-configured OpenRouter provider optimized for Free Tier models.
 * Automatically defaults model to 'openrouter/free', sets zero token cost, enables strictFree billing protection,
 * and configures high-availability free fallback models.
 */
export declare function createOpenRouterFreeProvider(config?: OpenRouterFreeProviderConfig): OpenRouterProvider;
//# sourceMappingURL=OpenRouterProvider.d.ts.map