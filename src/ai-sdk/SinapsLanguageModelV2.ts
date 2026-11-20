/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK LanguageModelV2 (AI SDK v5) & LanguageModelV3 (AI SDK v6) Implementations
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { SinapsClient } from '../core/SinapsClient.js';
import type {
  ChatMessage,
  ContentPart,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  ResponseFormat,
  ToolCall,
  ToolDefinition,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { mapFinishReason } from './promptConverter.js';
import type {
  LanguageModelV1FinishReason,
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2Prompt,
  LanguageModelV2Result,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3Result,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SinapsModelSettings,
} from './types.js';

function encodeBinaryDataUrl(
  data: Uint8Array | URL | string,
  mediaType?: string,
): string {
  if (typeof data === 'string') {
    if (
      data.startsWith('http://') ||
      data.startsWith('https://') ||
      data.startsWith('data:')
    ) {
      return data;
    }
    return `data:${mediaType || 'application/octet-stream'};base64,${data}`;
  }
  if (data instanceof URL) {
    return data.toString();
  }
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(data).toString('base64')
      : btoa(String.fromCharCode(...data));
  return `data:${mediaType || 'application/octet-stream'};base64,${base64}`;
}

export function convertV2PromptToSinapsMessages(
  prompt: LanguageModelV2Prompt,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      messages.push({
        role: 'system',
        content: message.content,
      });
    } else if (message.role === 'user') {
      const parts: ContentPart[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'file') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: encodeBinaryDataUrl(part.data, part.mediaType),
            },
          });
        }
      }
      if (parts.length === 1 && parts[0].type === 'text') {
        messages.push({ role: 'user', content: parts[0].text });
      } else {
        messages.push({ role: 'user', content: parts });
      }
    } else if (message.role === 'assistant') {
      let textContent = '';
      let reasoningContent = '';
      const toolCalls: ToolCall[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textContent += part.text;
        } else if (part.type === 'reasoning') {
          reasoningContent += part.text;
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments:
                typeof part.input === 'string'
                  ? part.input
                  : JSON.stringify(part.input ?? {}),
            },
          });
        }
      }

      messages.push({
        role: 'assistant',
        content: textContent.length > 0 ? textContent : null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (message.role === 'tool') {
      for (const part of message.content) {
        let serialized: string;
        if (
          part.output &&
          typeof part.output === 'object' &&
          'value' in part.output
        ) {
          const val = (part.output as { value: unknown }).value;
          serialized = typeof val === 'string' ? val : JSON.stringify(val);
        } else {
          serialized = JSON.stringify(part.output ?? '');
        }
        messages.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          name: part.toolName,
          content: serialized,
        });
      }
    }
  }

  return messages;
}

export function convertV2CallOptions(options: LanguageModelV2CallOptions): {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: UnifiedApiRequest['toolChoice'];
  responseFormat?: ResponseFormat;
} {
  const messages = convertV2PromptToSinapsMessages(options.prompt);

  let tools: ToolDefinition[] | undefined;
  if (options.tools && options.tools.length > 0) {
    tools = options.tools
      .filter((t) => t.type === 'function')
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown> | undefined,
        },
      }));
  }

  let toolChoice: UnifiedApiRequest['toolChoice'];
  if (options.toolChoice) {
    if (options.toolChoice.type === 'auto') {
      toolChoice = 'auto';
    } else if (options.toolChoice.type === 'none') {
      toolChoice = 'none';
    } else if (options.toolChoice.type === 'required') {
      toolChoice = 'required';
    } else if (options.toolChoice.type === 'tool') {
      toolChoice = {
        type: 'function',
        function: { name: options.toolChoice.toolName },
      };
    }
  }

  let responseFormat: ResponseFormat | undefined;
  if (options.responseFormat?.type === 'json') {
    responseFormat = options.responseFormat.schema
      ? {
          type: 'json_schema',
          json_schema: {
            name: options.responseFormat.name || 'response',
            description: options.responseFormat.description,
            schema: options.responseFormat.schema as Record<string, unknown>,
          },
        }
      : { type: 'json_object' };
  }

  return { messages, tools, toolChoice, responseFormat };
}

