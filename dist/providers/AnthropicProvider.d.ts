/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Anthropic Claude Provider (Adaptive Thinking, Native Structured Outputs, 1h Prompt Cache TTL, 1M Context)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare const ANTHROPIC_MODELS: {
    readonly CLAUDE_SONNET_5_5: 'claude-sonnet-5-5';
    readonly CLAUDE_OPUS_5_5: 'claude-opus-5-5';
    readonly CLAUDE_FABLE_5_1: 'claude-fable-5-1';
    readonly CLAUDE_OPUS_4_7: 'claude-opus-4-7';
    readonly CLAUDE_SONNET_4_6: 'claude-sonnet-4-6';
    readonly CLAUDE_OPUS_4_6: 'claude-opus-4-6';
    readonly CLAUDE_HAIKU_4_5: 'claude-haiku-4-5';
    readonly CLAUDE_3_7_SONNET: 'claude-3-7-sonnet-20250219';
    readonly CLAUDE_3_5_SONNET: 'claude-3-5-sonnet-20241022';
    readonly CLAUDE_3_5_HAIKU: 'claude-3-5-haiku-20241022';
};
export declare const ANTHROPIC_AVAILABILITY_FALLBACKS: Record<string, string[]>;
export declare const ANTHROPIC_DEFAULT_PRICING: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
}>;
export interface AnthropicProviderConfig extends ProviderConfig {
    /**
     * Thinking configuration mode:
     * - 'auto' (default): Uses Adaptive Thinking (`thinking: { type: 'adaptive' }` + `output_config.effort`)
     *   on Claude 4.6 / 4.7 / 5.x models and `budget_tokens` on Claude 3.7 / 4.5 models.
     * - 'adaptive': Always emits `{ type: 'adaptive' }` + `output_config.effort`.
     * - 'budget': Always emits `{ type: 'enabled', budget_tokens }`.
     */
    thinkingMode?: 'auto' | 'adaptive' | 'budget';
    /**
     * Enable native constrained structured output (`output_config.format`).
     * Default: auto-enabled on Claude 4.5+ / 4.6 / 4.7 / 5.x models.
     */
    nativeStructuredOutput?: boolean;
    /**
     * Enable 1M-token context window beta header (`context-1m-2025-08-07`).
     */
    extendedContext?: boolean;
    /**
     * Automatically configure availability fallback models (e.g. Claude Opus 5.5 -> Claude Opus 4.6).
     */
    enableAvailabilityFallback?: boolean;
}
export declare class AnthropicProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: AnthropicProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    get defaultModel(): string | undefined;
    static isAdaptiveThinkingModel(modelId: string): boolean;
    static supportsNativeStructuredOutput(modelId: string): boolean;
    resolveModel(model: string): string;
    private mapAdaptiveEffort;
    private mapBudgetFromEffort;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
}
//# sourceMappingURL=AnthropicProvider.d.ts.map