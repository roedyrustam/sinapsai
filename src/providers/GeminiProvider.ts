/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { GeminiAgentBooster } from '../core/GeminiAgentBooster.js';
import type {
  CachedContentInfo,
  ContentPart,
  CreateCachedContentOptions,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  GroundingMetadata,
  GroundingSource,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const GEMINI_MODELS = {
  PRO_4: 'gemini-4-pro',
  ARGON_4: 'gemini-4-argon',
  FLASH_4: 'gemini-4-flash',
  PROJECT_ASTRA: 'gemini-4-flash',
  FLASH_3_8: 'gemini-3.8-flash',
  FLASH_3_6: 'gemini-3.6-flash',
  FLASH_LITE_3_5: 'gemini-3.5-flash-lite',
  PRO_3_1_PREVIEW: 'gemini-3.1-pro-preview',
  FLASH_2_5: 'gemini-2.5-flash',
  FLASH_LITE_2_5: 'gemini-2.5-flash-lite',
  PRO_2_5: 'gemini-2.5-pro',
  FLASH_2_0: 'gemini-2.0-flash',
  FLASH_2_0_LITE: 'gemini-2.0-flash-lite',
  FLASH_THINKING_2_0: 'gemini-2.0-flash-thinking-exp',
  PRO_2_0: 'gemini-2.0-pro-exp',
  FLASH_LATEST: 'gemini-flash-latest',
  PRO_LATEST: 'gemini-pro-latest',
  EMBEDDING_001: 'gemini-embedding-001',
  EMBEDDING_2: 'gemini-embedding-2',
  TEXT_EMBEDDING_004: 'text-embedding-004',
} as const;

export const GEMINI_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  'gemini-4-pro': ['gemini-3.8-flash'],
  'gemini-4-argon': ['gemini-3.8-flash'],
};

