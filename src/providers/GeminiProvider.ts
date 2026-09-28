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

  // Exposed for testing
  public formatRequest(request: UnifiedApiRequest) {
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini payload
    const contents: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini parts
    const systemParts: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content });
      } else {
        const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === geminiRole) {
          lastContent.parts.push({ text: msg.content });
        } else {
          contents.push({
            role: geminiRole,
            parts: [{ text: msg.content }],
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

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    return payload;
  }

  // Exposed for testing
  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any, model: string): UnifiedApiResponse {
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    let finishReason = 'stop';

    if (candidate?.finishReason) {
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
            content: text,
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

    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = request.stream
      ? 'streamGenerateContent?alt=sse'
      : 'generateContent';
    const _url =
      `${baseUrl}/models/${request.model}:${endpoint}&key=${this.config.apiKey}`
        .replace(
          ':streamGenerateContent?alt=sse&key=',
          ':streamGenerateContent?alt=sse&key=',
        )
        .replace(':generateContent&key=', ':generateContent?key=');

    const finalUrl = `${baseUrl}/models/${request.model}:${request.stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key='}${this.config.apiKey}`;

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
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
                const chunk = self.formatResponse(parsed, request.model);
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
      return this.formatResponse(data, request.model);
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
