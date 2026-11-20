/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * OpenAI Frontier Provider (Chat Completions + Responses API + Embeddings)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { FrontierModelRegistry } from '../core/FrontierModelRegistry.js';
import type {
  ApiUsage,
  ContentPart,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const OPENAI_MODELS = {
  GPT_5_6_SOL: 'gpt-5.6-sol-medium',
  GPT_5_5: 'gpt-5.5',
  GPT_5_4: 'gpt-5.4',
  GPT_5: 'gpt-5',
  GPT_5_MINI: 'gpt-5-mini',
  GPT_5_NANO: 'gpt-5-nano',
  O4_MINI: 'o4-mini',
  O3: 'o3',
  O3_MINI: 'o3-mini',
  GPT_4O: 'gpt-4o',
  GPT_4O_MINI: 'gpt-4o-mini',
  GPT_REALTIME: 'gpt-realtime',
  TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large',
  TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small',
} as const;

export const OPENAI_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'gpt-5.6-sol-medium': { promptCostPer1k: 0.002, completionCostPer1k: 0.008 },
  'gpt-5.5': { promptCostPer1k: 0.0025, completionCostPer1k: 0.015 },
  'gpt-5.4': { promptCostPer1k: 0.0025, completionCostPer1k: 0.015 },
  'gpt-5': { promptCostPer1k: 0.00125, completionCostPer1k: 0.01 },
  'gpt-5-mini': { promptCostPer1k: 0.00025, completionCostPer1k: 0.002 },
  'gpt-5-nano': { promptCostPer1k: 0.00005, completionCostPer1k: 0.0004 },
  'o4-mini': { promptCostPer1k: 0.0011, completionCostPer1k: 0.0044 },
  o3: { promptCostPer1k: 0.002, completionCostPer1k: 0.008 },
  'o3-mini': { promptCostPer1k: 0.0011, completionCostPer1k: 0.0044 },
  'gpt-4o': { promptCostPer1k: 0.0025, completionCostPer1k: 0.01 },
  'gpt-4o-mini': { promptCostPer1k: 0.00015, completionCostPer1k: 0.0006 },
  'text-embedding-3-large': {
    promptCostPer1k: 0.00013,
    completionCostPer1k: 0,
  },
  'text-embedding-3-small': {
    promptCostPer1k: 0.00002,
    completionCostPer1k: 0,
  },
};

export interface OpenAiProviderConfig extends ProviderConfig {
  /**
   * OpenAI endpoint mode:
   * - 'chat': Standard `/v1/chat/completions` (default)
   * - 'responses': Modern `/v1/responses` API (stateful chaining, web_search_preview, reasoning summaries)
   */
  apiMode?: 'chat' | 'responses';
  /**
   * Automatically map `role: 'system'` to `role: 'developer'` on reasoning models (o1/o3/o4/gpt-5+).
   * Default: false (preserves explicit `role: 'developer'` when sent).
   */
  useDeveloperRole?: boolean;
  /**
   * Default processing service tier ('auto' | 'default' | 'flex' | 'priority').
   */
  serviceTier?: 'auto' | 'default' | 'flex' | 'priority';
}

export class OpenAiProvider implements Provider {
  id: string;
  name = 'OpenAI';
  private config: OpenAiProviderConfig;

