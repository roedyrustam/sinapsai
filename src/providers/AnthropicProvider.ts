import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
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

  public formatRequest(request: UnifiedApiRequest) {
    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages: [],
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const systemMessages: string[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (lastMsg && lastMsg.role === msg.role) {
          lastMsg.content += `\n\n${msg.content}`;
        } else {
          payload.messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }

    if (systemMessages.length > 0) {
      payload.system = systemMessages.join('\n');
    }

    if (request.stream) {
      payload.stream = true;
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any): UnifiedApiResponse {
    // biome-ignore lint/suspicious/noExplicitAny: provider specific response
    const text = data.content?.map((c: any) => c.text).join('') || '';

    let finishReason = 'stop';
    if (data.stop_reason) {
      switch (data.stop_reason) {
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
            content: text,
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
    let timeoutId: NodeJS.Timeout | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
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
                      model: request.model,
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
                      model: request.model,
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
      return this.formatResponse(data);
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
