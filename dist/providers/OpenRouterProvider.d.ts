import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
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
 * Curated list of verified OpenRouter free models ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export declare const OPENROUTER_FREE_MODELS: readonly ['openrouter/free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'thinkingmachines/inkling:free', 'thinkingmachines/inkling-small:free', 'cohere/north-mini-code:free', 'liquid/lfm-2.5-2.6b:free', 'apodex/apodex-1.1-mini:free'];
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
    resolveModel(model: string): string;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
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
 * Automatically defaults model to 'openrouter/free', sets zero token cost, and configures free fallback models.
 */
export declare function createOpenRouterFreeProvider(config?: OpenRouterFreeProviderConfig): OpenRouterProvider;
//# sourceMappingURL=OpenRouterProvider.d.ts.map