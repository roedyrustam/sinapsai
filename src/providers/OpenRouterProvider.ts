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

// ---------------------------------------------------------------------------
// OpenRouter Provider Preferences & Config
// ---------------------------------------------------------------------------

/**
 * OpenRouter native provider routing controls.
 * @see https://openrouter.ai/docs/features/provider-routing
 */
export interface OpenRouterProviderPreferences {
  /** Prioritized list of provider slugs (e.g. ['together', 'deepinfra']) */
  order?: string[];
  /** Whether OpenRouter can route to backup providers on rate limit/outage (default: true) */
  allow_fallbacks?: boolean;
  /** Filter to providers supporting all request parameters */
  require_parameters?: boolean;
  /** Data collection preference ('allow' or 'deny') */
  data_collection?: 'allow' | 'deny';
  /** List of provider slugs to ignore / exclude */
  ignore?: string[];
  /** Allowed quantizations, e.g. ['int4', 'int8', 'fp8', 'fp16'] */
  quantizations?: string[];
  /** Strategy for sorting providers: 'price', 'throughput', or 'latency' */
  sort?: 'price' | 'throughput' | 'latency';
}

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

  /**
   * When true, strictly restricts all primary and fallback models to verified zero-cost models (:free or openrouter/free).
   * Any non-free models in fallback lists are automatically stripped to guarantee $0 cost and prevent accidental billing.
   */
  strictFree?: boolean;

  /**
   * Optional native OpenRouter provider routing preferences.
   */
  providerPreferences?: OpenRouterProviderPreferences;

  /**
   * Optional prompt transforms (e.g. ['middle-out'] for context window compression).
   */
  transforms?: string[];
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

// ---------------------------------------------------------------------------
// OpenRouter Free Models Catalog
// ---------------------------------------------------------------------------

/**
 * Metadata for a verified free tier model on OpenRouter.
 */
export interface OpenRouterFreeModelMeta {
  id: string;
  name: string;
  developer: string;
  contextLength: number;
  capabilities: {
    tools: boolean;
    jsonMode: boolean;
    reasoning: boolean;
    vision: boolean;
  };
  description: string;
}

