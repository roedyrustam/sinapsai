/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

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
  promptCostPer1k?: number;
  completionCostPer1k?: number;
  defaultModel?: string;
  fallbackModels?: string[];
  retries?: number;
  retryDelayMs?: number;
  resolveModel?(model: string): string;
  generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
  generateEmbedding?(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse>;
}
