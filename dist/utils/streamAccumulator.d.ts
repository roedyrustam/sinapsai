/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
export interface StreamAccumulatorOptions {
    /**
     * Optional callback triggered on each chunk as it arrives from the stream.
     */
    onChunk?: (chunk: UnifiedApiStreamChunk) => void;
}
/**
 * Accumulates an AsyncIterable of UnifiedApiStreamChunks into a single,
 * fully reconstructed UnifiedApiResponse.
 *
 * Reconstructs:
 * - Content text chunks concatenated in order
 * - Reasoning/thinking content concatenated in order
 * - Multi-tool call deltas merged by index (id, function name, and partial JSON arguments)
 * - Correct finishReason (e.g. 'tool_calls' if tool calls are present)
 * - Final usage metrics (promptTokens, completionTokens, totalTokens, cachedPromptTokens)
 *
 * @example
 * ```typescript
 * const stream = await client.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
 *   tools: [weatherTool],
 *   stream: true,
 * });
 *
 * const response = await accumulateStream(stream);
 * console.log(response.choices[0].message.tool_calls);
 * ```
 */
export declare function accumulateStream(stream: AsyncIterable<UnifiedApiStreamChunk>, options?: StreamAccumulatorOptions): Promise<UnifiedApiResponse>;
//# sourceMappingURL=streamAccumulator.d.ts.map