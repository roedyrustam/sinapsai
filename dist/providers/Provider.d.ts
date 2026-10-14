import type { CreateEmbeddingRequest, CreateEmbeddingResponse, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
export interface Provider {
    id: string;
    name: string;
    costPer1kTokens?: number;
    promptCostPer1k?: number;
    completionCostPer1k?: number;
    fallbackModels?: string[];
    retries?: number;
    retryDelayMs?: number;
    resolveModel?(model: string): string;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
    generateEmbedding?(request: CreateEmbeddingRequest): Promise<CreateEmbeddingResponse>;
}
//# sourceMappingURL=Provider.d.ts.map