export const GEMINI_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'gemini-4-pro': { promptCostPer1k: 0.00125, completionCostPer1k: 0.005 },
  'gemini-4-argon': { promptCostPer1k: 0.0005, completionCostPer1k: 0.002 },
  'gemini-4-flash': { promptCostPer1k: 0.000075, completionCostPer1k: 0.0003 },
  'gemini-3.8-flash': {
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  },
  'gemini-3.6-flash': {
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  },
  'gemini-3.5-flash-lite': {
    promptCostPer1k: 0.0000375,
    completionCostPer1k: 0.00015,
  },
  'gemini-3.1-pro-preview': {
    promptCostPer1k: 0.00125,
    completionCostPer1k: 0.005,
  },
  'gemini-2.5-pro': { promptCostPer1k: 0.00125, completionCostPer1k: 0.005 },
  'gemini-2.5-flash': {
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  },
  'gemini-2.5-flash-lite': {
    promptCostPer1k: 0.0000375,
    completionCostPer1k: 0.00015,
  },
  'gemini-2.0-flash': { promptCostPer1k: 0.0001, completionCostPer1k: 0.0004 },
  'gemini-2.0-flash-lite': {
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  },
  'gemini-2.0-pro-exp': {
    promptCostPer1k: 0.00125,
    completionCostPer1k: 0.005,
  },
  'gemini-flash-latest': {
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  },
  'gemini-pro-latest': { promptCostPer1k: 0.00125, completionCostPer1k: 0.005 },
  'text-embedding-004': { promptCostPer1k: 0.00001, completionCostPer1k: 0 },
  'gemini-embedding-001': { promptCostPer1k: 0.00001, completionCostPer1k: 0 },
  'gemini-embedding-2': { promptCostPer1k: 0.00001, completionCostPer1k: 0 },
};

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
  thinkingBudget?: number | 'auto';
  cachedContent?: string;
  googleSearch?: boolean;
  codeExecution?: boolean;
  /**
   * Automatically append 'gemini-3.8-flash' fallback when using Gemini 4 frontier models
   * ('gemini-4-pro' or 'gemini-4-argon') to satisfy the Availability Fallback Invariant.
   */
  enableAvailabilityFallback?: boolean;
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
    if (this.config.promptCostPer1k !== undefined) {
      return this.config.promptCostPer1k;
    }
    const model = this.resolveModel(this.defaultModel || 'default');
    return GEMINI_DEFAULT_PRICING[model]?.promptCostPer1k;
  }

  get completionCostPer1k(): number | undefined {
    if (this.config.completionCostPer1k !== undefined) {
      return this.config.completionCostPer1k;
    }
    const model = this.resolveModel(this.defaultModel || 'default');
    return GEMINI_DEFAULT_PRICING[model]?.completionCostPer1k;
  }

  get retries(): number | undefined {
    return this.config.retries;
  }

  get retryDelayMs(): number | undefined {
    return this.config.retryDelayMs;
  }

  get fallbackModels(): string[] | undefined {
    if (this.config.fallbackModels) {
      return this.config.fallbackModels;
    }
    if (this.config.enableAvailabilityFallback) {
      const target = this.defaultModel || 'gemini-4-pro';
      return GEMINI_AVAILABILITY_FALLBACKS[target] || [GEMINI_MODELS.FLASH_3_8];
    }
    return undefined;
  }

  /**
   * Returns the canonical availability fallback models for a given Gemini frontier model.
   */
  public static getAvailabilityFallbacks(model: string): string[] {
    return GEMINI_AVAILABILITY_FALLBACKS[model] || [];
  }

  get defaultModel(): string | undefined {
    return this.config.defaultModel;
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
              else if (url.endsWith('.svg')) mimeType = 'image/svg+xml';
              else if (url.endsWith('.pdf')) mimeType = 'application/pdf';
              else if (url.endsWith('.mp4')) mimeType = 'video/mp4';
              else if (url.endsWith('.webm')) mimeType = 'video/webm';
              else if (url.endsWith('.mp3')) mimeType = 'audio/mp3';
              else if (url.endsWith('.wav')) mimeType = 'audio/wav';
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
        const functionResponsePart = {
          functionResponse: {
            name: resolvedName,
            response: { content: responseContent },
          },
        };
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === 'user') {
          lastContent.parts.push(functionResponsePart);
        } else {
          contents.push({
            role: 'user',
            parts: [functionResponsePart],
          });
        }
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

    const rawThinkingBudget =
      request.thinkingBudget ?? this.config.thinkingBudget;
    let thinkingBudget: number | undefined;
    if (rawThinkingBudget === 'auto') {
      thinkingBudget = GeminiAgentBooster.computeDynamicThinkingBudget(request);
    } else {
      thinkingBudget = rawThinkingBudget;
    }
    if (thinkingBudget === undefined && request.reasoningEffort) {
      if (request.reasoningEffort === 'low') {
        thinkingBudget = 2048;
      } else if (request.reasoningEffort === 'medium') {
        thinkingBudget = 8192;
      } else if (request.reasoningEffort === 'high') {
        thinkingBudget = 32768;
      }
    }
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

    const cachedContent = request.cachedContent ?? this.config.cachedContent;
    if (cachedContent) {
      payload.cachedContent = cachedContent;
    }

    // biome-ignore lint/suspicious/noExplicitAny: gemini tools array
    const tools: any[] = [];
    if (request.tools && request.tools.length > 0) {
      const canonicalTools = GeminiAgentBooster.canonicalizeTools(
        request.tools,
      );
      tools.push({
        functionDeclarations: canonicalTools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      });
    }

    const useGoogleSearch = request.googleSearch ?? this.config.googleSearch;
    if (useGoogleSearch) {
      tools.push({ googleSearch: {} });
    }

    const useCodeExecution = request.codeExecution ?? this.config.codeExecution;
    if (useCodeExecution) {
      tools.push({ codeExecution: {} });
    }

    if (tools.length > 0) {
      payload.tools = tools;
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
        if (typeof part.thought === 'string') {
          reasoningContent += part.thought;
        } else if (part.thought) {
          reasoningContent += part.text || '';
        } else if (part.text) {
          text += part.text;
        }

        if (part.executableCode) {
          const lang = (part.executableCode.language || 'python').toLowerCase();
          text += `\n\`\`\`${lang}\n${part.executableCode.code || ''}\n\`\`\`\n`;
        }
        if (part.codeExecutionResult) {
          text += `\n\`\`\`\n[Execution Outcome: ${part.codeExecutionResult.outcome || 'OK'}]\n${part.codeExecutionResult.output || ''}\n\`\`\`\n`;
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

    let grounding: GroundingMetadata | undefined;
    if (candidate?.groundingMetadata) {
      const gm = candidate.groundingMetadata;
      const sources: GroundingSource[] = [];
      if (Array.isArray(gm.groundingChunks)) {
        for (const gc of gm.groundingChunks) {
          if (gc.web) {
            sources.push({
              title: gc.web.title,
              uri: gc.web.uri,
            });
          }
        }
      }
      grounding = {
        webSearchQueries: gm.webSearchQueries,
        sources: sources.length > 0 ? sources : undefined,
        searchEntryPoint: gm.searchEntryPoint?.renderedContent,
      };
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
            grounding,
          },
          finishReason,
        },
      ],
      grounding,
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

    const cleanupSignal = linkAbortSignal(controller, request.signal);

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
                    if (typeof part.thought === 'string') {
                      reasoning += part.thought;
                    } else if (part.thought) {
                      reasoning += part.text || '';
                    } else if (part.text) {
                      text += part.text;
                    }

                    if (part.executableCode) {
                      const lang = (
                        part.executableCode.language || 'python'
                      ).toLowerCase();
                      text += `\n\`\`\`${lang}\n${part.executableCode.code || ''}\n\`\`\`\n`;
                    }
                    if (part.codeExecutionResult) {
                      text += `\n\`\`\`\n[Execution Outcome: ${part.codeExecutionResult.outcome || 'OK'}]\n${part.codeExecutionResult.output || ''}\n\`\`\`\n`;
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

                let streamGrounding: GroundingMetadata | undefined;
                if (candidate?.groundingMetadata) {
                  const gm = candidate.groundingMetadata;
                  const sources: GroundingSource[] = [];
                  if (Array.isArray(gm.groundingChunks)) {
                    for (const gc of gm.groundingChunks) {
                      if (gc.web) {
                        sources.push({
                          title: gc.web.title,
                          uri: gc.web.uri,
                        });
                      }
                    }
                  }
                  streamGrounding = {
                    webSearchQueries: gm.webSearchQueries,
                    sources: sources.length > 0 ? sources : undefined,
                    searchEntryPoint: gm.searchEntryPoint?.renderedContent,
                  };
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
                  grounding: streamGrounding,
                };
              } catch (_e) {}
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
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
    const targetModel =
      request.model && request.model !== 'default'
        ? request.model
        : GEMINI_MODELS.EMBEDDING_001;
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    const isBatch = Array.isArray(request.input);
    const endpoint = isBatch ? 'batchEmbedContents' : 'embedContent';
    const url = `${baseUrl}/models/${targetModel}:${endpoint}`;

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
          'x-goog-api-key': this.config.apiKey || '',
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
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
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
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

  /**
   * Creates a context cache resource on Google Gemini API for long contexts (>32,768 tokens),
   * providing up to 75%-90% cost reduction and lower latency.
   */
  async createCachedContent(
    options: CreateCachedContentOptions,
  ): Promise<CachedContentInfo> {
    const targetModel = this.resolveModel(options.model);
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    let contents = options.contents;
    if (!contents && options.messages) {
      const formatted = this.formatRequest({
        model: targetModel,
        messages: options.messages,
      });
      contents = formatted.contents;
    }

    // biome-ignore lint/suspicious/noExplicitAny: cached content body
    const body: any = {
      model: `models/${targetModel}`,
      contents: contents || [],
      ttl: options.ttl || '3600s',
    };
    if (options.displayName) {
      body.displayName = options.displayName;
    }
    if (options.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    const response = await fetch(`${baseUrl}/cachedContents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to create Gemini CachedContent (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return (await response.json()) as CachedContentInfo;
  }

  /**
   * Fetches metadata for an existing Gemini CachedContent.
   */
  async getCachedContent(name: string): Promise<CachedContentInfo> {
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const resourcePath = name.startsWith('cachedContents/')
      ? name
      : `cachedContents/${name}`;

    const response = await fetch(`${baseUrl}/${resourcePath}`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.config.apiKey || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to get Gemini CachedContent (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return (await response.json()) as CachedContentInfo;
  }

  /**
   * Lists active CachedContents for the configured Gemini API key.
   */
  async listCachedContents(pageSize?: number): Promise<CachedContentInfo[]> {
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const query = pageSize ? `?pageSize=${pageSize}` : '';

    const response = await fetch(`${baseUrl}/cachedContents${query}`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.config.apiKey || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to list Gemini CachedContents (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    // biome-ignore lint/suspicious/noExplicitAny: response json
    const data = (await response.json()) as any;
    return (data.cachedContents || []) as CachedContentInfo[];
  }

  /**
   * Deletes a Gemini CachedContent by name.
   */
  async deleteCachedContent(name: string): Promise<void> {
    const baseUrl =
      this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const resourcePath = name.startsWith('cachedContents/')
      ? name
      : `cachedContents/${name}`;

    const response = await fetch(`${baseUrl}/${resourcePath}`, {
      method: 'DELETE',
      headers: {
        'x-goog-api-key': this.config.apiKey || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Failed to delete Gemini CachedContent (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
  }
}
