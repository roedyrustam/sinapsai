/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ApiUsage,
  ToolCall,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';

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
export async function accumulateStream(
  stream: AsyncIterable<UnifiedApiStreamChunk>,
  options?: StreamAccumulatorOptions,
): Promise<UnifiedApiResponse> {
  let id = '';
  let model = '';
  let content = '';
  let hasContent = false;
  let reasoningContent = '';
  let hasReasoning = false;
  let finishReason = 'stop';
  let usage: ApiUsage | undefined;

  interface InternalToolCall {
    id: string;
    name: string;
    arguments: string;
  }
  const toolCallsMap = new Map<number, InternalToolCall>();

  for await (const chunk of stream) {
    options?.onChunk?.(chunk);

    if (!id && chunk.id) id = chunk.id;
    if (!model && chunk.model) model = chunk.model;
    if (chunk.usage) {
      usage = { ...chunk.usage };
    }

    const choice = chunk.choices?.[0];
    if (choice) {
      if (choice.finishReason) {
        finishReason = choice.finishReason;
      }

      const delta = choice.delta;
      if (delta) {
        if (delta.content !== undefined && delta.content !== null) {
          content += delta.content;
          hasContent = true;
        }

        if (
          delta.reasoning_content !== undefined &&
          delta.reasoning_content !== null
        ) {
          reasoningContent += delta.reasoning_content;
          hasReasoning = true;
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: tc.id || '',
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              });
            } else {
              const existing = toolCallsMap.get(index)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    }
  }

  let finalToolCalls: ToolCall[] | undefined;
  if (toolCallsMap.size > 0) {
    finalToolCalls = Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, tc], idx) => ({
        id: tc.id || `call_${Date.now()}_${idx}`,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));
  }

  return {
    id: id || `accumulated-${Date.now()}`,
    model: model || 'unknown',
    choices: [
      {
        message: {
          role: 'assistant',
          content: hasContent ? content : null,
          reasoning_content: hasReasoning ? reasoningContent : null,
          tool_calls: finalToolCalls,
        },
        finishReason:
          finalToolCalls &&
          finalToolCalls.length > 0 &&
          finishReason === 'stop'
            ? 'tool_calls'
            : finishReason,
      },
    ],
    usage,
  };
}
