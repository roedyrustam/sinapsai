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

export const QWEN_MODELS = {
  // Flagship & Frontier
  QWEN_3_MAX: 'qwen3-max',
  QWEN_3_PLUS: 'qwen3-plus',
  QWEN_3_TURBO: 'qwen3-turbo',
  QWEN_3_FLASH: 'qwen3-flash',

  // Deep Reasoning & Thinking
  QWQ_PLUS: 'qwq-plus',
  QWQ_32B: 'qwq-32b',
  QWQ_32B_PREVIEW: 'qwq-32b-preview',

  // Qwen 2.5 Generation
  QWEN_2_5_MAX: 'qwen-2.5-max',
  QWEN_2_5_PLUS: 'qwen-2.5-plus',
  QWEN_2_5_TURBO: 'qwen-2.5-turbo',
  QWEN_MAX: 'qwen-max',
  QWEN_PLUS: 'qwen-plus',
  QWEN_TURBO: 'qwen-turbo',

  // Specialized Coder & Vision
  QWEN_2_5_CODER_32B: 'qwen-2.5-coder-32b-instruct',
  QWEN_2_5_CODER_7B: 'qwen-2.5-coder-7b-instruct',
  QWEN_VL_MAX: 'qwen-vl-max',
  QWEN_2_5_VL_72B: 'qwen2.5-vl-72b-instruct',
  QWEN_2_5_VL_7B: 'qwen2.5-vl-7b-instruct',

  // Embeddings
  TEXT_EMBEDDING_V3: 'text-embedding-v3',
  TEXT_EMBEDDING_V2: 'text-embedding-v2',
} as const;

export const QWEN_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  'qwen3-max': ['qwen3-plus', 'qwen-2.5-max'],
  'qwen3-plus': ['qwen3-turbo', 'qwen-2.5-plus'],
  'qwq-plus': ['qwq-32b', 'qwen3-max'],
  'qwen-2.5-max': ['qwen-2.5-plus', 'qwen-plus'],
  'qwen-vl-max': ['qwen2.5-vl-72b-instruct'],
};

export const QWEN_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'qwen3-max': { promptCostPer1k: 0.0016, completionCostPer1k: 0.0064 },
  'qwen3-plus': { promptCostPer1k: 0.0004, completionCostPer1k: 0.0012 },
  'qwen3-turbo': { promptCostPer1k: 0.00005, completionCostPer1k: 0.0002 },
  'qwen3-flash': { promptCostPer1k: 0.00005, completionCostPer1k: 0.0002 },
  'qwq-plus': { promptCostPer1k: 0.0008, completionCostPer1k: 0.0032 },
  'qwq-32b': { promptCostPer1k: 0.0005, completionCostPer1k: 0.002 },
  'qwq-32b-preview': { promptCostPer1k: 0.0005, completionCostPer1k: 0.002 },
  'qwen-2.5-max': { promptCostPer1k: 0.0016, completionCostPer1k: 0.0064 },
  'qwen-2.5-plus': { promptCostPer1k: 0.0004, completionCostPer1k: 0.0012 },
  'qwen-2.5-turbo': { promptCostPer1k: 0.00005, completionCostPer1k: 0.0002 },
  'qwen-max': { promptCostPer1k: 0.0016, completionCostPer1k: 0.0064 },
  'qwen-plus': { promptCostPer1k: 0.0004, completionCostPer1k: 0.0012 },
  'qwen-turbo': { promptCostPer1k: 0.00005, completionCostPer1k: 0.0002 },
  'qwen-2.5-coder-32b-instruct': {
    promptCostPer1k: 0.0005,
    completionCostPer1k: 0.002,
  },
  'qwen-2.5-coder-7b-instruct': {
    promptCostPer1k: 0.0001,
    completionCostPer1k: 0.0004,
  },
  'qwen-vl-max': { promptCostPer1k: 0.0016, completionCostPer1k: 0.0064 },
  'qwen2.5-vl-72b-instruct': {
    promptCostPer1k: 0.0012,
    completionCostPer1k: 0.0048,
  },
  'qwen2.5-vl-7b-instruct': {
    promptCostPer1k: 0.0002,
    completionCostPer1k: 0.0008,
  },
  'text-embedding-v3': { promptCostPer1k: 0.00005, completionCostPer1k: 0 },
  'text-embedding-v2': { promptCostPer1k: 0.00005, completionCostPer1k: 0 },
};

/**
 * Native Alibaba Qwen (Tongyi Qianwen / DashScope) Provider.
 *
 * Fully compatible with DashScope OpenAI-compatible endpoints:
 * - Default International: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * - Domestic China: https://dashscope.aliyuncs.com/compatible-mode/v1
 * - Custom self-hosted / vLLM / Ollama Qwen deployments
 */
export class QwenProvider implements Provider {
  id: string;
  name = 'Qwen';
  private config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `qwen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
      // Handle multimodal and text content parts
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

      // biome-ignore lint/suspicious/noExplicitAny: Qwen OpenAI-compatible message structure
      const msg: any = {
        role: m.role,
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

    // biome-ignore lint/suspicious/noExplicitAny: Qwen OpenAI-compatible payload
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
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: response format from DashScope OpenAI-compatible API
  public formatResponse(data: any): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const cachedPromptTokens =
      data.usage?.prompt_cache_hit_tokens ??
      data.usage?.prompt_tokens_details?.cached_tokens ??
      undefined;

    return {
      id: data.id || `qwen-${Date.now()}`,
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
    const baseUrl =
      this.config.baseUrl ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
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
          `Qwen API Error (${response.status}): ${errorText}`,
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
                  parsed.usage?.prompt_cache_hit_tokens ??
                  parsed.usage?.prompt_tokens_details?.cached_tokens ??
                  undefined;

                yield {
                  id: parsed.id || `qwen-${Date.now()}`,
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
                // Ignore malformed SSE chunk or comments
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
      request.model || QWEN_MODELS.TEXT_EMBEDDING_V3,
    );
    const baseUrl =
      this.config.baseUrl ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
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
          `Qwen Embedding API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // biome-ignore lint/suspicious/noExplicitAny: Qwen embeddings response
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