function buildBaseRequest(
  modelId: string,
  options: LanguageModelV2CallOptions,
  settings?: SinapsModelSettings,
): Omit<CreateChatCompletionRequestNonStreaming, 'stream'> {
  const { messages, tools, toolChoice, responseFormat } =
    convertV2CallOptions(options);

  const sinapsOpts = (options.providerOptions?.sinapsai ?? {}) as Record<
    string,
    unknown
  >;

  return {
    model: modelId,
    messages,
    temperature: options.temperature,
    maxTokens: options.maxOutputTokens,
    tools,
    toolChoice,
    responseFormat,
    fallbackModels: settings?.fallbackModels,
    thinkingBudget:
      (sinapsOpts.thinkingBudget as number | 'auto' | undefined) ??
      settings?.thinkingBudget,
    thinkingLevel:
      (sinapsOpts.thinkingLevel as SinapsModelSettings['thinkingLevel']) ??
      settings?.thinkingLevel,
    includeThoughts:
      (sinapsOpts.includeThoughts as boolean | undefined) ??
      settings?.includeThoughts,
    reasoningEffort:
      (sinapsOpts.reasoningEffort as SinapsModelSettings['reasoningEffort']) ??
      settings?.reasoningEffort,
    cachedContent: settings?.cachedContent,
    googleSearch: settings?.googleSearch,
    webSearch:
      (sinapsOpts.webSearch as boolean | undefined) ?? settings?.webSearch,
    codeExecution: settings?.codeExecution,
    verbosity: settings?.verbosity,
    serviceTier: settings?.serviceTier,
    promptCacheTtl: settings?.promptCacheTtl,
    user: settings?.user,
    signal: options.abortSignal,
  };
}

function mapResponseToContent(response: UnifiedApiResponse): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV1FinishReason;
  usage: LanguageModelV2Usage;
} {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const content: LanguageModelV2Content[] = [];

  if (message?.reasoning_content) {
    content.push({
      type: 'reasoning',
      text: message.reasoning_content,
    });
  }
  if (message?.content) {
    content.push({
      type: 'text',
      text: message.content,
    });
  }
  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      content.push({
        type: 'tool-call',
        toolCallId: tc.id,
        toolName: tc.function.name,
        input: tc.function.arguments || '{}',
      });
    }
  }

  return {
    content,
    finishReason: mapFinishReason(choice?.finishReason),
    usage: {
      inputTokens: response.usage?.promptTokens,
      outputTokens: response.usage?.completionTokens,
      totalTokens: response.usage?.totalTokens,
      reasoningTokens: response.usage?.reasoningTokens,
      cachedInputTokens: response.usage?.cachedPromptTokens,
    },
  };
}

function toV3FinishReason(
  finishReason: LanguageModelV1FinishReason,
): LanguageModelV3FinishReason {
  return {
    unified: finishReason === 'unknown' ? 'other' : finishReason,
    raw: finishReason,
  };
}

function toV3Usage(usage: LanguageModelV2Usage): LanguageModelV3Usage {
  const cached = usage.cachedInputTokens ?? 0;
  const totalIn = usage.inputTokens;
  const reasoning = usage.reasoningTokens ?? 0;
  const totalOut = usage.outputTokens;
  return {
    inputTokens: {
      total: totalIn,
      noCache:
        totalIn !== undefined ? Math.max(0, totalIn - cached) : undefined,
      cacheRead: usage.cachedInputTokens,
    },
    outputTokens: {
      total: totalOut,
      text:
        totalOut !== undefined ? Math.max(0, totalOut - reasoning) : undefined,
      reasoning: usage.reasoningTokens,
    },
  };
}