/**
 * Curated catalog of verified OpenRouter free tier models ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export const OPENROUTER_FREE_MODEL_CATALOG: Record<
  string,
  OpenRouterFreeModelMeta
> = {
  'openrouter/free': {
    id: 'openrouter/free',
    name: 'Free Models Router',
    developer: 'OpenRouter',
    contextLength: 200_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: true,
    },
    description:
      'Dynamic meta-router that automatically selects a free model at random with smart filtering for required features (tools, vision, JSON).',
  },
  'google/gemma-4-31b-it:free': {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google: Gemma 4 31B (free)',
    developer: 'Google',
    contextLength: 262_144,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: true,
    },
    description:
      'Google DeepMind 30.7B dense multimodal instruction model supporting text and vision.',
  },
  'google/gemma-4-26b-a4b-it:free': {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Google: Gemma 4 26B A4B (free)',
    developer: 'Google',
    contextLength: 262_144,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Google instruction-tuned Mixture-of-Experts (MoE) model for efficient reasoning and text generation.',
  },
  'nvidia/nemotron-3.5-super-vl:free': {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA: Nemotron 3.5 Super VL (free)',
    developer: 'NVIDIA',
    contextLength: 1_000_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: true,
    },
    description:
      'NVIDIA open multimodal mixture-of-experts model with massive 1M context window and vision.',
  },
  'nvidia/nemotron-3.5-lightning:free': {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA: Nemotron 3.5 Lightning (free)',
    developer: 'NVIDIA',
    contextLength: 1_000_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'NVIDIA open mixture-of-experts model optimized for ultra-high throughput and 1M context.',
  },
  'nvidia/nemotron-3-ultra-550b-a55b:free': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA: Nemotron 3 Ultra (free)',
    developer: 'NVIDIA',
    contextLength: 1_000_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: false,
    },
    description:
      'NVIDIA flagship 550B MoE frontier reasoning and multi-step agent orchestration model.',
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA: Nemotron 3 Nano Omni (free)',
    developer: 'NVIDIA',
    contextLength: 256_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: true,
    },
    description:
      'NVIDIA 30B-A3B open multimodal reasoning model with audio, vision, and text support.',
  },
  'nvidia/nemotron-3.5-content-safety:free': {
    id: 'nvidia/nemotron-3.5-content-safety:free',
    name: 'NVIDIA: Nemotron 3.5 Content Safety (free)',
    developer: 'NVIDIA',
    contextLength: 128_000,
    capabilities: {
      tools: false,
      jsonMode: false,
      reasoning: false,
      vision: false,
    },
    description:
      'NVIDIA compact 4B-parameter multimodal guardrail and safety evaluation model.',
  },
  'cohere/north-mini-code:free': {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere: North Mini Code (free)',
    developer: 'Cohere',
    contextLength: 256_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: false,
    },
    description:
      'Cohere first agentic coding model optimized for code generation, refactoring, and tool use.',
  },
  'liquid/lfm-2.5-2.6b:free': {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'LiquidAI: LFM2.5-2.6B (free)',
    developer: 'Liquid AI',
    contextLength: 65_536,
    capabilities: {
      tools: false,
      jsonMode: true,
      reasoning: true,
      vision: false,
    },
    description:
      'Liquid AI compact computational model optimized for on-device and efficient reasoning.',
  },
  'dots-studio/dots-3-note-preview:free': {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots Studio: Dots3-Note Preview (free)',
    developer: 'Dots Studio',
    contextLength: 512_000,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Dots Studio open-weight mixture-of-experts model with 512K context window for long-context notes.',
  },
  'recursive/flint-v1.0:free': {
    id: 'recursive/flint-v1.0:free',
    name: 'Recursive: Flint (free)',
    developer: 'Recursive',
    contextLength: 262_144,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Recursive open-weight mixture-of-experts model for versatile instruction following.',
  },
  'xingchen-agi/xing4.0-29b-a4b:free': {
    id: 'xingchen-agi/xing4.0-29b-a4b:free',
    name: 'XingChen: Xing4.0 29B A4B (free)',
    developer: 'China Telecom XingChen',
    contextLength: 262_144,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Open-weight MoE language model trained on multilingual and high-density technical corpora.',
  },
  'meta-llama/llama-3.3-70b-instruct:free': {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Meta: Llama 3.3 70B Instruct (free)',
    developer: 'Meta',
    contextLength: 131_072,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Meta flagship open-weight 70B instruction model with state-of-the-art coding and dialogue performance.',
  },
  'meta-llama/llama-3.1-8b-instruct:free': {
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    name: 'Meta: Llama 3.1 8B Instruct (free)',
    developer: 'Meta',
    contextLength: 131_072,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Meta lightweight 8B instruction-tuned model with 128K context window.',
  },
  'meta-llama/llama-3.2-3b-instruct:free': {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Meta: Llama 3.2 3B Instruct (free)',
    developer: 'Meta',
    contextLength: 131_072,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Meta ultra-fast 3B model designed for high-throughput zero-cost edge tasks.',
  },
  'deepseek/deepseek-r1:free': {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek: R1 (free)',
    developer: 'DeepSeek',
    contextLength: 163_840,
    capabilities: {
      tools: false,
      jsonMode: true,
      reasoning: true,
      vision: false,
    },
    description:
      'DeepSeek flagship reasoning model with verifiable step-by-step thinking traces.',
  },
  'deepseek/deepseek-chat:free': {
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek: DeepSeek V3 (free)',
    developer: 'DeepSeek',
    contextLength: 65_536,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'DeepSeek V3 671B MoE model delivering frontier conversational quality.',
  },
  'qwen/qwen-2.5-coder-32b-instruct:free': {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen: Qwen 2.5 Coder 32B Instruct (free)',
    developer: 'Alibaba Cloud',
    contextLength: 32_768,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Alibaba Cloud specialized 32B code generation and debugging model.',
  },
  'mistralai/mistral-7b-instruct:free': {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral: Mistral 7B Instruct (free)',
    developer: 'Mistral AI',
    contextLength: 32_768,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
    },
    description:
      'Mistral AI classic 7B dense model known for concise and fast instruction following.',
  },
};

/**
 * Curated list of verified OpenRouter free model IDs ($0 pricing / :free variant).
 * Reference: https://openrouter.ai/models?variant=free
 */
export const OPENROUTER_FREE_MODELS = [
  'openrouter/free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'cohere/north-mini-code:free',
  'liquid/lfm-2.5-2.6b:free',
  'dots-studio/dots-3-note-preview:free',
  'recursive/flint-v1.0:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'deepseek/deepseek-r1:free',
  'deepseek/deepseek-chat:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
] as const;

/**
 * Recommended default fallback chain across verified high-availability free tier models.
 * Automatically rotates to another zero-cost model if one hits rate limits (429) or downtime (503).
 */
