import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { Provider } from './Provider.js';

export class GeminiProvider implements Provider {
  id: string;
  name = 'Gemini';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

  // Exposed for testing
  public formatRequest(request: UnifiedApiRequest) {
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini payload
    const contents: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini parts
    const systemParts: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (msg.content) systemParts.push({ text: msg.content });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'function',
                response: { content: msg.content },
              },
            },
          ],
        });
      } else if (
        msg.role === 'assistant' &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: gemini parts
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
        contents.push({
          role: 'model',
          parts,
        });
      } else {
        const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
        const lastContent = contents[contents.length - 1];
        if (
          lastContent &&
          lastContent.role === geminiRole &&
          typeof msg.content === 'string'
        ) {
          lastContent.parts.push({ text: msg.content });
        } else {
          contents.push({
            role: geminiRole,
            parts: [{ text: msg.content ?? '' }],
          });
        }
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: gemini config
    const generationConfig: any = {};
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.responseFormat?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }
    if (request.tools) {
      payload.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
    }

    return payload;
  }

  // Exposed for testing
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any, model: string): UnifiedApiResponse {
    const candidate = data.candidates?.[0];
    let text = '';
    // biome-ignore lint/suspicious/noExplicitAny: gemini tool calls
    const toolCalls: any[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
        }
      }
    }

    let finishReason = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (candidate?.finishReason) {
      switch (candidate.finishReason) {
        case 'MAX_TOKENS':
          finishReason = 'length';
          break;
        case 'SAFETY':
        case 'RECITATION':
          finishReason = 'content_filter';
          break;
        case 'STOP':
          finishReason = 'stop';
          break;
        default:
          finishReason = candidate.finishReason.toLowerCase();
      }
    }

    return {
      id: `gemini-${Date.now()}`,
      model,
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
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            completionTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const targetModel = this.resolveModel(request.model);

    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const finalUrl = `${baseUrl}/models/${targetModel}:${request.stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key='}${this.config.apiKey}`;

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
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Gemini API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* (self) {
          const { parseSSE } = await import('../utils/stream.js');
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = self.formatResponse(parsed, targetModel);
                yield {
                  id: chunk.id,
                  model: chunk.model,
                  choices: [
                    {
                      delta: {
                        role: 'assistant',
                        content: chunk.choices[0].message.content,
                      },
                      finishReason:
                        chunk.choices[0].finishReason === 'stop' &&
                        !chunk.choices[0].message.content
                          ? 'stop'
                          : chunk.choices[0].finishReason !== 'stop'
                            ? chunk.choices[0].finishReason
                            : null,
                    },
                  ],
                };
              } catch (_e) {}
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })(this);
      }

      const data = await response.json();
      return this.formatResponse(data, targetModel);
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
