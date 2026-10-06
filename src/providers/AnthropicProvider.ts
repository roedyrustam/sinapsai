import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
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

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const systemMessages: string[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (msg.content) systemMessages.push(msg.content);
      } else if (msg.role === 'tool') {
        payload.messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content || '',
            },
          ],
        });
      } else if (
        msg.role === 'assistant' &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: anthropic content blocks
        const contentBlocks: any[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
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
            content: msg.content ?? '',
          });
        }
      }
    }

    if (systemMessages.length > 0) {
      payload.system = systemMessages.join('\n');
    }

    if (request.tools) {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object' },
      }));
    }

    if (request.toolChoice) {
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
    // biome-ignore lint/suspicious/noExplicitAny: anthropic tool calls
    const toolCalls: any[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          text += block.text;
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
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
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
          const { parseSSE } = await import('../utils/stream.js');
          let messageId = `anthropic-${Date.now()}`;
          try {
            for await (const msg of parseSSE(response)) {
              if (msg.event === 'message_start') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.message?.id) messageId = parsed.message.id;
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
                  }
                } catch (_e) {}
              } else if (msg.event === 'message_delta') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.delta?.stop_reason) {
                    let finishReason = 'stop';
                    switch (parsed.delta.stop_reason) {
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
                    };
                  }
                } catch (_e) {}
              }
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
