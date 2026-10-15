/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK EmbeddingModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { SinapsClient } from '../core/SinapsClient.js';
import type {
  EmbeddingModelV1,
  EmbeddingModelV1CallOptions,
  EmbeddingModelV1Result,
  SinapsEmbeddingSettings,
} from './types.js';

export class SinapsEmbeddingModel implements EmbeddingModelV1 {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'sinapsai';
  public readonly modelId: string;
  public readonly maxEmbeddingsPerCall = 2048;
  public readonly supportsParallelCalls = true;

  private client: SinapsClient;
  private settings?: SinapsEmbeddingSettings;

  constructor(
    client: SinapsClient,
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }

  async doEmbed(
    options: EmbeddingModelV1CallOptions,
  ): Promise<EmbeddingModelV1Result> {
    const res = await this.client.embeddings.create({
      model: this.modelId,
      input: options.values,
      signal: options.abortSignal,
      dimensions: this.settings?.dimensions,
    });

    const embeddings = res.data.map((item) => item.embedding);
    const tokens = res.usage?.promptTokens ?? 0;

    return {
      embeddings,
      usage: {
        tokens,
      },
    };
  }
}