function createV2OrV3Stream<TVersion extends 'v2' | 'v3'>(
  client: SinapsClient,
  modelId: string,
  options: LanguageModelV2CallOptions,
  settings: SinapsModelSettings | undefined,
  version: TVersion,
): Promise<{
  stream: ReadableStream<
    TVersion extends 'v2'
      ? LanguageModelV2StreamPart
      : LanguageModelV3StreamPart
  >;
  request?: { body?: unknown };
  warnings?: LanguageModelV2CallWarning[];
}> {
  const baseReq = buildBaseRequest(modelId, options, settings);
  const requestPayload: CreateChatCompletionRequestStreaming = {
    ...baseReq,
    stream: true,
  };
  const warnings: LanguageModelV2CallWarning[] = [];

  const stream = new ReadableStream<
    TVersion extends 'v2'
      ? LanguageModelV2StreamPart
      : LanguageModelV3StreamPart
  >({
    async start(controller) {
      const enqueue = (
        part: LanguageModelV2StreamPart | LanguageModelV3StreamPart,
      ) => {
        controller.enqueue(
          part as TVersion extends 'v2'
            ? LanguageModelV2StreamPart
            : LanguageModelV3StreamPart,
        );
      };

      try {
        const responseStream = (await client.chat.completions.create(
          requestPayload,
        )) as AsyncIterable<UnifiedApiStreamChunk>;

        enqueue({ type: 'stream-start', warnings });

        let metadataSent = false;
        let reasoningStarted = false;
        let textStarted = false;
        let usage: LanguageModelV2Usage = {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        };
        let finishReason: LanguageModelV1FinishReason = 'stop';

        const activeTools = new Map<
          number,
          { id: string; name: string; args: string; started: boolean }
        >();

        for await (const chunk of responseStream) {
          if (!metadataSent && (chunk.id || chunk.model)) {
            metadataSent = true;
            enqueue({
              type: 'response-metadata',
              id: chunk.id,
              modelId: chunk.model,
            });
          }

          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.promptTokens,
              outputTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
              reasoningTokens: chunk.usage.reasoningTokens,
              cachedInputTokens: chunk.usage.cachedPromptTokens,
            };
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          if (choice.delta?.reasoning_content) {
            if (!reasoningStarted) {
              reasoningStarted = true;
              enqueue({ type: 'reasoning-start', id: 'reasoning-0' });
            }
            enqueue({
              type: 'reasoning-delta',
              id: 'reasoning-0',
              delta: choice.delta.reasoning_content,
            });
          }

          if (choice.delta?.content) {
            if (reasoningStarted) {
              enqueue({ type: 'reasoning-end', id: 'reasoning-0' });
              reasoningStarted = false;
            }
            if (!textStarted) {
              textStarted = true;
              enqueue({ type: 'text-start', id: 'text-0' });
            }
            enqueue({
              type: 'text-delta',
              id: 'text-0',
              delta: choice.delta.content,
            });
          }

          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index ?? 0;
              let active = activeTools.get(idx);
              if (!active) {
                active = {
                  id: tc.id || `call_${Date.now()}_${idx}`,
                  name: tc.function?.name || '',
                  args: '',
                  started: false,
                };
                activeTools.set(idx, active);
              } else {
                if (tc.id) active.id = tc.id;
                if (tc.function?.name) active.name = tc.function.name;
              }

              if (!active.started && active.name) {
                active.started = true;
                enqueue({
                  type: 'tool-input-start',
                  id: active.id,
                  toolName: active.name,
                });
              }

              if (tc.function?.arguments) {
                active.args += tc.function.arguments;
                enqueue({
                  type: 'tool-input-delta',
                  id: active.id,
                  delta: tc.function.arguments,
                });
              }
            }
          }

          if (choice.finishReason) {
            finishReason = mapFinishReason(choice.finishReason);
          }
        }

        if (reasoningStarted) {
          enqueue({ type: 'reasoning-end', id: 'reasoning-0' });
        }
        if (textStarted) {
          enqueue({ type: 'text-end', id: 'text-0' });
        }
        for (const active of activeTools.values()) {
          if (active.started) {
            enqueue({ type: 'tool-input-end', id: active.id });
          }
          if (active.name) {
            enqueue({
              type: 'tool-call',
              toolCallId: active.id,
              toolName: active.name,
              input: active.args || '{}',
            });
          }
        }

        if (version === 'v3') {
          enqueue({
            type: 'finish',
            finishReason: toV3FinishReason(finishReason),
            usage: toV3Usage(usage),
          });
        } else {
          enqueue({
            type: 'finish',
            finishReason,
            usage,
          });
        }
        controller.close();
      } catch (error) {
        enqueue({ type: 'error', error });
        controller.close();
      }
    },
  });

  return Promise.resolve({
    stream,
    request: { body: requestPayload },
    warnings,
  });
}

