/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type {
  BatchOptions,
  BatchResult,
  ChatMessage,
  CircuitBreakerStatus,
  CreateChatCompletionRequest,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  SinapsEventHooks,
  SinapsMetrics,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { executeBatch } from './BatchExecutor.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { type CacheOptions, Router, type RouterStrategy } from './Router.js';
import type { StateStorage } from './StateStorage.js';
import {
  accumulateStream,
  type StreamAccumulatorOptions,
} from '../utils/streamAccumulator.js';
import {
  extractJsonFromText,
  tryExtractJson,
} from '../utils/structuredOutput.js';

export interface ExtendedPIIGuardrailsOptions extends PIIGuardrailsOptions {
  /**
   * When true, applies reversible tokenization to outgoing messages and
   * automatically restores the original PII values into the non-streaming LLM response.
   * Default: false
   */
  reversible?: boolean;
}

export interface SinapsClientOptions {
  providers: Provider[];
  strategy?: RouterStrategy;
  storage?: StateStorage;
  circuitBreaker?: CircuitBreakerOptions;
  hooks?: SinapsEventHooks;
  fallbackModels?: string[];
  retries?: number;
  retryDelayMs?: number;
  cache?: CacheOptions;
  /**
   * Optional PII guardrails configuration.
   * When enabled, automatically redacts or tokenizes personally identifiable information
   * (email, phone, credit card, SSN, IP) from all outgoing messages before
   * they are sent to LLM providers.
   */
  piiGuardrails?: ExtendedPIIGuardrailsOptions | boolean;
}

export class SinapsClient {
  private router: Router;
  private storage: StateStorage;
  public readonly guardrails?: PIIGuardrails;
  private isReversiblePII = false;

  constructor(options: SinapsClientOptions) {
    this.storage = options.storage || new InMemoryStorage();

    // Initialize PII guardrails if configured
    if (options.piiGuardrails) {
      if (options.piiGuardrails === true) {
        this.guardrails = new PIIGuardrails();
      } else {
        this.guardrails = new PIIGuardrails(options.piiGuardrails);
        this.isReversiblePII = options.piiGuardrails.reversible === true;
      }
    }
    const cb = new CircuitBreaker(this.storage, {
      ...options.circuitBreaker,
      onCircuitOpen: (providerId: string) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitOpen?.(provider);
        }
      },
      onCircuitClose: (providerId: string) => {
        const provider = this.router?.getProviderById(providerId);
        if (provider) {
          options.hooks?.onCircuitClose?.(provider);
        }
      },
    });
    this.router = new Router(options.providers, cb, {
      strategy: options.strategy,
      hooks: options.hooks,
      fallbackModels: options.fallbackModels,
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
      cache: options.cache,
      storage: this.storage,
    });
  }

  public readonly chat = {
    completions: {
      create: (async (
        request: CreateChatCompletionRequest,
      ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> => {
        let messages: ChatMessage[] = request.messages;
        let piiVault: Map<string, string> | undefined;

        // Apply PII redaction or reversible tokenization if guardrails are enabled
        if (this.guardrails) {
          if (this.isReversiblePII && !request.stream) {
            const tokenized = this.guardrails.tokenizeMessages(request.messages);
            messages = tokenized.messages;
            piiVault = tokenized.vault;
          } else {
            messages = this.guardrails.redactMessages(request.messages);
          }
        }

        const fullReq: UnifiedApiRequest = {
          model: request.model || 'default',
          messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools: request.tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
          fallbackModels: request.fallbackModels,
          thinkingBudget: request.thinkingBudget,
          reasoningEffort: request.reasoningEffort,
        };

        const res = await this.router.execute(fullReq);

        // Reversibly restore PII values if vault contains tokens
        if (
          this.guardrails &&
          piiVault &&
          piiVault.size > 0 &&
          !request.stream &&
          'choices' in (res as UnifiedApiResponse)
        ) {
          return this.guardrails.restoreResponse(
            res as UnifiedApiResponse,
            piiVault,
          );
        }

        return res;
      }) as {
        (
          request: CreateChatCompletionRequestStreaming,
        ): Promise<AsyncIterable<UnifiedApiStreamChunk>>;
        (
          request: CreateChatCompletionRequestNonStreaming,
        ): Promise<UnifiedApiResponse>;
        (
          request: CreateChatCompletionRequest,
        ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
      },

      /**
       * Accumulates a streaming response into a complete UnifiedApiResponse.
       */
      accumulateStream: async (
        stream: AsyncIterable<UnifiedApiStreamChunk>,
        options?: StreamAccumulatorOptions,
      ): Promise<UnifiedApiResponse> => {
        return accumulateStream(stream, options);
      },

      /**
       * Safely extracts and parses JSON data from a response or text string.
       */
      extractJson: <T = unknown>(
        textOrResponse: string | UnifiedApiResponse,
      ): T => {
        if (typeof textOrResponse === 'string') {
          return extractJsonFromText<T>(textOrResponse);
        }
        const text = textOrResponse.choices?.[0]?.message?.content || '';
        return extractJsonFromText<T>(text);
      },
    },
  };

  /**
   * Helper to accumulate streaming chunks into a single UnifiedApiResponse.
   */
  public async accumulateStream(
    stream: AsyncIterable<UnifiedApiStreamChunk>,
    options?: StreamAccumulatorOptions,
  ): Promise<UnifiedApiResponse> {
    return accumulateStream(stream, options);
  }

  /**
   * Helper to safely extract JSON from LLM text responses or response objects.
   */
  public extractJson<T = unknown>(
    textOrResponse: string | UnifiedApiResponse,
  ): T {
    return this.chat.completions.extractJson<T>(textOrResponse);
  }

  public readonly embeddings = {
    create: async (
      request: CreateEmbeddingRequest,
    ): Promise<CreateEmbeddingResponse> => {
      return this.router.executeEmbedding(request);
    },
  };

  public readonly batch = {
    /**
     * Executes multiple non-streaming chat completion requests concurrently with
     * built-in concurrency control, fail-soft resilience, and progress reporting.
     */
    chat: async (
      requests: CreateChatCompletionRequestNonStreaming[],
      options?: BatchOptions,
    ): Promise<BatchResult<UnifiedApiResponse>> => {
      return executeBatch(
        requests,
        async (req) => {
          const res = await this.chat.completions.create(req);
          return res as UnifiedApiResponse;
        },
        options,
      );
    },

    /**
     * Executes multiple text embedding requests concurrently with
     * built-in concurrency control, fail-soft resilience, and progress reporting.
     */
    embeddings: async (
      requests: CreateEmbeddingRequest[],
      options?: BatchOptions,
    ): Promise<BatchResult<CreateEmbeddingResponse>> => {
      return executeBatch(
        requests,
        async (req) => this.embeddings.create(req),
        options,
      );
    },

    /**
     * General concurrency executor for running any custom async task over an array of items.
     */
    create: async <TReq, TRes>(
      items: TReq[],
      handler: (item: TReq, index: number) => Promise<TRes>,
      options?: BatchOptions,
    ): Promise<BatchResult<TRes>> => {
      return executeBatch(items, handler, options);
    },
  };

  public getMetrics(): SinapsMetrics {
    return this.router.getMetrics();
  }

  public async getCircuitBreakerStatus(): Promise<
    Record<string, CircuitBreakerStatus>
  > {
    return this.router.getCircuitBreakerStatus();
  }

  public async resetCircuitBreaker(providerId?: string): Promise<void> {
    return this.router.resetCircuitBreaker(providerId);
  }

  public async clearCache(): Promise<void> {
    return this.router.clearCache();
  }
}
