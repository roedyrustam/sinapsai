/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { CachedContentInfo, CreateCachedContentOptions, CreateEmbeddingRequest, CreateEmbeddingResponse, ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const GEMINI_MODELS: {
    readonly PRO_4: 'gemini-4-pro';
    readonly ARGON_4: 'gemini-4-argon';
    readonly FLASH_4: 'gemini-4-flash';
    readonly PROJECT_ASTRA: 'gemini-4-flash';
    readonly FLASH_3_8: 'gemini-3.8-flash';
    readonly FLASH_3_6: 'gemini-3.6-flash';
    readonly FLASH_LITE_3_5: 'gemini-3.5-flash-lite';
    readonly PRO_3_1_PREVIEW: 'gemini-3.1-pro-preview';
    readonly FLASH_2_5: 'gemini-2.5-flash';
    readonly FLASH_LITE_2_5: 'gemini-2.5-flash-lite';
    readonly PRO_2_5: 'gemini-2.5-pro';
    readonly FLASH_2_0: 'gemini-2.0-flash';
    readonly FLASH_2_0_LITE: 'gemini-2.0-flash-lite';
    readonly FLASH_THINKING_2_0: 'gemini-2.0-flash-thinking-exp';
    readonly PRO_2_0: 'gemini-2.0-pro-exp';
    readonly FLASH_LATEST: 'gemini-flash-latest';
    readonly PRO_LATEST: 'gemini-pro-latest';
    readonly EMBEDDING_001: 'gemini-embedding-001';
    readonly EMBEDDING_2: 'gemini-embedding-2';
    readonly TEXT_EMBEDDING_004: 'text-embedding-004';
};
export declare const GEMINI_AVAILABILITY_FALLBACKS: Record<string, string[]>;
export declare const GEMINI_DEFAULT_PRICING: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
}>;
export interface GeminiSafetySetting {
    category: 'HARM_CATEGORY_HARASSMENT' | 'HARM_CATEGORY_HATE_SPEECH' | 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | 'HARM_CATEGORY_DANGEROUS_CONTENT' | 'HARM_CATEGORY_CIVIC_INTEGRITY' | string;
    threshold: 'BLOCK_NONE' | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH' | string;
}
export interface GeminiModelInfo {
    id: string;
    displayName: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods: string[];
}
export interface GeminiProviderConfig extends ProviderConfig {
    safetySettings?: GeminiSafetySetting[];
    thinkingBudget?: number;
    cachedContent?: string;
    googleSearch?: boolean;
    codeExecution?: boolean;
    /**
     * Automatically append 'gemini-3.8-flash' fallback when using Gemini 4 frontier models
     * ('gemini-4-pro' or 'gemini-4-argon') to satisfy the Availability Fallback Invariant.
     */
    enableAvailabilityFallback?: boolean;
}
export declare class GeminiProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: GeminiProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    /**
     * Returns the canonical availability fallback models for a given Gemini frontier model.
     */
    static getAvailabilityFallbacks(model: string): string[];
    get defaultModel(): string | undefined;
    resolveModel(model: string): string;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any, model: string): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    generateEmbedding(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
    static fetchAvailableModels(options: {
        apiKey: string;
        baseUrl?: string;
    }): Promise<GeminiModelInfo[]>;
    /**
     * Creates a context cache resource on Google Gemini API for long contexts (>32,768 tokens),
     * providing up to 75%-90% cost reduction and lower latency.
     */
    createCachedContent(options: CreateCachedContentOptions): Promise<CachedContentInfo>;
    /**
     * Fetches metadata for an existing Gemini CachedContent.
     */
    getCachedContent(name: string): Promise<CachedContentInfo>;
    /**
     * Lists active CachedContents for the configured Gemini API key.
     */
    listCachedContents(pageSize?: number): Promise<CachedContentInfo[]>;
    /**
     * Deletes a Gemini CachedContent by name.
     */
    deleteCachedContent(name: string): Promise<void>;
}
//# sourceMappingURL=GeminiProvider.d.ts.map