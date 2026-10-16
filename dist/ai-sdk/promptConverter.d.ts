/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Prompt & Tool Converter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ChatMessage, ResponseFormat, ToolDefinition, UnifiedApiRequest } from '../types/index.js';
import type { LanguageModelV1CallOptions, LanguageModelV1FinishReason, LanguageModelV1Prompt } from './types.js';
export declare function convertPromptToSinapsMessages(prompt: LanguageModelV1Prompt): ChatMessage[];
export declare function convertToolsAndMode(mode: LanguageModelV1CallOptions['mode']): {
    tools?: ToolDefinition[];
    toolChoice?: UnifiedApiRequest['toolChoice'];
    responseFormat?: ResponseFormat;
};
export declare function mapFinishReason(finishReason: string | null | undefined): LanguageModelV1FinishReason;
//# sourceMappingURL=promptConverter.d.ts.map