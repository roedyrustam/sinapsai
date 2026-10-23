/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { GeminiAgentBooster } from '../core/GeminiAgentBooster.js';
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
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const XAI_MODELS = {
  GROK_3: 'grok-3-beta',
  GROK_3_FAST: 'grok-3-fast-beta',
  GROK_3_MINI: 'grok-3-mini-beta',
  GROK_3_MINI_FAST: 'grok-3-mini-fast-beta',
  GROK_2_VISION: 'grok-2-vision-1212',
} as const;

export class XAiProvider implements Provider {
  id: string;
  name = 'xAI';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `xai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === 'default') {
      return XAI_MODELS.GROK_3;
    }
    return model;
  }

  public formatRequest(request: UnifiedApiRequest) {
    const targetModel = this.resolveModel(request.model);
    const messages = request.messages.map((m) => {
      // biome-ignore lint/suspicious/noExplicitAny: xAI message payload
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    // biome-ignore lint/suspicious/noExplicitAny: xAI request payload
    const payload: any = {
      model: targetModel,
      messages,
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }
    const resolvedThinkingBudget =
      request.thinkingBudget === 'auto'
        ? GeminiAgentBooster.computeDynamicThinkingBudget(request)
        : request.thinkingBudget;
    if (request.reasoningEffort) {
      payload.reasoning_effort =
        request.reasoningEffort === 'medium' ? 'high' : request.reasoningEffort;
    } else if (resolvedThinkingBudget && resolvedThinkingBudget > 0) {
      payload.reasoning_effort =
        resolvedThinkingBudget >= 2048 ? 'high' : 'low';
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
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: xAI response payload
  public formatResponse(data: any): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const cachedPromptTokens =
      data.usage?.prompt_tokens_details?.cached_tokens ?? undefined;

    return {
      id: data.id || `xai-${Date.now()}`,
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
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
            cachedPromptTokens,
          }
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.x.ai/v1';
    const url = `${baseUrl}/chat/completions`;

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
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `xAI API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                const cachedPromptTokens =
                  parsed.usage?.prompt_tokens_details?.cached_tokens ??
                  undefined;

                yield {
                  id: parsed.id || `xai-${Date.now()}`,
                  model: parsed.model || payload.model,
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
                    ? {
                        promptTokens: parsed.usage.prompt_tokens || 0,
                        completionTokens: parsed.usage.completion_tokens || 0,
                        totalTokens: parsed.usage.total_tokens || 0,
                        cachedPromptTokens,
                      }
                    : undefined,
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
    const baseUrl = this.config.baseUrl || 'https://api.x.ai/v1';
    const url = `${baseUrl}/embeddings`;

    // biome-ignore lint/suspicious/noExplicitAny: embedding payload
    const payload: any = {
      model: request.model || 'v1',
      input: request.input,
    };
    if (request.dimensions) {
      payload.dimensions = request.dimensions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey || ''}`,
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `xAI Embedding API Error (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    // biome-ignore lint/suspicious/noExplicitAny: response json
    const data = (await response.json()) as any;
    return {
      object: 'list',
      data: (data.data || []).map(
        // biome-ignore lint/suspicious/noExplicitAny: embedding item
        (item: any, idx: number) => ({
          index: item.index ?? idx,
          embedding: item.embedding || [],
          object: 'embedding' as const,
        }),
      ),
      model: data.model || payload.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
    };
  }
}
