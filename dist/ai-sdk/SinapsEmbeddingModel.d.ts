/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK EmbeddingModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { SinapsClient } from '../core/SinapsClient.js';
import type { EmbeddingModelV1, EmbeddingModelV1CallOptions, EmbeddingModelV1Result, SinapsEmbeddingSettings } from './types.js';
export declare class SinapsEmbeddingModel implements EmbeddingModelV1 {
    readonly specificationVersion: 'v1';
    readonly provider = "sinapsai";
    readonly modelId: string;
    readonly maxEmbeddingsPerCall = 2048;
    readonly supportsParallelCalls = true;
    private client;
    private settings?;
    constructor(client: SinapsClient, modelId: string, settings?: SinapsEmbeddingSettings);
    doEmbed(options: EmbeddingModelV1CallOptions): Promise<EmbeddingModelV1Result>;
}
//# sourceMappingURL=SinapsEmbeddingModel.d.ts.map