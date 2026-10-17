/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ContentPart,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const GEMINI_MODELS = {
  FLASH_2_5: 'gemini-2.5-flash',
  FLASH_LITE_2_5: 'gemini-2.5-flash-lite',
  PRO_2_5: 'gemini-2.5-pro',
  FLASH_3_8: 'gemini-3.8-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_LITE_3_5: 'gemini-3.5-flash-lite',
  PRO_3_1_PREVIEW: 'gemini-3.1-pro-preview',
  FLASH_LATEST: 'gemini-flash-latest',
  PRO_LATEST: 'gemini-pro-latest',
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
  safetySettings?: GeminiSafetySetting[];
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
      return GEMINI_MODELS.FLASH_2_5;
    }
    return model;
  }

  public formatRequest(request: UnifiedApiRequest) {
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini payload
    const contents: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: complex gemini parts
    const systemParts: any[] = [];

    // Petakan tool_call_id ke nama fungsi dari riwayat assistant
    const toolCallIdToName = new Map<string, string>();
    for (const m of request.messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallIdToName.set(tc.id, tc.function.name);
          }
        }
      }
    }

    const formatGeminiParts = (
      content: string | ContentPart[] | null | undefined,
      // biome-ignore lint/suspicious/noExplicitAny: gemini part format
    ): any[] => {
      if (content === null || content === undefined) {
        return [{ text: '' }];
      }
      if (typeof content === 'string') {
        return [{ text: content }];
      }
      if (Array.isArray(content)) {
        // biome-ignore lint/suspicious/noExplicitAny: gemini part format
        const parts: any[] = [];
        for (const part of content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            } else {
              let mimeType = 'image/jpeg';
              if (url.endsWith('.png')) mimeType = 'image/png';
              else if (url.endsWith('.webp')) mimeType = 'image/webp';
              else if (url.endsWith('.gif')) mimeType = 'image/gif';
              parts.push({
                fileData: {
                  mimeType,
                  fileUri: url,
                },
              });
            }
          } else if (part.type === 'input_audio') {
            parts.push({
              inlineData: {
                mimeType: `audio/${part.input_audio.format || 'wav'}`,
                data: part.input_audio.data,
              },
            });
          }
        }
        return parts.length > 0 ? parts : [{ text: '' }];
      }
      return [{ text: '' }];
    };

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemParts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const p of msg.content) {
            if (p.type === 'text') {
              systemParts.push({ text: p.text });
            }
          }
        }
      } else if (msg.role === 'tool') {
        const responseContent =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content ?? '');
        const resolvedName =
          msg.name ||
          (msg.tool_call_id
            ? toolCallIdToName.get(msg.tool_call_id)
            : undefined) ||
          'function';
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: resolvedName,
                response: { content: responseContent },
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
        if (typeof msg.content === 'string' && msg.content) {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const p of msg.content) {
            if (p.type === 'text') {
              parts.push({ text: p.text });
            }
          }
        }
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
        const msgParts = formatGeminiParts(msg.content);
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === geminiRole) {
          lastContent.parts.push(...msgParts);
        } else {
          contents.push({
            role: geminiRole,
            parts: msgParts,
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
    } else if (
      request.responseFormat?.type === 'json_schema' &&
      request.responseFormat.json_schema
    ) {
      generationConfig.responseMimeType = 'application/json';
      const cleanSchema = { ...request.responseFormat.json_schema.schema };
      delete (cleanSchema as Record<string, unknown>).additionalProperties;
      generationConfig.responseSchema = cleanSchema;
    }

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
    if (request.toolChoice) {
      if (request.toolChoice === 'auto') {
        payload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
      } else if (request.toolChoice === 'none') {
        payload.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      } else if (request.toolChoice === 'required') {
        payload.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
      } else if (typeof request.toolChoice === 'object') {
        payload.toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [request.toolChoice.function.name],
          },
        };
      }
    }

    return payload;
  }

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
    const action = request.stream
      ? 'streamGenerateContent?alt=sse'
      : 'generateContent';
    const finalUrl = `${baseUrl}/models/${targetModel}:${action}`;

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
          'x-goog-api-key': this.config.apiKey || '',
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
        return (async function* () {
          try {
            let chunkIndex = 0;
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const candidate = parsed.candidates?.[0];
                let text = '';
                let reasoning = '';
                // biome-ignore lint/suspicious/noExplicitAny: gemini tool calls
                const toolCalls: any[] = [];

                if (candidate?.content?.parts) {
                  for (const part of candidate.content.parts) {
                    if (part.thought) {
                      reasoning += part.text || '';
                    } else if (part.text) {
                      text += part.text;
                    }
                    if (part.functionCall) {
                      toolCalls.push({
                        index: chunkIndex++,
                        id: `call_${Date.now()}_${chunkIndex}`,
                        type: 'function',
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(
                            part.functionCall.args || {},
                          ),
                        },
                      });
                    }
                  }
                }

                const usage = parsed.usageMetadata
                  ? {
                      promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                      completionTokens:
                        parsed.usageMetadata.candidatesTokenCount || 0,
                      totalTokens: parsed.usageMetadata.totalTokenCount || 0,
                      cachedPromptTokens:
                        parsed.usageMetadata.cachedContentTokenCount ||
                        undefined,
                    }
                  : undefined;

                yield {
                  id: `gemini-${Date.now()}`,
                  model: targetModel,
                  choices: [
                    {
                      delta: {
                        role: 'assistant',
                        content: text || undefined,
                        reasoning_content: reasoning || undefined,
                        tool_calls:
                          toolCalls.length > 0 ? toolCalls : undefined,
                      },
                      finishReason:
                        toolCalls.length > 0
                          ? 'tool_calls'
                          : candidate?.finishReason
                            ? candidate.finishReason.toLowerCase()
                            : null,
                    },
                  ],
                  usage,
                };
              } catch (_e) {}
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        })();
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
    const targetModel =
      request.model && request.model !== 'default'
        ? request.model
        : GEMINI_MODELS.EMBEDDING_001;
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    const isBatch = Array.isArray(request.input);
    const endpoint = isBatch ? 'batchEmbedContents' : 'embedContent';
    const keyParam = this.config.apiKey ? `?key=${this.config.apiKey}` : '';
    const url = `${baseUrl}/models/${targetModel}:${endpoint}${keyParam}`;

    // biome-ignore lint/suspicious/noExplicitAny: gemini embedding payload
    let bodyPayload: any;
    if (isBatch) {
      bodyPayload = {
        requests: (request.input as string[]).map((text) => {
          // biome-ignore lint/suspicious/noExplicitAny: batch item
          const item: any = {
            model: `models/${targetModel}`,
            content: { parts: [{ text }] },
          };
          if (request.dimensions) {
            item.outputDimensionality = request.dimensions;
          }
          return item;
        }),
      };
    } else {
      bodyPayload = {
        content: { parts: [{ text: request.input as string }] },
      };
      if (request.dimensions) {
        bodyPayload.outputDimensionality = request.dimensions;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey || '',
      },
      body: JSON.stringify(bodyPayload),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Gemini Embedding API Error (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    // biome-ignore lint/suspicious/noExplicitAny: response json
    const data = (await response.json()) as any;
    const embeddingsList = isBatch
      ? (data.embeddings || []).map(
          // biome-ignore lint/suspicious/noExplicitAny: embedding item
          (e: any, idx: number) => ({
            index: idx,
            embedding: e.values || [],
            object: 'embedding' as const,
          }),
        )
      : [
          {
            index: 0,
            embedding: data.embedding?.values || [],
            object: 'embedding' as const,
          },
        ];

    return {
      object: 'list',
      data: embeddingsList,
      model: targetModel,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  static async fetchAvailableModels(options: {
    apiKey: string;
    baseUrl?: string;
  }): Promise<GeminiModelInfo[]> {
    const baseUrl =
      options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': options.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Gemini models (${response.status})`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response json
    const data = (await response.json()) as any;
    // biome-ignore lint/suspicious/noExplicitAny: model list item
    return (data.models || []).map((m: any) => ({
      id: (m.name || '').replace(/^models\//, ''),
      displayName: m.displayName || m.name,
      description: m.description,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      supportedGenerationMethods: m.supportedGenerationMethods || [],
    }));
  }
}