  constructor(config: OpenAiProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `openai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  get promptCostPer1k(): number | undefined {
    if (this.config.promptCostPer1k !== undefined) {
      return this.config.promptCostPer1k;
    }
    if (this.config.defaultModel) {
      return OPENAI_DEFAULT_PRICING[this.config.defaultModel]?.promptCostPer1k;
    }
    return undefined;
  }

  get completionCostPer1k(): number | undefined {
    if (this.config.completionCostPer1k !== undefined) {
      return this.config.completionCostPer1k;
    }
    if (this.config.defaultModel) {
      return OPENAI_DEFAULT_PRICING[this.config.defaultModel]
        ?.completionCostPer1k;
    }
    return undefined;
  }

  get retries(): number | undefined {
    return this.config.retries;
  }

  get retryDelayMs(): number | undefined {
    return this.config.retryDelayMs;
  }

  get fallbackModels(): string[] | undefined {
    return this.config.fallbackModels;
  }

  get defaultModel(): string | undefined {
    return this.config.defaultModel;
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }

  private normalizeReasoningEffort(
    effort?: UnifiedApiRequest['reasoningEffort'],
  ): string | undefined {
    if (!effort) return undefined;
    if (effort === 'max') return 'xhigh';
    return effort;
  }

  private isReasoningOrGpt5Model(resolvedModel: string): boolean {
    return FrontierModelRegistry.usesMaxCompletionTokens(resolvedModel);
  }

  public formatRequest(request: UnifiedApiRequest) {
    if (this.config.apiMode === 'responses') {
      return this.formatResponsesRequest(request);
    }

    const resolvedModel = this.resolveModel(request.model);
    const isReasoningModel = this.isReasoningOrGpt5Model(resolvedModel);
    const isLegacyOSeries =
      resolvedModel.startsWith('o1') ||
      resolvedModel.startsWith('o3') ||
      resolvedModel.startsWith('o4');

    const messages = request.messages.map((m) => {
      const role =
        this.config.useDeveloperRole && isReasoningModel && m.role === 'system'
          ? 'developer'
          : m.role;
      // biome-ignore lint/suspicious/noExplicitAny: OpenAI message format
      const msg: any = {
        role,
        content: m.content,
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: resolvedModel,
      messages,
    };

    const effort = this.normalizeReasoningEffort(request.reasoningEffort);
    if (effort) {
      payload.reasoning_effort = effort;
    }

    const allowTempOnGpt5 =
      resolvedModel.startsWith('gpt-5') && effort === 'none';
    if (
      request.temperature !== undefined &&
      (!isReasoningModel || (!isLegacyOSeries && allowTempOnGpt5))
    ) {
      payload.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      if (isReasoningModel) {
        payload.max_completion_tokens = request.maxTokens;
      } else {
        payload.max_tokens = request.maxTokens;
      }
    }

    if (request.verbosity) {
      payload.verbosity = request.verbosity;
    }

    const serviceTier = request.serviceTier ?? this.config.serviceTier;
    if (serviceTier) {
      payload.service_tier = serviceTier;
    }

    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }
    return payload;
  }

  /**
   * Formats a UnifiedApiRequest into OpenAI Responses API (`/v1/responses`) payload.
   */
  public formatResponsesRequest(request: UnifiedApiRequest) {
    const resolvedModel = this.resolveModel(request.model);
    const instructionParts: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: OpenAI Responses API input items
    const input: any[] = [];

    const toResponsesContent = (
      content: string | ContentPart[] | null,
      isAssistant: boolean,
    ) => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content.map((part) => {
        if (part.type === 'text') {
          return {
            type: isAssistant ? 'output_text' : 'input_text',
            text: part.text,
          };
        }
        if (part.type === 'image_url') {
          const img = part.image_url ?? part.imageUrl;
          return {
            type: 'input_image',
            image_url: img?.url,
            ...(img?.detail ? { detail: img.detail } : {}),
          };
        }
        return part;
      });
    };

    for (const msg of request.messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        if (typeof msg.content === 'string') {
          instructionParts.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          const text = msg.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n');
          if (text) instructionParts.push(text);
        }
      } else if (msg.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id || '',
          output:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content ?? ''),
        });
      } else if (
        msg.role === 'assistant' &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      ) {
        if (msg.content) {
          input.push({
            role: 'assistant',
            content: toResponsesContent(msg.content, true),
          });
        }
        for (const tc of msg.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      } else {
        input.push({
          role: msg.role,
          content: toResponsesContent(msg.content, msg.role === 'assistant'),
        });
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: OpenAI Responses API payload
    const payload: any = {
      model: resolvedModel,
      input,
    };

    if (instructionParts.length > 0) {
      payload.instructions = instructionParts.join('\n');
    }

    const effort =
      this.normalizeReasoningEffort(request.reasoningEffort) ??
      (typeof request.thinkingBudget === 'number' && request.thinkingBudget > 0
        ? request.thinkingBudget >= 16384
          ? 'high'
          : request.thinkingBudget >= 4096
            ? 'medium'
            : 'low'
        : undefined);

    if (effort) {
      payload.reasoning = { effort };
    }

    if (request.maxTokens !== undefined) {
      payload.max_output_tokens = request.maxTokens;
    }

    const isReasoningModel = this.isReasoningOrGpt5Model(resolvedModel);
    if (
      request.temperature !== undefined &&
      (!isReasoningModel || effort === 'none')
    ) {
      payload.temperature = request.temperature;
    }

    if (request.responseFormat || request.verbosity) {
      // biome-ignore lint/suspicious/noExplicitAny: Responses API text block
      const textConfig: any = {};
      if (request.responseFormat?.type === 'json_object') {
        textConfig.format = { type: 'json_object' };
      } else if (
        request.responseFormat?.type === 'json_schema' &&
        request.responseFormat.json_schema
      ) {
        textConfig.format = {
          type: 'json_schema',
          name: request.responseFormat.json_schema.name,
          schema: request.responseFormat.json_schema.schema,
          strict: request.responseFormat.json_schema.strict ?? true,
        };
      }
      if (request.verbosity) {
        textConfig.verbosity = request.verbosity;
      }
      payload.text = textConfig;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Responses API tools array
    const tools: any[] = [];
    if (request.tools && request.tools.length > 0) {
      for (const t of request.tools) {
        tools.push({
          type: 'function',
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        });
      }
    }
    if (request.webSearch) {
      tools.push({ type: 'web_search_preview' });
    }
    if (tools.length > 0) {
      payload.tools = tools;
    }

    if (request.toolChoice) {
      if (typeof request.toolChoice === 'object') {
        payload.tool_choice = {
          type: 'function',
          name: request.toolChoice.function.name,
        };
      } else {
        payload.tool_choice = request.toolChoice;
      }
    }

    if (request.previousResponseId) {
      payload.previous_response_id = request.previousResponseId;
    }

    const serviceTier = request.serviceTier ?? this.config.serviceTier;
    if (serviceTier) {
      payload.service_tier = serviceTier;
    }

    if (request.stream) {
      payload.stream = true;
    }

    return payload;
  }

  private buildUsage(
    // biome-ignore lint/suspicious/noExplicitAny: usage object varies
    rawUsage: any,
  ): ApiUsage | undefined {
    if (!rawUsage) return undefined;
    const promptTokens = rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0;
    const completionTokens =
      rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0;
    const totalTokens =
      rawUsage.total_tokens ?? promptTokens + completionTokens;
    const cachedPromptTokens =
      rawUsage.prompt_tokens_details?.cached_tokens ??
      rawUsage.input_tokens_details?.cached_tokens;
    const reasoningTokens =
      rawUsage.completion_tokens_details?.reasoning_tokens ??
      rawUsage.output_tokens_details?.reasoning_tokens;

    const usage: ApiUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
    };
    if (cachedPromptTokens !== undefined) {
      usage.cachedPromptTokens = cachedPromptTokens;
    }
    if (reasoningTokens !== undefined) {
      usage.reasoningTokens = reasoningTokens;
    }
    return usage;
  }

  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any): UnifiedApiResponse {
    if (
      data.object === 'response' ||
      (Array.isArray(data.output) && !data.choices)
    ) {
      return this.formatResponsesResponse(data);
    }

    const choice = data.choices?.[0];
    const reasoningContent =
      choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;

    return {
      id: data.id || `openai-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls,
          },
          finishReason: choice?.finish_reason || 'stop',
        },
      ],
      usage: this.buildUsage(data.usage),
    };
  }

  /**
   * Parses an OpenAI Responses API (`/v1/responses`) JSON payload into UnifiedApiResponse.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Responses API shape
  public formatResponsesResponse(data: any): UnifiedApiResponse {
    let textContent =
      typeof data.output_text === 'string' ? data.output_text : '';
    let reasoningContent = '';
    // biome-ignore lint/suspicious/noExplicitAny: tool call items
    const toolCalls: any[] = [];

    if (Array.isArray(data.output)) {
      let collectedFromOutput = '';
      for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === 'output_text' && typeof part.text === 'string') {
              collectedFromOutput += part.text;
            }
          }
        } else if (item.type === 'reasoning') {
          if (Array.isArray(item.summary)) {
            for (const s of item.summary) {
              if (typeof s.text === 'string') {
                reasoningContent += (reasoningContent ? '\n' : '') + s.text;
              }
            }
          } else if (typeof item.text === 'string') {
            reasoningContent += item.text;
          }
        } else if (item.type === 'function_call') {
          toolCalls.push({
            id: item.call_id || item.id || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: item.name,
              arguments:
                typeof item.arguments === 'string'
                  ? item.arguments
                  : JSON.stringify(item.arguments || {}),
            },
          });
        }
      }
      if (!textContent && collectedFromOutput) {
        textContent = collectedFromOutput;
      }
    }

    let finishReason = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (data.incomplete_details?.reason === 'max_output_tokens') {
      finishReason = 'length';
    } else if (data.status === 'incomplete') {
      finishReason = 'length';
    }

    return {
      id: data.id || `resp-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: textContent || null,
            reasoning_content: reasoningContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason,
        },
      ],
      usage: this.buildUsage(data.usage),
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const isResponsesMode = this.config.apiMode === 'responses';
    const payload = isResponsesMode
      ? this.formatResponsesRequest(request)
      : this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const url = isResponsesMode
      ? `${baseUrl}/responses`
      : `${baseUrl}/chat/completions`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenAI API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        const buildUsage = this.buildUsage.bind(this);
        if (isResponsesMode) {
          return (async function* () {
            let responseId = `resp-${Date.now()}`;
            let responseModel = payload.model;
            let toolIndex = 0;
            const itemIdToIndex = new Map<string, number>();
            try {
              for await (const msg of parseSSE(response)) {
                try {
                  const parsed = JSON.parse(msg.data);
                  const eventType = msg.event || parsed.type;
                  if (parsed.response?.id) responseId = parsed.response.id;
                  if (parsed.response?.model)
                    responseModel = parsed.response.model;

                  if (eventType === 'response.output_text.delta') {
                    yield {
                      id: responseId,
                      model: responseModel,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: parsed.delta || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (
                    eventType === 'response.reasoning_summary_text.delta' ||
                    eventType === 'response.reasoning_text.delta'
                  ) {
                    yield {
                      id: responseId,
                      model: responseModel,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            reasoning_content: parsed.delta || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (
                    eventType === 'response.output_item.added' &&
                    parsed.item?.type === 'function_call'
                  ) {
                    const idx = toolIndex++;
                    if (parsed.item.id) {
                      itemIdToIndex.set(parsed.item.id, idx);
                    }
                    yield {
                      id: responseId,
                      model: responseModel,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: idx,
                                id:
                                  parsed.item.call_id ||
                                  parsed.item.id ||
                                  `call_${idx}`,
                                type: 'function',
                                function: {
                                  name: parsed.item.name || '',
                                  arguments: parsed.item.arguments || '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (
                    eventType === 'response.function_call_arguments.delta'
                  ) {
                    const idx = itemIdToIndex.get(parsed.item_id) ?? 0;
                    yield {
                      id: responseId,
                      model: responseModel,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: idx,
                                function: {
                                  arguments: parsed.delta || '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (
                    eventType === 'response.completed' ||
                    eventType === 'response.done'
                  ) {
                    const usage = buildUsage(parsed.response?.usage);
                    const finishReason =
                      toolIndex > 0
                        ? 'tool_calls'
                        : parsed.response?.status === 'incomplete'
                          ? 'length'
                          : 'stop';
                    yield {
                      id: responseId,
                      model: responseModel,
                      choices: [{ delta: {}, finishReason }],
                      usage,
                    };
                  }
                } catch (_e) {
                  // ignore individual chunk parse errors
                }
              }
            } finally {
              cleanupSignal?.();
              if (timeoutId) clearTimeout(timeoutId);
              controller.abort();
            }
          })();
        }

        return (async function* () {
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                const chunkUsage = buildUsage(parsed.usage);
                yield {
                  id: parsed.id || `openai-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content:
                          chunk?.delta?.reasoning ??
                          chunk?.delta?.reasoning_content ??
                          null,
                        tool_calls: chunk?.delta?.tool_calls,
                      },
                      finishReason: chunk?.finish_reason || null,
                    },
                  ],
                  usage: chunkUsage,
                };
              } catch (_e) {
                // ignore parse error for individual chunks
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }

      const data = await response.json();
      const res = isResponsesMode
        ? this.formatResponsesResponse(data)
        : this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }

  async generateEmbedding(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    const targetModel = this.resolveModel(request.model);
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const url = `${baseUrl}/embeddings`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          input: request.input,
          ...(request.dimensions !== undefined
            ? { dimensions: request.dimensions }
            : {}),
          ...(request.user ? { user: request.user } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenAI API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // biome-ignore lint/suspicious/noExplicitAny: OpenAI embeddings response
      const data: any = await response.json();
      return {
        object: 'list',
        model: data.model || targetModel,
        // biome-ignore lint/suspicious/noExplicitAny: item mapping
        data: (data.data || []).map((item: any, idx: number) => ({
          object: 'embedding',
          index: item.index ?? idx,
          embedding: item.embedding,
        })),
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens || 0,
              totalTokens: data.usage.total_tokens || 0,
            }
          : undefined,
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
