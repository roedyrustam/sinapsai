/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ContentPart,
  ProviderConfig,
  TextContentPart,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export class AnthropicProvider implements Provider {
  id: string;
  name = 'Anthropic';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `anthropic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

  get defaultModel(): string | undefined {
    return this.config.defaultModel;
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }

  public formatRequest(request: UnifiedApiRequest) {
    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: this.resolveModel(request.model),
      max_tokens: request.maxTokens || 4096,
      messages: [],
    };

    if (request.thinkingBudget !== undefined && request.thinkingBudget > 0) {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: request.thinkingBudget,
      };
      if (!request.maxTokens || request.maxTokens <= request.thinkingBudget) {
        payload.max_tokens = request.thinkingBudget + 4096;
      }
      payload.temperature = 1.0;
    } else if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const systemMessages: string[] = [];

    const formatAnthropicContent = (content: string | ContentPart[] | null) => {
      if (content === null || content === undefined) return '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map((part) => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          }
          if (part.type === 'image_url') {
            const url = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
            return {
              type: 'image',
              source: {
                type: 'url',
                url,
              },
            };
          }
          return { type: 'text', text: JSON.stringify(part) };
        });
      }
      return '';
    };

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemMessages.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          const sysText = msg.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as TextContentPart).text)
            .join('\n');
          if (sysText) systemMessages.push(sysText);
        }
      } else if (msg.role === 'tool') {
        const toolContent =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content || '');
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: toolContent,
        };
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'user' &&
          Array.isArray(lastMsg.content)
        ) {
          lastMsg.content.push(toolResultBlock);
        } else {
          payload.messages.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
      } else if (
        msg.role === 'assistant' &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: anthropic content blocks
        const contentBlocks: any[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              contentBlocks.push({ type: 'text', text: part.text });
            }
          }
        }
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        payload.messages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === msg.role &&
          typeof lastMsg.content === 'string' &&
          typeof msg.content === 'string'
        ) {
          lastMsg.content += `\n\n${msg.content}`;
        } else {
          payload.messages.push({
            role: msg.role,
            content: formatAnthropicContent(msg.content),
          });
        }
      }
    }

    if (request.responseFormat?.type === 'json_object') {
      systemMessages.push(
        'Respond strictly with a valid JSON object without markdown wrappers.',
      );
    } else if (
      request.responseFormat?.type === 'json_schema' &&
      request.responseFormat.json_schema
    ) {
      systemMessages.push(
        `Respond strictly with valid JSON matching this schema:\n${JSON.stringify(request.responseFormat.json_schema.schema)}`,
      );
    }

    if (systemMessages.length > 0) {
      const systemText = systemMessages.join('\n');
      const shouldCache =
        this.config.promptCaching === true ||
        (this.config.promptCaching !== false && systemText.length >= 2048);
      if (shouldCache) {
        payload.system = [
          {
            type: 'text',
            text: systemText,
            cache_control: { type: 'ephemeral' },
          },
        ];
      } else {
        payload.system = systemText;
      }
    }

    if (request.tools && request.toolChoice !== 'none') {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object' },
      }));
    }

    if (request.toolChoice && request.toolChoice !== 'none') {
      if (request.toolChoice === 'auto') {
        payload.tool_choice = { type: 'auto' };
      } else if (request.toolChoice === 'required') {
        payload.tool_choice = { type: 'any' };
      } else if (typeof request.toolChoice === 'object') {
        payload.tool_choice = {
          type: 'tool',
          name: request.toolChoice.function.name,
        };
      }
    }

    if (request.stream) {
      payload.stream = true;
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any): UnifiedApiResponse {
    let text = '';
    let reasoningContent = '';
    // biome-ignore lint/suspicious/noExplicitAny: anthropic tool calls
    const toolCalls: any[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'thinking') {
          reasoningContent += block.thinking;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
        }
      }
    }

    let finishReason = 'stop';
    if (data.stop_reason) {
      switch (data.stop_reason) {
        case 'tool_use':
          finishReason = 'tool_calls';
          break;
        case 'max_tokens':
          finishReason = 'length';
          break;
        case 'end_turn':
        case 'stop_sequence':
          finishReason = 'stop';
          break;
        default:
          finishReason = data.stop_reason;
      }
    }

    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: text || null,
            reasoning_content: reasoningContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason,
        },
      ],
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens || 0,
            completionTokens: data.usage.output_tokens || 0,
            totalTokens:
              (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            cachedPromptTokens: data.usage.cache_read_input_tokens || undefined,
          }
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }

    const cleanupSignal = linkAbortSignal(controller, request.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.promptCaching || Array.isArray(payload.system)) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Anthropic API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          let messageId = `anthropic-${Date.now()}`;
          let promptTokens = 0;
          let cachedPromptTokens: number | undefined;
          try {
            for await (const msg of parseSSE(response)) {
              if (msg.event === 'message_start') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.message?.id) messageId = parsed.message.id;
                  if (parsed.message?.usage) {
                    promptTokens = parsed.message.usage.input_tokens || 0;
                    cachedPromptTokens =
                      parsed.message.usage.cache_read_input_tokens || undefined;
                  }
                } catch (_e) {}
              } else if (msg.event === 'content_block_start') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.content_block?.type === 'tool_use') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: parsed.index,
                                id: parsed.content_block.id,
                                type: 'function',
                                function: {
                                  name: parsed.content_block.name,
                                  arguments: '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  }
                } catch (_e) {}
              } else if (msg.event === 'content_block_delta') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.delta?.type === 'text_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: parsed.delta.text || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (parsed.delta?.type === 'thinking_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            reasoning_content: parsed.delta.thinking || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (parsed.delta?.type === 'input_json_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: parsed.index,
                                function: {
                                  arguments: parsed.delta.partial_json || '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  }
                } catch (_e) {}
              } else if (msg.event === 'message_delta') {
                try {
                  const parsed = JSON.parse(msg.data);
                  const completionTokens = parsed.usage?.output_tokens || 0;
                  const chunkUsage =
                    promptTokens || completionTokens
                      ? {
                          promptTokens,
                          completionTokens,
                          totalTokens: promptTokens + completionTokens,
                          cachedPromptTokens,
                        }
                      : undefined;

                  if (parsed.delta?.stop_reason) {
                    let finishReason = 'stop';
                    switch (parsed.delta.stop_reason) {
                      case 'tool_use':
                        finishReason = 'tool_calls';
                        break;
                      case 'max_tokens':
                        finishReason = 'length';
                        break;
                      case 'end_turn':
                      case 'stop_sequence':
                        finishReason = 'stop';
                        break;
                      default:
                        finishReason = parsed.delta.stop_reason;
                    }
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {},
                          finishReason,
                        },
                      ],
                      usage: chunkUsage,
                    };
                  }
                } catch (_e) {}
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
      const res = this.formatResponse(data);
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
}
