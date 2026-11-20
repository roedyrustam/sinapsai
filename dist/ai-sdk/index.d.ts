/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Integration & Provider Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import { SinapsClient } from '../core/SinapsClient.js';
import { SinapsEmbeddingModel } from './SinapsEmbeddingModel.js';
import type { LanguageModelV2, LanguageModelV3, SinapsAIProvider, SinapsAIProviderInput, SinapsEmbeddingSettings, SinapsModelSettings } from './types.js';
export * from './promptConverter.js';
export * from './SinapsEmbeddingModel.js';
export * from './SinapsLanguageModel.js';
export * from './SinapsLanguageModelV2.js';
export * from './types.js';
/**
 * Creates a Vercel AI SDK-compatible provider backed by SinapsAI's
 * resilient in-process control plane (Circuit Breaker, Failover, Latency Routing, and Semantic Cache).
 */
export declare function createSinapsAI(clientOrOptions: SinapsAIProviderInput): SinapsAIProvider;
export interface SinapsAIProviderV2 {
    (modelId: string, settings?: SinapsModelSettings): LanguageModelV2;
    languageModel(modelId: string, settings?: SinapsModelSettings): LanguageModelV2;
    chat(modelId: string, settings?: SinapsModelSettings): LanguageModelV2;
    textEmbeddingModel(modelId: string, settings?: SinapsEmbeddingSettings): SinapsEmbeddingModel;
    embedding(modelId: string, settings?: SinapsEmbeddingSettings): SinapsEmbeddingModel;
    readonly client: SinapsClient;
}
export interface SinapsAIProviderV3 {
    (modelId: string, settings?: SinapsModelSettings): LanguageModelV3;
    languageModel(modelId: string, settings?: SinapsModelSettings): LanguageModelV3;
    chat(modelId: string, settings?: SinapsModelSettings): LanguageModelV3;
    textEmbeddingModel(modelId: string, settings?: SinapsEmbeddingSettings): SinapsEmbeddingModel;
    embedding(modelId: string, settings?: SinapsEmbeddingSettings): SinapsEmbeddingModel;
    readonly client: SinapsClient;
}
/**
 * Creates a Vercel AI SDK v5 (`specificationVersion: 'v2'`) native provider backed by SinapsAI.
 */
export declare function createSinapsAIV2(clientOrOptions: SinapsAIProviderInput): SinapsAIProviderV2;
/**
 * Creates a Vercel AI SDK v6 (`specificationVersion: 'v3'`) native provider backed by SinapsAI.
 */
export declare function createSinapsAIV3(clientOrOptions: SinapsAIProviderInput): SinapsAIProviderV3;
/**
 * Alias for `createSinapsAI`.
 */
export declare const sinapsai: typeof createSinapsAI;
//# sourceMappingURL=index.d.ts.map