export const OPENROUTER_DEFAULT_FREE_FALLBACKS: readonly string[] = [
  'openrouter/free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

/**
 * Checks whether a given model identifier belongs to OpenRouter's free tier.
 */
export function isOpenRouterFreeModel(model: string): boolean {
  if (!model) return false;
  return model === 'openrouter/free' || model.endsWith(':free');
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class OpenRouterProvider implements Provider {
  id: string;
  name = 'OpenRouter';
  private config: OpenRouterProviderConfig;

  constructor(config: OpenRouterProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `openrouter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    if (config.isFreeTier || config.strictFree) {
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
    if (
      this.config.isFreeTier ||
      this.config.strictFree ||
      this.isConfiguredModelFree()
    ) {
      return 0;
    }
    return undefined;
  }

  get promptCostPer1k(): number | undefined {
    if (this.config.promptCostPer1k !== undefined) {
      return this.config.promptCostPer1k;
    }
    if (
      this.config.isFreeTier ||
      this.config.strictFree ||
      this.isConfiguredModelFree()
    ) {
      return 0;
    }
    return undefined;
  }

  get completionCostPer1k(): number | undefined {
    if (this.config.completionCostPer1k !== undefined) {
      return this.config.completionCostPer1k;
    }
    if (
      this.config.isFreeTier ||
      this.config.strictFree ||
      this.isConfiguredModelFree()
    ) {
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
    if (this.config.isFreeTier || this.config.strictFree) {
      return 'openrouter/free';
    }
    if (!model || model === 'default') {
      return 'openrouter/free';
    }
    return model;
  }

  /**
   * Look up static metadata for a free model in the catalog.
   */
  public getFreeModelMeta(
    modelId: string,
  ): OpenRouterFreeModelMeta | undefined {
    return OPENROUTER_FREE_MODEL_CATALOG[modelId];
  }

  /**
   * Check whether a model ID is a free tier model.
   */
  public isFreeModel(modelId: string): boolean {
    return isOpenRouterFreeModel(modelId);
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

    let primaryModel = this.resolveModel(request.model);

    // If strictFree is active, ensure primary model is free
    if (this.config.strictFree && !isOpenRouterFreeModel(primaryModel)) {
      primaryModel = 'openrouter/free';
    }

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: primaryModel,
      messages,
    };

    // Native OpenRouter fallback models array
    const configuredFallbacks =
      request.fallbackModels ?? this.config.fallbackModels;

    let effectiveFallbacks: string[] | undefined;
    if (configuredFallbacks && configuredFallbacks.length > 0) {
      if (this.config.strictFree || this.config.isFreeTier) {
        // Enforce strict zero-cost rule: strip any non-free model from the fallback list
        // to prevent OpenRouter from automatically billing paid models on failover.
        effectiveFallbacks = configuredFallbacks.filter(isOpenRouterFreeModel);
      } else {
        effectiveFallbacks = configuredFallbacks;
      }
    } else if (this.config.isFreeTier || this.config.strictFree) {
      // If free tier and no fallbacks provided, supply safe default free fallbacks
      effectiveFallbacks = OPENROUTER_DEFAULT_FREE_FALLBACKS.filter(
        (m) => m !== primaryModel,
      );
    }

    if (effectiveFallbacks && effectiveFallbacks.length > 0) {
      const distinct = [
        primaryModel,
        ...effectiveFallbacks.filter((m) => m !== primaryModel),
      ];
      payload.models = distinct;
    }

    // Provider routing controls
    if (this.config.providerPreferences) {
      payload.provider = this.config.providerPreferences;
    }

    // Prompt transforms (e.g. middle-out context compression)
    if (this.config.transforms && this.config.transforms.length > 0) {
      payload.transforms = this.config.transforms;
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
    const reasoningContent =
      choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;

    const cachedPromptTokens =
      data.usage?.prompt_tokens_details?.cached_tokens ??
      data.usage?.prompt_cache_hit_tokens ??
      (data.usage?.cache_discount
        ? Math.round(
            (data.usage.prompt_tokens || 0) * data.usage.cache_discount,
          )
        : undefined);

    return {
      id: data.id || `openrouter-${Date.now()}`,
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
    const baseUrl = this.config.baseUrl || 'https://openrouter.ai/api/v1';
    const url = `${baseUrl}/chat/completions`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }
    const cleanupSignal = linkAbortSignal(controller, request.signal);

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
                let chunkUsage: UnifiedApiStreamChunk['usage'] | undefined;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens:
                      parsed.usage.prompt_tokens_details?.cached_tokens ??
                      parsed.usage.prompt_cache_hit_tokens ??
                      undefined,
                  };
                }
                yield {
                  id: parsed.id || `openrouter-${Date.now()}`,
                  model: parsed.model,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content:
                          chunk?.delta?.reasoning ??
                          chunk?.delta?.reasoning_content ??
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

  /**
   * Fetches the dynamic list of free models directly from the OpenRouter API.
   * Matches models listed on https://openrouter.ai/models?variant=free ($0 prompt/completion pricing or :free suffix).
   */
  async listFreeModels(signal?: AbortSignal): Promise<OpenRouterModelInfo[]> {
    return OpenRouterProvider.fetchFreeModels({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      signal,
    });
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
 * Automatically defaults model to 'openrouter/free', sets zero token cost, enables strictFree billing protection,
 * and configures high-availability free fallback models.
 */
export function createOpenRouterFreeProvider(
  config?: OpenRouterFreeProviderConfig,
): OpenRouterProvider {
  const model = config?.model || config?.defaultModel || 'openrouter/free';
  const fallbackModels = config?.fallbackModels || [
    ...OPENROUTER_DEFAULT_FREE_FALLBACKS,
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
    strictFree: true,
    costPer1kTokens: 0,
    promptCostPer1k: 0,
    completionCostPer1k: 0,
  });
}
