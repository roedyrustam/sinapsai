/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { CreateEmbeddingRequest, CreateEmbeddingResponse, ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const GEMINI_MODELS: {
    readonly FLASH_2_5: 'gemini-2.5-flash';
    readonly FLASH_LITE_2_5: 'gemini-2.5-flash-lite';
    readonly PRO_2_5: 'gemini-2.5-pro';
    readonly FLASH_3_8: 'gemini-3.8-flash';
    readonly FLASH_3_6: 'gemini-3.6-flash';
    readonly FLASH_LITE_3_5: 'gemini-3.5-flash-lite';
    readonly PRO_3_1_PREVIEW: 'gemini-3.1-pro-preview';
    readonly FLASH_LATEST: 'gemini-flash-latest';
    readonly PRO_LATEST: 'gemini-pro-latest';
    readonly EMBEDDING_001: 'gemini-embedding-001';
    readonly EMBEDDING_2: 'gemini-embedding-2';
    readonly TEXT_EMBEDDING_004: 'text-embedding-004';
};
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
}
//# sourceMappingURL=GeminiProvider.d.ts.map