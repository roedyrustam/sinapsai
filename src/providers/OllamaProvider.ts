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
import { linkAbortSignal } from '../utils/signal.js';
import type { Provider } from './Provider.js';

export class OllamaProvider implements Provider {
  id: string;
  name = 'Ollama';
  private config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `ollama-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens ?? 0;
  }

  get promptCostPer1k(): number | undefined {
    return this.config.promptCostPer1k ?? 0;
  }

  get completionCostPer1k(): number | undefined {
    return this.config.completionCostPer1k ?? 0;
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
      // biome-ignore lint/suspicious/noExplicitAny: Ollama message format
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
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

  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const promptTokens =
      data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
    const completionTokens =
      data.usage?.completion_tokens ?? data.eval_count ?? 0;
    const totalTokens =
      data.usage?.total_tokens ?? promptTokens + completionTokens;
    const reasoningContent =
      choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? null;

    return {
      id: data.id || `ollama-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls,
          },
          finishReason: choice?.finish_reason || 'stop',
        },
      ],
      usage:
        promptTokens || completionTokens
          ? {
              promptTokens,
              completionTokens,
              totalTokens,
            }
          : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const rawBaseUrl = (
      this.config.baseUrl || 'http://localhost:11434'
    ).replace(/\/+$/, '');
    const baseUrl = rawBaseUrl.endsWith('/v1')
      ? rawBaseUrl
      : `${rawBaseUrl}/v1`;
    const url = `${baseUrl}/chat/completions`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Ollama API Error (${response.status}): ${errorText}`,
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
                let chunkUsage: UnifiedApiStreamChunk['usage'] | undefined;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                  };
                } else if (
                  parsed.prompt_eval_count !== undefined ||
                  parsed.eval_count !== undefined
                ) {
                  const promptTokens = parsed.prompt_eval_count || 0;
                  const completionTokens = parsed.eval_count || 0;
                  chunkUsage = {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                  };
                }

                yield {
                  id: parsed.id || `ollama-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content:
                          chunk?.delta?.reasoning_content ??
                          chunk?.delta?.reasoning ??
                          null,
                        tool_calls: chunk?.delta?.tool_calls,
                      },
                      finishReason: chunk?.finish_reason || null,
                    },
                  ],
                  usage: chunkUsage,
                };
              } catch (_e) {
                // ignore
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
      return this.formatResponse(data);
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
    const targetModel = this.resolveModel(request.model);
    const rawBaseUrl = (
      this.config.baseUrl || 'http://localhost:11434'
    ).replace(/\/+$/, '');
    const baseUrl = rawBaseUrl.endsWith('/v1')
      ? rawBaseUrl
      : `${rawBaseUrl}/v1`;
    const url = `${baseUrl}/embeddings`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: targetModel,
          input: request.input,
          ...(request.user ? { user: request.user } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Ollama Embeddings API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // biome-ignore lint/suspicious/noExplicitAny: Ollama embeddings response
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
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens || 0,
              totalTokens: data.usage.total_tokens || 0,
            }
          : undefined,
      };
    } finally {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
