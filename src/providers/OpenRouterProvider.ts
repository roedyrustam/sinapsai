import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import type { Provider } from './Provider.js';

export interface OpenRouterProviderConfig extends ProviderConfig {
  /**
   * Optional site URL sent in the `HTTP-Referer` header for rankings on openrouter.ai.
   */
  siteUrl?: string;

  /**
   * Optional site/app title sent in the `X-Title` header for rankings on openrouter.ai.
   */
  siteName?: string;

  /**
   * Optional ordered list of fallback models sent in OpenRouter's native `models` parameter.
   * If the primary model fails (e.g. rate limit 429, downtime), OpenRouter iterates through these models in order.
   * Ideal for chaining free models (e.g. ['openrouter/free', 'google/gemma-4-31b-it:free']).
   */
  fallbackModels?: string[];

  /**
   * When true, explicitly configures OpenRouter for Free Tier usage:
   * - Sets provider name to 'OpenRouter (Free)' (if name not customized)
   * - Defaults model to 'openrouter/free'
   * - Defaults costPer1kTokens, promptCostPer1k, and completionCostPer1k to 0
   */
  isFreeTier?: boolean;
}

export interface OpenRouterFreeProviderConfig
  extends Omit<
    OpenRouterProviderConfig,
    'costPer1kTokens' | 'promptCostPer1k' | 'completionCostPer1k'
  > {
  /**
   * Optional preferred free model (defaults to 'openrouter/free').
   * Any model ending in ':free' or 'openrouter/free'.
   */
  model?: string;
}

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  pricing?: {
    prompt: string | number;
    completion: string | number;
  };
  supportedParameters?: string[];
  isFree: boolean;
}

/**
 * Curated list of verified OpenRouter free models ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export const OPENROUTER_FREE_MODELS = [
  'openrouter/free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'thinkingmachines/inkling:free',
  'thinkingmachines/inkling-small:free',
  'cohere/north-mini-code:free',
  'liquid/lfm-2.5-2.6b:free',
  'apodex/apodex-1.1-mini:free',
] as const;

/**
 * Checks whether a given model identifier belongs to OpenRouter's free tier.
 */
export function isOpenRouterFreeModel(model: string): boolean {
  if (!model) return false;
  return model === 'openrouter/free' || model.endsWith(':free');
}

export class OpenRouterProvider implements Provider {
  id: string;
  name = 'OpenRouter';
  private config: OpenRouterProviderConfig;

  constructor(config: OpenRouterProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `openrouter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    if (config.isFreeTier) {
      this.name = 'OpenRouter (Free)';
    }
  }

  private isConfiguredModelFree(): boolean {
    const model = this.config.defaultModel;
    return !!model && isOpenRouterFreeModel(model);
  }

  get costPer1kTokens(): number | undefined {
    if (this.config.costPer1kTokens !== undefined) {
      return this.config.costPer1kTokens;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return undefined;
  }

  get promptCostPer1k(): number | undefined {
    if (this.config.promptCostPer1k !== undefined) {
      return this.config.promptCostPer1k;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return undefined;
  }

  get completionCostPer1k(): number | undefined {
    if (this.config.completionCostPer1k !== undefined) {
      return this.config.completionCostPer1k;
    }
    if (this.config.isFreeTier || this.isConfiguredModelFree()) {
      return 0;
    }
    return undefined;
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
    if (this.config.isFreeTier) {
      return 'openrouter/free';
    }
    return model;
  }

  public formatRequest(request: UnifiedApiRequest) {
    const messages = request.messages.map((m) => {
      // biome-ignore lint/suspicious/noExplicitAny: OpenRouter message format
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    const primaryModel = this.resolveModel(request.model);

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: primaryModel,
      messages,
    };

    // Native OpenRouter fallback models array
    const fallbackModels = request.fallbackModels ?? this.config.fallbackModels;
    if (fallbackModels && fallbackModels.length > 0) {
      const distinct = [
        primaryModel,
        ...fallbackModels.filter((m) => m !== primaryModel),
      ];
      payload.models = distinct;
    }

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.stream) {
      payload.stream = true;
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
    return {
      id: data.id || `openrouter-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
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
          }
        : undefined,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://openrouter.ai/api/v1';
    const url = `${baseUrl}/chat/completions`;

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      };
      if (this.config.siteUrl) {
        headers['HTTP-Referer'] = this.config.siteUrl;
      }
      if (this.config.siteName) {
        headers['X-Title'] = this.config.siteName;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `OpenRouter API Error (${response.status}): ${errorText}`,
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
                yield {
                  id: parsed.id || `openrouter-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        tool_calls: chunk?.delta?.tool_calls,
                      },
                      finishReason: chunk?.finish_reason || null,
                    },
                  ],
                };
              } catch (_e) {
                // ignore
              }
            }
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
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
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream && timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Fetches the dynamic list of free models directly from the OpenRouter API.
   * Matches models listed on https://openrouter.ai/models?variant=free ($0 prompt/completion pricing or :free suffix).
   */
  static async fetchFreeModels(options?: {
    apiKey?: string;
    baseUrl?: string;
    signal?: AbortSignal;
  }): Promise<OpenRouterModelInfo[]> {
    const baseUrl = options?.baseUrl || 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> = {};
    if (options?.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch OpenRouter models (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        name: string;
        description?: string;
        context_length?: number;
        pricing?: { prompt?: string | number; completion?: string | number };
        supported_parameters?: string[];
      }>;
    };

    const allModels = data.data || [];
    const freeModels: OpenRouterModelInfo[] = [];

    for (const m of allModels) {
      const isFreePricing =
        m.pricing?.prompt === '0' && m.pricing?.completion === '0';
      const isFreeSuffix = isOpenRouterFreeModel(m.id);

      if (isFreePricing || isFreeSuffix) {
        freeModels.push({
          id: m.id,
          name: m.name,
          description: m.description,
          contextLength: m.context_length,
          pricing: {
            prompt: m.pricing?.prompt ?? '0',
            completion: m.pricing?.completion ?? '0',
          },
          supportedParameters: m.supported_parameters,
          isFree: true,
        });
      }
    }

    return freeModels;
  }
}

/**
 * Factory to create a pre-configured OpenRouter provider optimized for Free Tier models.
 * Automatically defaults model to 'openrouter/free', sets zero token cost, and configures free fallback models.
 */
export function createOpenRouterFreeProvider(
  config?: OpenRouterFreeProviderConfig,
): OpenRouterProvider {
  const model = config?.model || config?.defaultModel || 'openrouter/free';
  const fallbackModels = config?.fallbackModels || [
    'openrouter/free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3.5-lightning:free',
  ];

  const envKey =
    typeof process !== 'undefined' && process.env?.OPENROUTER_API_KEY
      ? process.env.OPENROUTER_API_KEY
      : '';

  return new OpenRouterProvider({
    ...config,
    apiKey: config?.apiKey || envKey,
    defaultModel: model,
    fallbackModels,
    isFreeTier: true,
    costPer1kTokens: 0,
    promptCostPer1k: 0,
    completionCostPer1k: 0,
  });
}
