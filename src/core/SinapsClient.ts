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
   * When enabled, automatically redacts personally identifiable information
   * (email, phone, credit card, SSN, IP) from all outgoing messages before
   * they are sent to LLM providers.
   */
  piiGuardrails?: PIIGuardrailsOptions | boolean;
}

export class SinapsClient {
  private router: Router;
  private storage: StateStorage;
  private piiGuardrails?: PIIGuardrails;

  constructor(options: SinapsClientOptions) {
    this.storage = options.storage || new InMemoryStorage();

    // Initialize PII guardrails if configured
    if (options.piiGuardrails) {
      this.piiGuardrails =
        options.piiGuardrails === true
          ? new PIIGuardrails()
          : new PIIGuardrails(options.piiGuardrails);
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
        // Apply PII redaction to outgoing messages if guardrails are enabled
        const messages: ChatMessage[] = this.piiGuardrails
          ? this.piiGuardrails.redactMessages(request.messages)
          : request.messages;

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
        return this.router.execute(fullReq);
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
    },
  };

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
