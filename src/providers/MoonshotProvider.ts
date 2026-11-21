/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import type { Provider } from './Provider.js';

export const MOONSHOT_MODELS = {
  // Kimi K2 Frontier Generation
  KIMI_K2_THINKING: 'kimi-k2-thinking',
  KIMI_K2_0905_PREVIEW: 'kimi-k2-0905-preview',
  KIMI_K2_TURBO_PREVIEW: 'kimi-k2-turbo-preview',
  KIMI_LATEST: 'kimi-latest',

  // Moonshot v1 Long-Context Series
  MOONSHOT_V1_128K: 'moonshot-v1-128k',
  MOONSHOT_V1_32K: 'moonshot-v1-32k',
  MOONSHOT_V1_8K: 'moonshot-v1-8k',
  MOONSHOT_V1_AUTO: 'moonshot-v1-auto',
} as const;

export const MOONSHOT_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  'kimi-k2-thinking': ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
  'kimi-k2-0905-preview': ['kimi-k2-turbo-preview', 'kimi-latest'],
  'kimi-k2-turbo-preview': ['kimi-latest', 'moonshot-v1-128k'],
};

export const MOONSHOT_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'kimi-k2-thinking': { promptCostPer1k: 0.0006, completionCostPer1k: 0.0025 },
  'kimi-k2-0905-preview': {
    promptCostPer1k: 0.0006,
    completionCostPer1k: 0.0025,
  },
  'kimi-k2-turbo-preview': {
    promptCostPer1k: 0.00115,
    completionCostPer1k: 0.008,
  },
  'kimi-latest': { promptCostPer1k: 0.0006, completionCostPer1k: 0.0025 },
  'moonshot-v1-128k': { promptCostPer1k: 0.002, completionCostPer1k: 0.005 },
  'moonshot-v1-32k': { promptCostPer1k: 0.001, completionCostPer1k: 0.003 },
  'moonshot-v1-8k': { promptCostPer1k: 0.0002, completionCostPer1k: 0.002 },
  'moonshot-v1-auto': { promptCostPer1k: 0.0006, completionCostPer1k: 0.0025 },
};

export interface MoonshotProviderConfig extends ProviderConfig {
  /**
   * Enables Moonshot's built-in `$web_search` function tool by default.
   * Can be overridden per request via `webSearch`.
   */
  enableWebSearch?: boolean;
}

/**
 * Native Moonshot AI (Kimi K2 / Kimi K2 Thinking) Provider.
 *
 * Compatible with Moonshot OpenAI-compatible API endpoints:
 * - Default Global: https://api.moonshot.ai/v1
 * - China Domestic: https://api.moonshot.cn/v1
 */
export class MoonshotProvider implements Provider {
  id: string;
  name = 'Moonshot';
  private config: MoonshotProviderConfig;

  constructor(config: MoonshotProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `moonshot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

      // biome-ignore lint/suspicious/noExplicitAny: Moonshot OpenAI-compatible message format
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

    // biome-ignore lint/suspicious/noExplicitAny: Moonshot request payload
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

    // biome-ignore lint/suspicious/noExplicitAny: tools may include builtin_function
    const tools: any[] = request.tools ? [...request.tools] : [];
    if (request.webSearch ?? this.config.enableWebSearch) {
      const hasWebSearch = tools.some(
        (t) =>
          t.type === 'builtin_function' && t.function?.name === '$web_search',
      );
      if (!hasWebSearch) {
        tools.push({
          type: 'builtin_function',
          function: { name: '$web_search' },
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

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Moonshot response format
  public formatResponse(data: any): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const cachedPromptTokens =
      data.usage?.cached_tokens ??
      data.usage?.prompt_tokens_details?.cached_tokens ??
      undefined;

    return {
      id: data.id || `moonshot-${Date.now()}`,
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
    const baseUrl = this.config.baseUrl || 'https://api.moonshot.ai/v1';
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
          `Moonshot API Error (${response.status}): ${errorText}`,
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
                const usageObj = parsed.usage ?? chunk?.usage;
                const cachedPromptTokens =
                  usageObj?.cached_tokens ??
                  usageObj?.prompt_tokens_details?.cached_tokens ??
                  undefined;

                yield {
                  id: parsed.id || `moonshot-${Date.now()}`,
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
                  usage: usageObj
                    ? (() => {
                        const streamReasoningTokens =
                          usageObj.completion_tokens_details?.reasoning_tokens;
                        return {
                          promptTokens: usageObj.prompt_tokens || 0,
                          completionTokens: usageObj.completion_tokens || 0,
                          totalTokens: usageObj.total_tokens || 0,
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
}
