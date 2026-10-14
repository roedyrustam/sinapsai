import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import type { Provider } from './Provider.js';

/**
 * Canonical Gemini Model identifiers as documented in Google AI developer documentation:
 * Reference: https://ai.google.dev/gemini-api/docs/models?hl=id
 */
export const GEMINI_MODELS = {
  // Flagship & General Multimodal Models
  FLASH_2_5: 'gemini-2.5-flash',
  FLASH_LITE_2_5: 'gemini-2.5-flash-lite',
  PRO_2_5: 'gemini-2.5-pro',
  FLASH_3_8: 'gemini-3.8-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_LITE_3_5: 'gemini-3.5-flash-lite',
  PRO_3_1_PREVIEW: 'gemini-3.1-pro-preview',

  // Auto-updating Managed Aliases
  FLASH_LATEST: 'gemini-flash-latest',
  PRO_LATEST: 'gemini-pro-latest',

  // Embeddings Models
  EMBEDDING_001: 'gemini-embedding-001',
  EMBEDDING_2: 'gemini-embedding-2',
  TEXT_EMBEDDING_004: 'text-embedding-004',
} as const;

export interface GeminiSafetySetting {
  category:
    | 'HARM_CATEGORY_HARASSMENT'
    | 'HARM_CATEGORY_HATE_SPEECH'
    | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
    | 'HARM_CATEGORY_DANGEROUS_CONTENT'
    | 'HARM_CATEGORY_CIVIC_INTEGRITY'
    | string;
  threshold:
    | 'BLOCK_NONE'
    | 'BLOCK_LOW_AND_ABOVE'
    | 'BLOCK_MEDIUM_AND_ABOVE'
    | 'BLOCK_ONLY_HIGH'
    | string;
}

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods: string[];
}

export interface GeminiProviderConfig extends ProviderConfig {
  /**
   * Optional safety settings to enforce content moderation thresholds.
   */
  safetySettings?: GeminiSafetySetting[];

  /**
   * Optional default thinking budget in tokens for extended reasoning models
   * (e.g. Gemini 2.5 Pro / Flash Thinking). Set to 0 to disable thinking.
   */
  thinkingBudget?: number;
}

export class GeminiProvider implements Provider {
  id: string;
  name = 'Gemini';
  private config: GeminiProviderConfig;

  constructor(config: GeminiProviderConfig) {
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
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === 'default') {
      return GEMINI_MODELS.FLASH_2_5;
    }
    return model;
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

    // Extended Thinking / Reasoning configuration
    const thinkingBudget = request.thinkingBudget ?? this.config.thinkingBudget;
    if (thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = {
        thinkingBudget,
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = { contents };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts };
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }
    if (this.config.safetySettings && this.config.safetySettings.length > 0) {
      payload.safetySettings = this.config.safetySettings;
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
    let reasoningContent = '';
    // biome-ignore lint/suspicious/noExplicitAny: gemini tool calls
    const toolCalls: any[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.thought) {
          reasoningContent += part.text || '';
        } else if (part.text) {
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
            reasoning_content: reasoningContent || undefined,
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
            cachedPromptTokens:
              data.usageMetadata.cachedContentTokenCount || undefined,
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
                        reasoning_content:
                          chunk.choices[0].message.reasoning_content,
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
                  usage: chunk.usage,
                };
              } catch (_e) {}
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })(this);
      }

      const data = await response.json();
      const res = this.formatResponse(data, targetModel);
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
    const targetModel = this.resolveModel(request.model);
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    const isBatch = Array.isArray(request.input);
    const inputs = Array.isArray(request.input)
      ? request.input
      : [request.input];

    const finalUrl = isBatch
      ? `${baseUrl}/models/${targetModel}:batchEmbedContents?key=${this.config.apiKey}`
      : `${baseUrl}/models/${targetModel}:embedContent?key=${this.config.apiKey}`;

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

    // biome-ignore lint/suspicious/noExplicitAny: Gemini embedding payload
    const payload: any = isBatch
      ? {
          requests: inputs.map((text) => {
            // biome-ignore lint/suspicious/noExplicitAny: request item
            const reqObj: any = {
              model: `models/${targetModel}`,
              content: { parts: [{ text }] },
            };
            if (request.dimensions !== undefined) {
              reqObj.outputDimensionality = request.dimensions;
            }
            return reqObj;
          }),
        }
      : {
          content: { parts: [{ text: inputs[0] }] },
        };

    if (!isBatch && request.dimensions !== undefined) {
      payload.outputDimensionality = request.dimensions;
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

      // biome-ignore lint/suspicious/noExplicitAny: Gemini embeddings response
      const data: any = await response.json();

      if (isBatch) {
        const embeddingsList = (data.embeddings || []).map(
          // biome-ignore lint/suspicious/noExplicitAny: embedding item
          (item: any, idx: number) => ({
            object: 'embedding' as const,
            index: idx,
            embedding: item.values || [],
          }),
        );
        return {
          object: 'list',
          model: targetModel,
          data: embeddingsList,
          usage: data.usageMetadata
            ? {
                promptTokens: data.usageMetadata.promptTokenCount || 0,
                totalTokens: data.usageMetadata.totalTokenCount || 0,
              }
            : undefined,
        };
      }

      return {
        object: 'list',
        model: targetModel,
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: data.embedding?.values || [],
          },
        ],
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount || 0,
              totalTokens: data.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Fetches all available Gemini models directly from Google Generative Language API.
   * Corresponds to models listed on https://ai.google.dev/gemini-api/docs/models?hl=id
   */
  static async fetchAvailableModels(options: {
    apiKey: string;
    baseUrl?: string;
    signal?: AbortSignal;
  }): Promise<GeminiModelInfo[]> {
    const baseUrl =
      options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetch(`${baseUrl}/models?key=${options.apiKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch Gemini models (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        baseModelId?: string;
        version?: string;
        displayName?: string;
        description?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
        temperature?: number;
      }>;
    };

    return (data.models || []).map((m) => {
      const id = m.name.replace(/^models\//, '');
      return {
        id,
        displayName: m.displayName || id,
        description: m.description,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
        supportedGenerationMethods: m.supportedGenerationMethods || [],
      };
    });
  }
}
