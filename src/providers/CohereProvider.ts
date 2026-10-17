/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  TextContentPart,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const COHERE_MODELS = {
  COMMAND_A: 'command-a-03-2025',
  COMMAND_R_PLUS: 'command-r-plus-08-2024',
  COMMAND_R: 'command-r-08-2024',
  COMMAND_R7B: 'command-r7b-12-2024',
  EMBED_V4: 'embed-v4.0',
  EMBED_MULTILINGUAL_V3: 'embed-multilingual-v3.0',
  EMBED_ENGLISH_V3: 'embed-english-v3.0',
} as const;

export class CohereProvider implements Provider {
  id: string;
  name = 'Cohere';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `cohere-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  get promptCostPer1k(): number | undefined {
    return this.config.promptCostPer1k;
  }

  get completionCostPer1k(): number | undefined {
    return this.config.completionCostPer1k;
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

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === 'default') {
      return COHERE_MODELS.COMMAND_A;
    }
    return model;
  }

  public formatRequest(request: UnifiedApiRequest) {
    const messages = request.messages.map((m) => {
      let content: string | unknown = m.content;
      if (Array.isArray(m.content)) {
        content = m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as TextContentPart).text)
          .join('\n');
      }
      // biome-ignore lint/suspicious/noExplicitAny: cohere v2 message format
      const msg: any = {
        role: m.role,
        content: content ?? '',
      };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    // biome-ignore lint/suspicious/noExplicitAny: cohere v2 payload
    const payload: any = {
      model: this.resolveModel(request.model),
      messages,
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.tools && request.toolChoice !== 'none') {
      payload.tools = request.tools;
    }
    if (request.toolChoice === 'required') {
      payload.tool_choice = 'REQUIRED';
    } else if (request.toolChoice === 'none') {
      payload.tool_choice = 'NONE';
    }
    if (request.responseFormat) {
      if (request.responseFormat.type === 'json_object') {
        payload.response_format = { type: 'json_object' };
      } else if (
        request.responseFormat.type === 'json_schema' &&
        request.responseFormat.json_schema
      ) {
        payload.response_format = {
          type: 'json_object',
          json_schema: request.responseFormat.json_schema.schema,
        };
      }
    }
    if (request.stream) {
      payload.stream = true;
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: cohere v2 response
  public formatResponse(data: any, requestedModel: string): UnifiedApiResponse {
    let textContent = '';
    let reasoningContent = '';

    if (Array.isArray(data.message?.content)) {
      for (const block of data.message.content) {
        if (block.type === 'text') {
          textContent += block.text || '';
        } else if (block.type === 'thinking') {
          reasoningContent += block.thinking || '';
        }
      }
    } else if (typeof data.message?.content === 'string') {
      textContent = data.message.content;
    } else if (typeof data.text === 'string') {
      textContent = data.text;
    }

    const toolCalls = data.message?.tool_calls?.map(
      // biome-ignore lint/suspicious/noExplicitAny: tool call item
      (tc: any) => ({
        id: tc.id || `call_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: tc.function?.name || '',
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || {}),
        },
      }),
    );

    let finishReason = 'stop';
    if (toolCalls && toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (data.finish_reason) {
      switch (data.finish_reason) {
        case 'MAX_TOKENS':
          finishReason = 'length';
          break;
        case 'TOOL_CALL':
          finishReason = 'tool_calls';
          break;
        case 'COMPLETE':
        case 'STOP_SEQUENCE':
          finishReason = 'stop';
          break;
        default:
          finishReason = String(data.finish_reason).toLowerCase();
      }
    }

    const promptTokens =
      data.usage?.tokens?.input_tokens ??
      data.usage?.billed_units?.input_tokens ??
      0;
    const completionTokens =
      data.usage?.tokens?.output_tokens ??
      data.usage?.billed_units?.output_tokens ??
      0;

    return {
      id: data.id || `cohere-${Date.now()}`,
      model: data.model || this.resolveModel(requestedModel),
      choices: [
        {
          message: {
            role: 'assistant',
            content: textContent || null,
            reasoning_content: reasoningContent || null,
            tool_calls:
              toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason,
        },
      ],
      usage: data.usage
        ? {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          }
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.cohere.com/v2';
    const url = `${baseUrl}/chat`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }

    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Cohere API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          let streamId = `cohere-${Date.now()}`;
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const eventType = msg.event || parsed.type;

                if (eventType === 'message-start') {
                  if (parsed.id) streamId = parsed.id;
                } else if (eventType === 'content-delta') {
                  const textDelta =
                    parsed.delta?.message?.content?.text ??
                    parsed.delta?.text ??
                    '';
                  const thinkingDelta =
                    parsed.delta?.message?.content?.thinking ?? '';
                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {
                          role: 'assistant',
                          content: textDelta || undefined,
                          reasoning_content: thinkingDelta || undefined,
                        },
                        finishReason: null,
                      },
                    ],
                  };
                } else if (eventType === 'tool-call-start') {
                  const tc = parsed.delta?.message?.tool_calls;
                  if (tc) {
                    yield {
                      id: streamId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: parsed.index ?? 0,
                                id: tc.id,
                                type: 'function',
                                function: {
                                  name: tc.function?.name || '',
                                  arguments: tc.function?.arguments || '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  }
                } else if (eventType === 'tool-call-delta') {
                  const argDelta =
                    parsed.delta?.message?.tool_calls?.function?.arguments ||
                    '';
                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {
                          role: 'assistant',
                          tool_calls: [
                            {
                              index: parsed.index ?? 0,
                              function: {
                                arguments: argDelta,
                              },
                            },
                          ],
                        },
                        finishReason: null,
                      },
                    ],
                  };
                } else if (eventType === 'message-end') {
                  const rawReason = parsed.delta?.finish_reason;
                  let finishReason = 'stop';
                  if (rawReason === 'TOOL_CALL') finishReason = 'tool_calls';
                  else if (rawReason === 'MAX_TOKENS') finishReason = 'length';

                  const inTok =
                    parsed.delta?.usage?.tokens?.input_tokens ??
                    parsed.delta?.usage?.billed_units?.input_tokens ??
                    0;
                  const outTok =
                    parsed.delta?.usage?.tokens?.output_tokens ??
                    parsed.delta?.usage?.billed_units?.output_tokens ??
                    0;

                  yield {
                    id: streamId,
                    model: payload.model,
                    choices: [
                      {
                        delta: {},
                        finishReason,
                      },
                    ],
                    usage:
                      inTok || outTok
                        ? {
                            promptTokens: inTok,
                            completionTokens: outTok,
                            totalTokens: inTok + outTok,
                          }
                        : undefined,
                  };
                }
              } catch (_e) {}
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })();
      }

      const data = await response.json();
      const res = this.formatResponse(data, request.model);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async generateEmbedding(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    const baseUrl = this.config.baseUrl || 'https://api.cohere.com/v2';
    const url = `${baseUrl}/embed`;
    const texts = Array.isArray(request.input)
      ? request.input
      : [request.input];
    const targetModel =
      request.model && request.model !== 'default'
        ? request.model
        : COHERE_MODELS.EMBED_V4;

    // biome-ignore lint/suspicious/noExplicitAny: cohere embed payload
    const payload: any = {
      model: targetModel,
      texts,
      input_type: 'search_document',
      embedding_types: ['float'],
    };
    if (request.dimensions) {
      payload.output_dimension = request.dimensions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey || ''}`,
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Cohere Embedding API Error (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    // biome-ignore lint/suspicious/noExplicitAny: response json
    const data = (await response.json()) as any;
    const floatVectors: number[][] =
      data.embeddings?.float || data.embeddings || [];
    const inputTokens =
      data.meta?.billed_units?.input_tokens ??
      data.usage?.tokens?.input_tokens ??
      0;

    return {
      object: 'list',
      data: floatVectors.map((vec, index) => ({
        index,
        embedding: vec,
        object: 'embedding' as const,
      })),
      model: targetModel,
      usage: {
        promptTokens: inputTokens,
        totalTokens: inputTokens,
      },
    };
  }
}
