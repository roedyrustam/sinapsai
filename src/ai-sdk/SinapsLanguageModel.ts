/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK LanguageModelV1 Implementation
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { SinapsClient } from '../core/SinapsClient.js';
import type {
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import {
  convertPromptToSinapsMessages,
  convertToolsAndMode,
  mapFinishReason,
} from './promptConverter.js';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1FunctionToolCall,
  LanguageModelV1Result,
  LanguageModelV1StreamPart,
  SinapsModelSettings,
} from './types.js';

export class SinapsLanguageModel implements LanguageModelV1 {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'sinapsai';
  public readonly modelId: string;
  public readonly defaultObjectGenerationMode = 'json' as const;
  public readonly supportsImageUrls = true;

  private client: SinapsClient;
  private settings?: SinapsModelSettings;

  constructor(
    client: SinapsClient,
    modelId: string,
    settings?: SinapsModelSettings,
  ) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }

  async doGenerate(
    options: LanguageModelV1CallOptions,
  ): Promise<LanguageModelV1Result> {
    const messages = convertPromptToSinapsMessages(options.prompt);
    const { tools, toolChoice, responseFormat } = convertToolsAndMode(
      options.mode,
    );

    const requestPayload: CreateChatCompletionRequestNonStreaming = {
      model: this.modelId,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools,
      toolChoice,
      responseFormat,
      fallbackModels: this.settings?.fallbackModels,
      thinkingBudget: this.settings?.thinkingBudget,
      reasoningEffort: this.settings?.reasoningEffort,
      signal: options.abortSignal,
    };

    const response = (await this.client.chat.completions.create(
      requestPayload,
    )) as UnifiedApiResponse;

    const choice = response.choices?.[0];
    const message = choice?.message;

    let toolCalls: LanguageModelV1FunctionToolCall[] | undefined;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        toolCallType: 'function',
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: tc.function.arguments,
      }));
    }

    return {
      text: message?.content ?? undefined,
      toolCalls,
      finishReason: mapFinishReason(choice?.finishReason),
      usage: {
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          mode: options.mode,
        },
      },
    };
  }

  async doStream(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: {
      rawPrompt: unknown;
      rawSettings: Record<string, unknown>;
    };
  }> {
    const messages = convertPromptToSinapsMessages(options.prompt);
    const { tools, toolChoice, responseFormat } = convertToolsAndMode(
      options.mode,
    );

    const requestPayload: CreateChatCompletionRequestStreaming = {
      model: this.modelId,
      messages,
      stream: true,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools,
      toolChoice,
      responseFormat,
      fallbackModels: this.settings?.fallbackModels,
      thinkingBudget: this.settings?.thinkingBudget,
      reasoningEffort: this.settings?.reasoningEffort,
      signal: options.abortSignal,
    };

    const client = this.client;
    const rawSettings = {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      mode: options.mode,
    };

    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      async start(controller) {
        try {
          const responseStream = (await client.chat.completions.create(
            requestPayload,
          )) as AsyncIterable<UnifiedApiStreamChunk>;

          let promptTokens = 0;
          let completionTokens = 0;
          let finishReason: LanguageModelV1FinishReason = 'stop';

          interface ActiveToolCall {
            id: string;
            name: string;
            args: string;
            emittedStart?: boolean;
          }
          const activeTools = new Map<number, ActiveToolCall>();

          for await (const chunk of responseStream) {
            if (chunk.usage) {
              promptTokens = chunk.usage.promptTokens || promptTokens;
              completionTokens =
                chunk.usage.completionTokens || completionTokens;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            // 1. Emit reasoning delta if present (DeepSeek R1 / Claude 3.7 / Gemini Thinking)
            if (choice.delta?.reasoning_content) {
              controller.enqueue({
                type: 'reasoning',
                textDelta: choice.delta.reasoning_content,
              });
            }

            // 2. Emit text delta if present
            if (choice.delta?.content) {
              controller.enqueue({
                type: 'text-delta',
                textDelta: choice.delta.content,
              });
            }

            // 3. Emit tool call deltas
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                let active = activeTools.get(idx);

                if (!active) {
                  active = {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || '',
                  };
                  activeTools.set(idx, active);
                } else {
                  if (tc.id) active.id = tc.id;
                  if (tc.function?.name) active.name = tc.function.name;
                  if (tc.function?.arguments) {
                    active.args += tc.function.arguments;
                  }
                }

                if (!active.emittedStart && active.name) {
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallType: 'function',
                    toolCallId: active.id,
                    toolName: active.name,
                    args: active.args,
                  });
                  active.emittedStart = true;
                } else if (tc.function?.arguments) {
                  controller.enqueue({
                    type: 'tool-call-delta',
                    toolCallType: 'function',
                    toolCallId: active.id,
                    toolName: active.name,
                    argsTextDelta: tc.function.arguments,
                  });
                }
              }
            }

            if (choice.finishReason) {
              finishReason = mapFinishReason(choice.finishReason);
            }
          }

          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: {
              promptTokens,
              completionTokens,
            },
          });
          controller.close();
        } catch (error) {
          controller.enqueue({
            type: 'error',
            error,
          });
          controller.close();
        }
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings,
      },
    };
  }
}
