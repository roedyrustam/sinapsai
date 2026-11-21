/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import type { Provider } from './Provider.js';

export const ZHIPU_MODELS = {
  // GLM-4.5 Frontier Series
  GLM_4_5: 'glm-4.5',
  GLM_4_5_AIR: 'glm-4.5-air',
  GLM_4_5_FLASH: 'glm-4.5-flash',
  GLM_4_5V: 'glm-4.5v',

  // Deep Reasoning Series
  GLM_Z1_AIR: 'glm-z1-air',
  GLM_Z1_FLASH: 'glm-z1-flash',

  // GLM-4 Generation
  GLM_4_PLUS: 'glm-4-plus',
  GLM_4_AIR: 'glm-4-air',
  GLM_4_FLASH: 'glm-4-flash',

  // Embeddings
  EMBEDDING_3: 'embedding-3',
  EMBEDDING_2: 'embedding-2',
} as const;

export const ZHIPU_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  'glm-4.5': ['glm-4.5-air', 'glm-4-plus'],
  'glm-4.5-air': ['glm-4.5-flash', 'glm-4-air'],
  'glm-z1-air': ['glm-z1-flash', 'glm-4.5'],
  'glm-4.5v': ['glm-4.5'],
};

export const ZHIPU_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'glm-4.5': { promptCostPer1k: 0.0006, completionCostPer1k: 0.0022 },
  'glm-4.5-air': { promptCostPer1k: 0.0002, completionCostPer1k: 0.0011 },
  'glm-4.5-flash': { promptCostPer1k: 0.00001, completionCostPer1k: 0.00001 },
  'glm-4.5v': { promptCostPer1k: 0.0006, completionCostPer1k: 0.0018 },
  'glm-z1-air': { promptCostPer1k: 0.0005, completionCostPer1k: 0.002 },
  'glm-z1-flash': { promptCostPer1k: 0.00001, completionCostPer1k: 0.00001 },
  'glm-4-plus': { promptCostPer1k: 0.0007, completionCostPer1k: 0.0007 },
  'glm-4-air': { promptCostPer1k: 0.00014, completionCostPer1k: 0.00014 },
  'glm-4-flash': { promptCostPer1k: 0.00001, completionCostPer1k: 0.00001 },
  'embedding-3': { promptCostPer1k: 0.00007, completionCostPer1k: 0 },
  'embedding-2': { promptCostPer1k: 0.00007, completionCostPer1k: 0 },
};

export interface ZhipuProviderConfig extends ProviderConfig {
  /**
   * Default GLM-4.5 hybrid thinking mode (`thinking: { type: 'enabled' | 'disabled' }`).
   */
  enableThinking?: boolean;
  /**
   * Enables Zhipu's native `web_search` tool by default.
   */
  enableWebSearch?: boolean;
}

/**
 * Native Zhipu AI (GLM-4.5 / GLM-Z1 / Embedding-3) Provider.
 *
 * Compatible with Zhipu BigModel / Z.AI OpenAI-compatible API endpoints:
 * - Default Global (Z.AI): https://api.z.ai/api/paas/v4
 * - China Domestic (BigModel): https://open.bigmodel.cn/api/paas/v4
 */
export class ZhipuProvider implements Provider {
  id: string;
  name = 'Zhipu';
  private config: ZhipuProviderConfig;

