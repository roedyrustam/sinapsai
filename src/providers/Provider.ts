import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';

export interface Provider {
  id: string;
  name: string;
  costPer1kTokens?: number;
  retries?: number;
  retryDelayMs?: number;
  generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
  generateEmbedding?(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse>;
}
