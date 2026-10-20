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
  BudgetOptions,
  ChatMessage,
  CircuitBreakerStatus,
  CreateChatCompletionRequest,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  GatewayHealthReport,
  GatewayRateLimitOptions,
  HealthCheckOptions,
  OtelExportOptions,
  OtelResourceMetrics,
  PrometheusExportOptions,
  RunWithToolsOptions,
  RunWithToolsResult,
  RunWithToolsStep,
  SecurityGuardrailsOptions,
  SinapsEventHooks,
  SinapsMetrics,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import {
  accumulateStream,
  type StreamAccumulatorOptions,
} from '../utils/streamAccumulator.js';
import {
  extractJsonFromText,
  tryExtractJson,
} from '../utils/structuredOutput.js';
import { executeBatch } from './BatchExecutor.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';
import {
  type ContextCompressionOptions,
  ContextCompressor,
} from './ContextCompressor.js';
import type { HedgedExecutor, HedgingOptions } from './HedgedExecutor.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { McpToolBridge } from './McpBridge.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { GatewayRateLimitError, GatewayRateLimiter } from './RateLimiter.js';
import { type CacheOptions, Router, type RouterStrategy } from './Router.js';
import {
  SecurityGuardrailError,
  SecurityGuardrails,
} from './SecurityGuardrails.js';
import type { StateStorage } from './StateStorage.js';

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
   * Optional budget options to cap maximum cost (USD) or cumulative tokens,
   * triggering an error or warning callback when exceeded.
   */
  budget?: BudgetOptions;
  /**
   * Optional PII guardrails configuration.
   * When enabled, automatically redacts or tokenizes personally identifiable information
   * (email, phone, credit card, SSN, IP) from all outgoing messages before
   * they are sent to LLM providers.
   */
  piiGuardrails?: ExtendedPIIGuardrailsOptions | boolean;
  /**
   * Optional security guardrails to defend against prompt injection, jailbreaks,
   * system role hijacking, and secret exfiltration.
   */
  securityGuardrails?: SecurityGuardrailsOptions | boolean;
  /**
   * Optional dictionary of model aliases (e.g. { 'fast': 'gpt-4o-mini', 'smart': 'claude-3-7-sonnet' }).
   * Allows incoming requests to specify friendly virtual alias names which get resolved automatically.
   */
  modelAliases?: Record<string, string>;
  /**
   * Optional context compression options to truncate conversation turns
   * (sliding-window or middle-out) when prompt messages exceed maxPromptTokens.
   */
  contextCompression?: ContextCompressionOptions;
  /**
   * Optional speculative hedged requests configuration to eliminate P99 tail latency.
   * Automatically fires backup requests after delayMs if primary provider has not responded yet.
   */
  hedging?: HedgingOptions;
  /**
   * Optional in-process gateway rate limiting configuration.
   * Enforces Requests Per Minute (RPM) and Tokens Per Minute (TPM)
   * globally, per-user, per-model, or per-provider using a sliding-window counter.
   */
  rateLimiting?: GatewayRateLimitOptions | boolean;
  /**
   * Optional Model Context Protocol (MCP) tool bridge.
   * If provided, client.mcp will use this bridge; otherwise a default in-process bridge is created.
   */
  mcpBridge?: McpToolBridge;
}

export class SinapsClient {
  private router: Router;
  private storage: StateStorage;
  public readonly guardrails?: PIIGuardrails;
  public readonly securityGuardrails?: SecurityGuardrails;
  public readonly contextCompressor?: ContextCompressor;
  public readonly hedgedExecutor?: HedgedExecutor;
  public readonly rateLimiter?: GatewayRateLimiter;
  public readonly mcp: McpToolBridge;
  private isReversiblePII = false;
  private modelAliases = new Map<string, string>();
  private hooks?: SinapsEventHooks;

