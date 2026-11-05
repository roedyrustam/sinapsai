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
// Groq Model Metadata
// ---------------------------------------------------------------------------

/**
 * Capabilities supported by a Groq model.
 */
export interface GroqModelCapabilities {
  /** Supports tool / function calling */
  tools: boolean;
  /** Supports JSON mode or json_schema structured output */
  jsonMode: boolean;
  /** Model has reasoning / chain-of-thought capability */
  reasoning: boolean;
  /** Model accepts vision (image) inputs */
  vision: boolean;
  /** Model is an audio transcription / translation model */
  audio: boolean;
}

/**
 * Per-model metadata entry.
 */
export interface GroqModelMeta {
  /** Model ID used in API requests */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum tokens the model can generate in a single completion */
  maxCompletionTokens: number;
  /** Model capabilities */
  capabilities: GroqModelCapabilities;
  /** Pricing per 1 million input tokens (USD). 0 means free tier. */
  inputPricePer1M: number;
  /** Pricing per 1 million output tokens (USD). 0 means free tier. */
  outputPricePer1M: number;
}

/**
 * Comprehensive model catalog aligned with https://console.groq.com/docs/models
 *
 * All context windows, max completion tokens, capabilities, and pricing are
 * sourced from the official Groq documentation (November 2026).
 */