/**
 * Vercel AI SDK v5 (`specificationVersion: 'v2'`) language model adapter backed by SinapsAI.
 */
export class SinapsLanguageModelV2 implements LanguageModelV2 {
  public readonly specificationVersion = 'v2' as const;
  public readonly provider = 'sinapsai';
  public readonly modelId: string;
  public readonly supportedUrls: Record<string, RegExp[]> = {
    'image/*': [/^https?:\/\/.+$/i],
    'application/pdf': [/^https?:\/\/.+$/i],
  };

  private readonly client: SinapsClient;
  private readonly settings?: SinapsModelSettings;

  constructor(
    client: SinapsClient,
    modelId: string,
    settings?: SinapsModelSettings,
  ) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }

  public async doGenerate(
    options: LanguageModelV2CallOptions,
  ): Promise<LanguageModelV2Result> {
    const req: CreateChatCompletionRequestNonStreaming = {
      ...buildBaseRequest(this.modelId, options, this.settings),
      stream: false,
    };
    const response = (await this.client.chat.completions.create(
      req,
    )) as UnifiedApiResponse;
    const mapped = mapResponseToContent(response);

    return {
      content: mapped.content,
      finishReason: mapped.finishReason,
      usage: mapped.usage,
      warnings: [],
      request: { body: req },
      response: {
        id: response.id,
        modelId: response.model,
      },
    };
  }

  public async doStream(options: LanguageModelV2CallOptions) {
    return createV2OrV3Stream(
      this.client,
      this.modelId,
      options,
      this.settings,
      'v2',
    );
  }
}

/**
 * Vercel AI SDK v6 (`specificationVersion: 'v3'`) language model adapter backed by SinapsAI.
 */
export class SinapsLanguageModelV3 implements LanguageModelV3 {
  public readonly specificationVersion = 'v3' as const;
  public readonly provider = 'sinapsai';
  public readonly modelId: string;
  public readonly supportedUrls: Record<string, RegExp[]> = {
    'image/*': [/^https?:\/\/.+$/i],
    'application/pdf': [/^https?:\/\/.+$/i],
  };

  private readonly client: SinapsClient;
  private readonly settings?: SinapsModelSettings;

  constructor(
    client: SinapsClient,
    modelId: string,
    settings?: SinapsModelSettings,
  ) {
    this.client = client;
    this.modelId = modelId;
    this.settings = settings;
  }

  public async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3Result> {
    const req: CreateChatCompletionRequestNonStreaming = {
      ...buildBaseRequest(this.modelId, options, this.settings),
      stream: false,
    };
    const response = (await this.client.chat.completions.create(
      req,
    )) as UnifiedApiResponse;
    const mapped = mapResponseToContent(response);

    return {
      content: mapped.content,
      finishReason: toV3FinishReason(mapped.finishReason),
      usage: toV3Usage(mapped.usage),
      warnings: [],
      request: { body: req },
      response: {
        id: response.id,
        modelId: response.model,
      },
    };
  }

  public async doStream(options: LanguageModelV3CallOptions) {
    return createV2OrV3Stream(
      this.client,
      this.modelId,
      options,
      this.settings,
      'v3',
    );
  }
}