  constructor(options: SinapsClientOptions) {
    this.storage = options.storage || new InMemoryStorage();
    this.hooks = options.hooks;
    this.mcp = options.mcpBridge || new McpToolBridge();

    if (options.modelAliases) {
      for (const [alias, target] of Object.entries(options.modelAliases)) {
        this.modelAliases.set(alias, target);
      }
    }

    // Initialize Gateway Rate Limiter if configured
    if (options.rateLimiting) {
      if (options.rateLimiting === true) {
        this.rateLimiter = new GatewayRateLimiter(this.storage, {
          defaultRule: { requestsPerMinute: 600 },
        });
      } else {
        this.rateLimiter = new GatewayRateLimiter(
          this.storage,
          options.rateLimiting,
        );
      }
    }

    // Initialize Security guardrails if configured
    if (options.securityGuardrails) {
      if (options.securityGuardrails === true) {
        this.securityGuardrails = new SecurityGuardrails();
      } else {
        this.securityGuardrails = new SecurityGuardrails(
          options.securityGuardrails,
        );
      }
    }

    // Initialize PII guardrails if configured
    if (options.piiGuardrails) {
      if (options.piiGuardrails === true) {
        this.guardrails = new PIIGuardrails();
      } else {
        this.guardrails = new PIIGuardrails(options.piiGuardrails);
        this.isReversiblePII = options.piiGuardrails.reversible === true;
      }
    }

    // Initialize Context Compressor if configured
    if (options.contextCompression) {
      this.contextCompressor = new ContextCompressor(
        options.contextCompression,
      );
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
      budget: options.budget,
      hedging: options.hedging,
    });
    this.hedgedExecutor = this.router.getHedgedExecutor();
  }

  public readonly chat = {
    completions: {
      create: (async (
        request: CreateChatCompletionRequest,
      ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> => {
        let messages: ChatMessage[] = request.messages;
        let piiVault: Map<string, string> | undefined;

        // Apply Security Guardrails (prompt injection, jailbreaks, delimiter hijacking)
        if (this.securityGuardrails) {
          const scan = this.securityGuardrails.scanMessages(messages);
          if (!scan.safe) {
            for (const v of scan.violations) {
              this.hooks?.onSecurityViolation?.(v, v.messageIndex);
            }
            if (this.securityGuardrails.action === 'block') {
              throw new SecurityGuardrailError(
                `Prompt rejected due to security violations: ${scan.violations.map((v) => v.category).join(', ')}`,
                scan.violations,
              );
            }
          }
          messages = scan.messages;
        }

        // Apply PII redaction or reversible tokenization if guardrails are enabled
        if (this.guardrails) {
          if (this.isReversiblePII && !request.stream) {
            const tokenized = this.guardrails.tokenizeMessages(messages);
            messages = tokenized.messages;
            piiVault = tokenized.vault;
          } else {
            messages = this.guardrails.redactMessages(messages);
          }
        }

        // Apply context compression if configured
        if (this.contextCompressor) {
          const compressed = this.contextCompressor.compress(messages);
          messages = compressed.messages;
        }

        const resolvedModel = this.resolveModel(request.model);

        const fullReq: UnifiedApiRequest = {
          model: resolvedModel,
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
          user: request.user,
        };

        let estimatedTokens = 0;
        if (this.rateLimiter) {
          estimatedTokens = this.rateLimiter.estimateTokens(fullReq);
          const check = await this.rateLimiter.check(fullReq, {
            estimatedTokens,
          });
          if (!check.allowed && check.violation) {
            this.hooks?.onGatewayRateLimitWarning?.(check.violation);
            if (this.rateLimiter.action === 'block') {
              throw new GatewayRateLimitError(
                `Gateway rate limit exceeded: ${check.violation.limitType} limit reached for ${check.violation.key} (${check.violation.current}/${check.violation.limit}). Retry after ${check.violation.retryAfterSec}s.`,
                check.violation,
              );
            }
          }
        }

        const res = await this.router.execute(fullReq);

        const actualTokens = (res as UnifiedApiResponse).usage?.totalTokens;
        if (this.rateLimiter && !request.stream && actualTokens !== undefined) {
          await this.rateLimiter.adjustTokens(
            fullReq,
            actualTokens,
            estimatedTokens,
            (res as UnifiedApiResponse).provider,
          );
        }

        // Adjust rate limit tokens upon streaming completion
        if (this.rateLimiter && request.stream) {
          const limiter = this.rateLimiter;
          const stream = res as AsyncIterable<UnifiedApiStreamChunk>;
          return (async function* () {
            let actualStreamTokens: number | undefined;
            try {
              for await (const chunk of stream) {
                if (chunk.usage) {
                  const calculated =
                    chunk.usage.totalTokens ??
                    (chunk.usage.promptTokens || 0) +
                      (chunk.usage.completionTokens || 0);
                  actualStreamTokens = calculated > 0 ? calculated : undefined;
                }
                yield chunk;
              }
            } finally {
              if (actualStreamTokens !== undefined) {
                await limiter.adjustTokens(
                  fullReq,
                  actualStreamTokens,
                  estimatedTokens,
                );
              }
            }
          })();
        }

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

      /**
       * Safely attempts to extract and parse JSON data, returning null if invalid.
       */
      tryExtractJson: <T = unknown>(
        textOrResponse: string | UnifiedApiResponse,
      ): T | null => {
        if (typeof textOrResponse === 'string') {
          return tryExtractJson<T>(textOrResponse);
        }
        const text = textOrResponse.choices?.[0]?.message?.content || '';
        return tryExtractJson<T>(text);
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

  /**
   * Helper to safely attempt JSON extraction, returning null if parsing fails.
   */
  public tryExtractJson<T = unknown>(
    textOrResponse: string | UnifiedApiResponse,
  ): T | null {
    return this.chat.completions.tryExtractJson<T>(textOrResponse);
  }

  public readonly embeddings = {
    create: async (
      request: CreateEmbeddingRequest,
    ): Promise<CreateEmbeddingResponse> => {
      const model = this.resolveModel(request.model);
      const fullReq: CreateEmbeddingRequest = {
        ...request,
        model,
      };

      if (this.rateLimiter) {
        const dummyReq: UnifiedApiRequest = {
          model,
          messages: [],
          user: request.user,
        };
        const inputTokens = Array.isArray(request.input)
          ? request.input.reduce(
              (acc, str) => acc + Math.ceil(str.length / 4),
              0,
            )
          : Math.ceil(request.input.length / 4);
        const check = await this.rateLimiter.check(dummyReq, {
          estimatedTokens: inputTokens,
        });
        if (!check.allowed && check.violation) {
          this.hooks?.onGatewayRateLimitWarning?.(check.violation);
          if (this.rateLimiter.action === 'block') {
            throw new GatewayRateLimitError(
              `Gateway rate limit exceeded: ${check.violation.limitType} limit reached for ${check.violation.key} (${check.violation.current}/${check.violation.limit}). Retry after ${check.violation.retryAfterSec}s.`,
              check.violation,
            );
          }
        }
      }

      return this.router.executeEmbedding(fullReq);
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

  /**
   * Resolves a model name against configured model aliases.
   */
  public resolveModel(modelName?: string): string {
    if (!modelName) return 'default';
    return this.modelAliases.get(modelName) || modelName;
  }

  /**
   * Registers or updates a friendly model alias.
   */
  public setModelAlias(alias: string, targetModel: string): void {
    this.modelAliases.set(alias, targetModel);
  }

  /**
   * Returns all currently registered model aliases.
   */
  public getModelAliases(): Record<string, string> {
    return Object.fromEntries(this.modelAliases.entries());
  }

  /**
   * Removes a registered model alias.
   */
  public removeModelAlias(alias: string): boolean {
    return this.modelAliases.delete(alias);
  }

  /**
   * Checks the health and liveness of all configured providers.
   */
  public async checkHealth(
    options?: HealthCheckOptions,
  ): Promise<GatewayHealthReport> {
    return this.router.checkHealth(options);
  }

  /**
   * Formats current gateway telemetry metrics into Prometheus / OpenMetrics exposition format.
   */
  public exportPrometheusMetrics(options?: PrometheusExportOptions): string {
    return this.router.exportPrometheusMetrics(options);
  }

  /**
   * Alias for exportPrometheusMetrics.
   */
  public toPrometheusMetrics(options?: PrometheusExportOptions): string {
    return this.exportPrometheusMetrics(options);
  }

  /**
   * Formats current gateway telemetry metrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
   */
  public exportOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics {
    return this.router.exportOtelMetrics(options);
  }

  /**
   * Alias for exportOtelMetrics.
   */
  public toOtelMetrics(options?: OtelExportOptions): OtelResourceMetrics {
    return this.exportOtelMetrics(options);
  }

  /**
   * Runs an autonomous multi-step tool-calling agent loop.
   *
   * Repeatedly queries the model with available MCP tools, executes requested tool calls
   * via the McpToolBridge, feeds results back into the conversation, and returns the final
   * response and complete conversation history once the model finishes or maxSteps is reached.
   */
  public async runWithTools(
    options: RunWithToolsOptions,
  ): Promise<RunWithToolsResult> {
    const maxSteps = options.maxSteps ?? 5;
    const bridge = options.mcpBridge ?? this.mcp;
    const currentMessages: ChatMessage[] = [...options.messages];
    const steps: RunWithToolsStep[] = [];
    let totalTokens = 0;
    let latestResponse!: UnifiedApiResponse;

    const tools =
      options.tools && options.tools.length > 0
        ? options.tools
        : bridge.getTools();

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      const stepStart = Date.now();
      const req: CreateChatCompletionRequestNonStreaming = {
        ...options,
        messages: currentMessages,
        stream: false,
        tools: tools.length > 0 ? tools : undefined,
      };

      const response = (await this.chat.completions.create(
        req,
      )) as UnifiedApiResponse;
      latestResponse = response;

      const promptTokens = response.usage?.promptTokens || 0;
      const completionTokens = response.usage?.completionTokens || 0;
      const stepTokens =
        response.usage?.totalTokens || promptTokens + completionTokens;
      totalTokens += stepTokens;

      const choice = response.choices?.[0];
      const toolCalls = choice?.message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        if (choice?.message) {
          currentMessages.push(choice.message);
        }
        break;
      }

      currentMessages.push(choice.message);

      const toolResults = await bridge.executeToolCalls(toolCalls, {
        signal: options.signal,
        user: options.user,
      });

      for (const tr of toolResults) {
        currentMessages.push(tr);
      }

      const durationMs = Date.now() - stepStart;
      const step: RunWithToolsStep = {
        stepIndex,
        assistantMessage: choice.message,
        toolCalls,
        toolResults,
        durationMs,
        usage: response.usage,
      };
      steps.push(step);

      if (options.onStep) {
        await options.onStep(step);
      }
    }

    return {
      response: latestResponse,
      messages: currentMessages,
      steps,
      totalSteps: steps.length,
      totalTokens,
    };
  }
}
