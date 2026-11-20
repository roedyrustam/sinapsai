/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { CreateEmbeddingRequest, CreateEmbeddingResponse, ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const MISTRAL_MODELS: {
    readonly LARGE_4: 'mistral-large-4';
    readonly SMALL_4: 'mistral-small-4';
    readonly MAGISTRAL_MEDIUM: 'magistral-medium-latest';
    readonly CODESTRAL: 'codestral-latest';
    readonly LARGE_LATEST: 'mistral-large-latest';
    readonly SMALL_LATEST: 'mistral-small-latest';
    readonly EMBED: 'mistral-embed';
};
export declare const MISTRAL_AVAILABILITY_FALLBACKS: Record<string, string[]>;
export declare const MISTRAL_DEFAULT_PRICING: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
}>;
export declare class MistralProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: ProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    get defaultModel(): string | undefined;
    resolveModel(model: string): string;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    generateEmbedding(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
}
//# sourceMappingURL=MistralProvider.d.ts.map