export const GROQ_MODELS: Record<string, GroqModelMeta> = {
  // ── Production Chat Models ──────────────────────────────────────────
  'llama-3.3-70b-versatile': {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    contextWindow: 131_072,
    maxCompletionTokens: 32_768,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.59,
    outputPricePer1M: 0.79,
  },
  'llama-3.1-8b-instant': {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    contextWindow: 131_072,
    maxCompletionTokens: 131_072,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.05,
    outputPricePer1M: 0.08,
  },

  // ── OpenAI Open-Source Models (via Groq) ────────────────────────────
  'openai/gpt-oss-120b': {
    id: 'openai/gpt-oss-120b',
    name: 'OpenAI GPT-OSS 120B',
    contextWindow: 131_072,
    maxCompletionTokens: 65_536,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    name: 'OpenAI GPT-OSS 20B',
    contextWindow: 131_072,
    maxCompletionTokens: 65_536,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },

  // ── Mistral ─────────────────────────────────────────────────────────
  'mistral-saba-24b': {
    id: 'mistral-saba-24b',
    name: 'Mistral Saba 24B',
    contextWindow: 32_768,
    maxCompletionTokens: 32_768,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.79,
    outputPricePer1M: 0.79,
  },

  // ── Preview / Lightweight Models ────────────────────────────────────
  'llama-3.2-1b-preview': {
    id: 'llama-3.2-1b-preview',
    name: 'Llama 3.2 1B Preview',
    contextWindow: 128_000,
    maxCompletionTokens: 8_192,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.04,
    outputPricePer1M: 0.04,
  },
  'llama-3.2-3b-preview': {
    id: 'llama-3.2-3b-preview',
    name: 'Llama 3.2 3B Preview',
    contextWindow: 128_000,
    maxCompletionTokens: 8_192,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.06,
    outputPricePer1M: 0.06,
  },

  // ── Qwen Reasoning Models ──────────────────────────────────────────
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    contextWindow: 131_072,
    maxCompletionTokens: 131_072,
    capabilities: {
      tools: true,
      jsonMode: true,
      reasoning: true,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },

  // ── Safety / Moderation ─────────────────────────────────────────────
  'llama-guard-3-8b': {
    id: 'llama-guard-3-8b',
    name: 'Llama Guard 3 8B',
    contextWindow: 8_192,
    maxCompletionTokens: 8_192,
    capabilities: {
      tools: false,
      jsonMode: false,
      reasoning: false,
      vision: false,
      audio: false,
    },
    inputPricePer1M: 0.2,
    outputPricePer1M: 0.2,
  },

  // ── Audio / Whisper Models ──────────────────────────────────────────
  'whisper-large-v3': {
    id: 'whisper-large-v3',
    name: 'Whisper Large V3',
    contextWindow: 0,
    maxCompletionTokens: 0,
    capabilities: {
      tools: false,
      jsonMode: false,
      reasoning: false,
      vision: false,
      audio: true,
    },
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large V3 Turbo',
    contextWindow: 0,
    maxCompletionTokens: 0,
    capabilities: {
      tools: false,
      jsonMode: false,
      reasoning: false,
      vision: false,
      audio: true,
    },
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
};

/**
 * Set of model IDs that support `reasoning_format` and `reasoning_effort`.
 * When tools or JSON mode are active on these models, `reasoning_format`
 * must be `'parsed'` or `'hidden'` — never `'raw'`.
 */
export const GROQ_REASONING_MODELS = new Set<string>([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
]);

/**
 * Options for the Groq audio transcription / translation API.
 */
export interface GroqAudioOptions {
  /** Model to use. Defaults to `whisper-large-v3-turbo`. */
  model?: string;
  /** Language of the input audio in ISO-639-1 format (e.g. `'en'`). */
  language?: string;
  /** Optional text prompt to guide the model's style or continue a previous segment. */
  prompt?: string;
  /** Sampling temperature between 0 and 1. Defaults to 0. */
  temperature?: number;
  /** Output transcript format. */
  responseFormat?: 'json' | 'text' | 'verbose_json' | 'srt' | 'vtt';
}

/**
 * Response from the Groq audio transcription / translation API.
 */
export interface GroqAudioResponse {
  /** The transcribed or translated text. */
  text: string;
  /** Language detected or specified. */
  language?: string;
  /** Duration of the audio in seconds. */
  duration?: number;
  /** Word-level or segment-level timing data (verbose_json only). */
  // biome-ignore lint/suspicious/noExplicitAny: Groq verbose_json segments vary
  segments?: any[];
}

/**
 * A model entry returned by `GET /v1/models`.
 */
export interface GroqModelListEntry {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class GroqProvider implements Provider {
  id: string;
  name = 'Groq';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `groq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

  /**
   * Get the base URL for the Groq API.
   */
  private get baseUrl(): string {
    return this.config.baseUrl || 'https://api.groq.com/openai/v1';
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    if (!model || model === 'default') {
      return 'llama-3.3-70b-versatile';
    }
    return model;
  }

  /**
   * Look up static model metadata. Returns `undefined` for unknown models.
   */
  public getModelMeta(modelId: string): GroqModelMeta | undefined {
    return GROQ_MODELS[modelId];
  }

  /**
   * Check whether a model ID is a known reasoning model.
   */
  public isReasoningModel(modelId: string): boolean {
    return GROQ_REASONING_MODELS.has(modelId);
  }

  public formatRequest(request: UnifiedApiRequest) {
    const messages = request.messages.map((m) => {
      // biome-ignore lint/suspicious/noExplicitAny: Groq message format
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      // Note: Groq official documentation explicitly states messages[].name
      // is unsupported and causes a 400 error. Name must be omitted.
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    const resolvedModel = this.resolveModel(request.model);

    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: resolvedModel,
      messages,
    };

    // Groq temperature clamp: 0 is converted to 1e-8 per documentation to avoid edge case errors
    if (request.temperature !== undefined) {
      payload.temperature =
        request.temperature === 0 ? 1e-8 : request.temperature;
    }

    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
      // Some Groq reasoning models recommend max_completion_tokens
      payload.max_completion_tokens = request.maxTokens;
    } else {
      // Auto-clamp to the model's max completion tokens if known
      const meta = this.getModelMeta(resolvedModel);
      if (meta && meta.maxCompletionTokens > 0) {
        payload.max_completion_tokens = meta.maxCompletionTokens;
      }
    }

    // ── Reasoning parameters ────────────────────────────────────────
    const isReasoning = this.isReasoningModel(resolvedModel);
    const hasToolsOrJson = !!(request.tools || request.responseFormat);

    if (request.thinkingBudget !== undefined) {
      // Explicit thinking budget → always use parsed format
      payload.reasoning_format = 'parsed';
    } else if (isReasoning && hasToolsOrJson) {
      // Groq requires reasoning_format = 'parsed' or 'hidden' when tools
      // or JSON mode are active on reasoning models. 'raw' causes 400.
      payload.reasoning_format = 'parsed';
    }

    if (request.reasoningEffort !== undefined) {
      payload.reasoning_effort = request.reasoningEffort;
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
    let content = choice?.message?.content ?? null;
    let reasoningContent =
      choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;

    // Handle models outputting raw <think>...</think> in content if not pre-parsed
    if (
      !reasoningContent &&
      typeof content === 'string' &&
      content.includes('<think>')
    ) {
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        reasoningContent = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      }
    }

    return {
      id: data.id || `groq-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content,
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
            cachedPromptTokens:
              data.usage.prompt_tokens_details?.cached_tokens ?? undefined,
          }
        : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // List Models API
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Fetch the list of currently available models from the Groq API.
   *
   * Calls `GET <baseUrl>/models` (OpenAI-compatible endpoint).
   */
  async listModels(signal?: AbortSignal): Promise<GroqModelListEntry[]> {
    const url = `${this.baseUrl}/models`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Groq API Error (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const json = (await response.json()) as {
      data?: GroqModelListEntry[];
    };
    return json.data ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────
  // Audio Transcription & Translation API
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Transcribe audio using Groq's Whisper endpoint.
   *
   * Calls `POST <baseUrl>/audio/transcriptions` with `multipart/form-data`.
   *
   * @param file  Audio file as `Blob`, `Buffer`, or `Uint8Array`.
   * @param options  Transcription options.
   */
  async transcribeAudio(
    file: Blob | Uint8Array,
    options?: GroqAudioOptions,
  ): Promise<GroqAudioResponse> {
    return this.audioRequest('transcriptions', file, options);
  }

  /**
   * Translate audio to English using Groq's Whisper endpoint.
   *
   * Calls `POST <baseUrl>/audio/translations` with `multipart/form-data`.
   *
   * @param file  Audio file as `Blob`, `Buffer`, or `Uint8Array`.
   * @param options  Translation options.
   */
  async translateAudio(
    file: Blob | Uint8Array,
    options?: GroqAudioOptions,
  ): Promise<GroqAudioResponse> {
    return this.audioRequest('translations', file, options);
  }

  /**
   * Internal helper for audio transcription / translation requests.
   */
  private async audioRequest(
    endpoint: 'transcriptions' | 'translations',
    file: Blob | Uint8Array,
    options?: GroqAudioOptions,
  ): Promise<GroqAudioResponse> {
    const url = `${this.baseUrl}/audio/${endpoint}`;

    const formData = new FormData();

    // Convert Uint8Array / Buffer to Blob for FormData compatibility
    let fileBlob: Blob;
    if (file instanceof Blob) {
      fileBlob = file;
    } else {
      // Slice into a fresh ArrayBuffer to satisfy strict TS BlobPart typing
      const buf = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer;
      fileBlob = new Blob([buf], { type: 'audio/mpeg' });
    }
    formData.append('file', fileBlob, 'audio.mp3');

    formData.append('model', options?.model ?? 'whisper-large-v3-turbo');

    if (options?.language) formData.append('language', options.language);
    if (options?.prompt) formData.append('prompt', options.prompt);
    if (options?.temperature !== undefined)
      formData.append('temperature', String(options.temperature));
    if (options?.responseFormat)
      formData.append('response_format', options.responseFormat);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(
        `Groq Audio API Error (${response.status}): ${errorText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return (await response.json()) as GroqAudioResponse;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Chat Completions
  // ─────────────────────────────────────────────────────────────────────

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const url = `${this.baseUrl}/chat/completions`;

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
          `Groq API Error (${response.status}): ${errorText}`,
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
                      undefined,
                  };
                }
                yield {
                  id: parsed.id || `groq-${Date.now()}`,
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
}
