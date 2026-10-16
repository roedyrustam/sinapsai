/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK LanguageModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { SinapsClient } from '../core/SinapsClient.js';
import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1Result, LanguageModelV1StreamPart, SinapsModelSettings } from './types.js';
export declare class SinapsLanguageModel implements LanguageModelV1 {
    readonly specificationVersion: 'v1';
    readonly provider = "sinapsai";
    readonly modelId: string;
    readonly defaultObjectGenerationMode: 'json';
    readonly supportsImageUrls = true;
    private client;
    private settings?;
    constructor(client: SinapsClient, modelId: string, settings?: SinapsModelSettings);
    doGenerate(options: LanguageModelV1CallOptions): Promise<LanguageModelV1Result>;
    doStream(options: LanguageModelV1CallOptions): Promise<{
        stream: ReadableStream<LanguageModelV1StreamPart>;
        rawCall: {
            rawPrompt: unknown;
            rawSettings: Record<string, unknown>;
        };
    }>;
}
//# sourceMappingURL=SinapsLanguageModel.d.ts.map