  constructor(config: ZhipuProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `zhipu-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
    const messages = request.messages.map((m) => {
      let formattedContent = m.content;
      if (Array.isArray(m.content)) {
        formattedContent = m.content.map((part) => {
          if (part.type === 'image_url') {
            const img = part.image_url ?? part.imageUrl;
            return {
              type: 'image_url',
              image_url: {
                url: img?.url,
                ...(img?.detail ? { detail: img.detail } : {}),
              },
            };
          }
          return part;
        });
      }

      // biome-ignore lint/suspicious/noExplicitAny: Zhipu OpenAI-compatible message structure
      const msg: any = {
        role: m.role === 'developer' ? 'system' : m.role,
        content: formattedContent,
      };
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      if (m.name) {
        msg.name = m.name;
      }
      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id;
      }
      if (m.tool_calls) {
        msg.tool_calls = m.tool_calls;
      }
      return msg;
    });

    // biome-ignore lint/suspicious/noExplicitAny: Zhipu request payload
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
    if (request.stream) {
      payload.stream = true;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Zhipu tools may include native web_search
    const tools: any[] = request.tools ? [...request.tools] : [];
    if (request.webSearch ?? this.config.enableWebSearch) {
      const hasWebSearch = tools.some((t) => t.type === 'web_search');
      if (!hasWebSearch) {
        tools.push({
          type: 'web_search',
          web_search: { enable: true },
        });
      }
    }
    if (tools.length > 0) {
      payload.tools = tools;
    }

    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }

    // GLM-4.5 Hybrid Thinking (`thinking: { type: 'enabled' | 'disabled' }`)
    if (request.thinkingBudget === 0 || request.reasoningEffort === 'none') {
      payload.thinking = { type: 'disabled' };
    } else if (
      request.thinkingBudget === 'auto' ||
      (typeof request.thinkingBudget === 'number' &&
        request.thinkingBudget > 0) ||
      request.reasoningEffort !== undefined
    ) {
      payload.thinking = { type: 'enabled' };
    } else if (this.config.enableThinking !== undefined) {
      payload.thinking = {
        type: this.config.enableThinking ? 'enabled' : 'disabled',
      };
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Zhipu response format
  public formatResponse(data: any): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const cachedPromptTokens =
      data.usage?.prompt_tokens_details?.cached_tokens ?? undefined;

    return {
      id: data.id || `zhipu-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
            reasoning_content: choice?.message?.reasoning_content ?? null,
            tool_calls: choice?.message?.tool_calls,
          },
          finishReason: choice?.finish_reason || 'stop',
        },
      ],
      usage: data.usage
        ? (() => {
            const reasoningTokens =
              data.usage.completion_tokens_details?.reasoning_tokens;
            return {
              promptTokens: data.usage.prompt_tokens || 0,
              completionTokens: data.usage.completion_tokens || 0,
              totalTokens: data.usage.total_tokens || 0,
              cachedPromptTokens,
              ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
            };
          })()
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.z.ai/api/paas/v4';
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

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
          `Zhipu API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          const { parseSSE } = await import('../utils/stream.js');
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                const cachedPromptTokens =
                  parsed.usage?.prompt_tokens_details?.cached_tokens ??
                  undefined;

                yield {
                  id: parsed.id || `zhipu-${Date.now()}`,
                  model: parsed.model,
                  choices: chunk
                    ? [
                        {
                          delta: {
                            role: chunk.delta?.role,
                            content: chunk.delta?.content,
                            reasoning_content: chunk.delta?.reasoning_content,
                            tool_calls: chunk.delta?.tool_calls,
                          },
                          finishReason: chunk.finish_reason || null,
                        },
                      ]
                    : [],
                  usage: parsed.usage
                    ? (() => {
                        const streamReasoningTokens =
                          parsed.usage.completion_tokens_details
                            ?.reasoning_tokens;
                        return {
                          promptTokens: parsed.usage.prompt_tokens || 0,
                          completionTokens: parsed.usage.completion_tokens || 0,
                          totalTokens: parsed.usage.total_tokens || 0,
                          cachedPromptTokens,
                          ...(streamReasoningTokens !== undefined
                            ? { reasoningTokens: streamReasoningTokens }
                            : {}),
                        };
                      })()
                    : undefined,
                };
              } catch (_e) {
                // Ignore malformed SSE chunk
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

  async generateEmbedding(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    const targetModel = this.resolveModel(
      request.model || ZHIPU_MODELS.EMBEDDING_3,
    );
    const baseUrl = this.config.baseUrl || 'https://api.z.ai/api/paas/v4';
    const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const payload: Record<string, unknown> = {
        model: targetModel,
        input: request.input,
      };
      if (request.dimensions !== undefined) {
        payload.dimensions = request.dimensions;
      }

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
          `Zhipu Embedding API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // biome-ignore lint/suspicious/noExplicitAny: Zhipu embeddings response
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
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
