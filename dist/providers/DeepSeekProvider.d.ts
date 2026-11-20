/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const DEEPSEEK_MODELS: {
    readonly V4_PRO: 'deepseek-v4-pro';
    readonly V4_1_FLASH: 'deepseek-v4.1-flash';
    readonly V3_2: 'deepseek-v3.2';
    readonly REASONER: 'deepseek-reasoner';
    readonly R1: 'deepseek-r1';
    readonly CHAT: 'deepseek-chat';
};
export declare const DEEPSEEK_AVAILABILITY_FALLBACKS: Record<string, string[]>;
export declare const DEEPSEEK_DEFAULT_PRICING: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
}>;
export declare class DeepSeekProvider implements Provider {
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
}
//# sourceMappingURL=DeepSeekProvider.d.ts.map