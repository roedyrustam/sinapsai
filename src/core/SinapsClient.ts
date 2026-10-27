/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { GeminiProvider } from '../providers/GeminiProvider.js';
import type { Provider } from '../providers/Provider.js';
import type {
  AgentStreamEvent,
  ApiUsage,
  BatchOptions,
  BatchResult,
  BudgetOptions,
  CachedContentInfo,
  ChatMessage,
  CircuitBreakerStatus,
  ContextCacheEligibility,
  CreateCachedContentOptions,
  CreateChatCompletionRequest,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  GatewayHealthReport,
  GatewayRateLimitOptions,
  GroundingMetadata,
  HealthCheckOptions,
  OtelExportOptions,
  OtelResourceMetrics,
  PrometheusExportOptions,
  RunWithToolsOptions,
  RunWithToolsResult,
  RunWithToolsStep,
  RunWithToolsStreamOptions,
  SecurityGuardrailsOptions,
  SinapsEventHooks,
  SinapsMetrics,
  ToolCall,
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
import { AgentSwarm, type AgentSwarmOptions } from './AgentSwarm.js';
import { executeBatch } from './BatchExecutor.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';
import {
  ConsensusEngine,
  type ConsensusOptions,
  type ConsensusResult,
} from './ConsensusEngine.js';
import {
  type ContextCompressionOptions,
  ContextCompressor,
} from './ContextCompressor.js';
import {
  EpisodicMemory,
  type EpisodicMemoryOptions,
} from './EpisodicMemory.js';
import { GeminiAgentBooster } from './GeminiAgentBooster.js';
import type { HedgedExecutor, HedgingOptions } from './HedgedExecutor.js';
import { HybridRagEngine, type HybridRagOptions } from './HybridRag.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import {
  type LlmOptimizationOptions,
  type LlmOptimizationResult,
  LlmOptimizer,
  type LlmRequestOptimizationOptions,
} from './LlmOptimizer.js';
import { McpToolBridge } from './McpBridge.js';
import { PIIGuardrails, type PIIGuardrailsOptions } from './PIIGuardrails.js';
import { GatewayRateLimitError, GatewayRateLimiter } from './RateLimiter.js';
import { RealtimeClient } from './RealtimeClient.js';
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
  /**
   * Optional LLM Optimization (LLMO) pipeline configuration.
   * Enables prompt minification, deterministic KV-cache prefix alignment,
   * automated complexity-based model cascading, and dynamic thinking allocation.
   */
  llmo?: LlmOptimizationOptions | boolean;
  /**
   * Optional episodic long-term vector memory configuration.
   */
  memory?: EpisodicMemoryOptions;
  /**
   * Optional in-process hybrid RAG configuration.
   */
  rag?: HybridRagOptions;
}

export class SinapsClient {
  private router: Router;
  private storage: StateStorage;
  public readonly guardrails?: PIIGuardrails;
  public readonly securityGuardrails?: SecurityGuardrails;
  public readonly contextCompressor?: ContextCompressor;
  public readonly hedgedExecutor?: HedgedExecutor;
  public readonly rateLimiter?: GatewayRateLimiter;
  public readonly llmo?: LlmOptimizer;
  public readonly mcp: McpToolBridge;
  public readonly memory: EpisodicMemory;
  public readonly rag: HybridRagEngine;
  public readonly realtime = new RealtimeClient();
  public readonly consensus: {
    create: (options: ConsensusOptions) => Promise<ConsensusResult>;
  };
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

    // Initialize LLM Optimizer (LLMO) if configured
    if (options.llmo) {
      if (options.llmo === true) {
        this.llmo = new LlmOptimizer();
      } else {
        this.llmo = new LlmOptimizer(options.llmo);
      }
    }

    // Initialize In-Process Episodic Vector Memory
    this.memory = new EpisodicMemory({
      storage: this.storage,
      ...options.memory,
    });

    // Initialize In-Process Hybrid RAG Engine
    this.rag = new HybridRagEngine(options.rag);

    // Initialize Speculative Multi-Draft Consensus
    this.consensus = {
      create: async (
        consensusOptions: ConsensusOptions,
      ): Promise<ConsensusResult> => {
        const engine = new ConsensusEngine();
        return engine.execute(this, consensusOptions);
      },
    };
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
          if (this.isReversiblePII) {
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

        let tools = request.tools;
        let thinkingBudget = request.thinkingBudget;
        let requestedModel = request.model;

        // Apply LLM Optimization (LLMO) if configured
        if (this.llmo) {
          const opt = this.llmo.optimize(
            {
              model: this.resolveModel(request.model),
              messages,
              tools,
              thinkingBudget,
            },
            request.llmo,
          );
          messages = opt.messages;
          tools = opt.tools;
          thinkingBudget = opt.thinkingBudget;
          if (opt.cascadeModel) {
            requestedModel = opt.cascadeModel;
          }
        }

        const resolvedModel = this.resolveModel(requestedModel);

        const fullReq: UnifiedApiRequest = {
          model: resolvedModel,
          messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          stream: request.stream,
          signal: request.signal,
          tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
          fallbackModels: request.fallbackModels,
          thinkingBudget,
          reasoningEffort: request.reasoningEffort,
          cachedContent: request.cachedContent,
          googleSearch: request.googleSearch,
          codeExecution: request.codeExecution,
          user: request.user,
          llmo: request.llmo,
        };

        let estimatedTokens = 0;
        let candidateProviderId: string | undefined;
        if (this.rateLimiter) {
          candidateProviderId =
            this.router.getPrimaryCandidateProviderId(fullReq);
          estimatedTokens = this.rateLimiter.estimateTokens(fullReq);
          const check = await this.rateLimiter.check(fullReq, {
            estimatedTokens,
            providerId: candidateProviderId,
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
            (res as UnifiedApiResponse).provider || candidateProviderId,
          );
        }

        if (request.stream) {
          let streamResult = res as AsyncIterable<UnifiedApiStreamChunk>;

          // Adjust rate limit tokens upon streaming completion
          if (this.rateLimiter) {
            const limiter = this.rateLimiter;
            const upstream = streamResult;
            streamResult = (async function* () {
              let actualStreamTokens: number | undefined;
              let streamProviderId: string | undefined = candidateProviderId;
              try {
                for await (const chunk of upstream) {
                  if (chunk.provider) {
                    streamProviderId = chunk.provider;
                  }
                  if (chunk.usage) {
                    const calculated =
                      chunk.usage.totalTokens ??
                      (chunk.usage.promptTokens || 0) +
                        (chunk.usage.completionTokens || 0);
                    actualStreamTokens =
                      calculated > 0 ? calculated : undefined;
                  }
                  yield chunk;
                }
              } finally {
                if (actualStreamTokens !== undefined) {
                  await limiter.adjustTokens(
                    fullReq,
                    actualStreamTokens,
                    estimatedTokens,
                    streamProviderId,
                  );
                }
              }
            })();
          }

          // Reversibly restore PII tokens across streaming chunk boundaries
          if (this.guardrails && piiVault && piiVault.size > 0) {
            streamResult = this.guardrails.restoreStream(
              streamResult,
              piiVault,
            );
          }

          return streamResult;
        }

        // Reversibly restore PII values if vault contains tokens
        if (
          this.guardrails &&
          piiVault &&
          piiVault.size > 0 &&
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
        const candidateProviderId =
          this.router.getPrimaryCandidateProviderId(dummyReq);
        const inputTokens = Array.isArray(request.input)
          ? request.input.reduce(
              (acc, str) => acc + Math.ceil(str.length / 4),
              0,
            )
          : Math.ceil(request.input.length / 4);
        const check = await this.rateLimiter.check(dummyReq, {
          estimatedTokens: inputTokens,
          providerId: candidateProviderId,
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
    const base = this.router.getMetrics();
    if (this.llmo) {
      return {
        ...base,
        llmoMetrics: this.llmo.getMetrics(),
      };
    }
    return base;
  }

  /**
   * Helper to analyze and optimize prompt messages using LLMO (Large Language Model Optimization).
   */
  public optimizePrompt(
    request: UnifiedApiRequest,
    options?: LlmRequestOptimizationOptions,
  ): LlmOptimizationResult {
    const optimizer = this.llmo ?? new LlmOptimizer();
    return optimizer.optimize(request, options);
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
   * Helper to locate the configured Gemini provider for context caching and frontier tools.
   */
  private getGeminiProvider(): GeminiProvider | undefined {
    return this.router
      .getProviders()
      .find(
        (p) =>
          p instanceof GeminiProvider ||
          p.name === 'Gemini' ||
          p.id.startsWith('gemini') ||
          typeof (p as unknown as Record<string, unknown>)
            .createCachedContent === 'function',
      ) as GeminiProvider | undefined;
  }

  /**
   * First-class Google Context Caching management control plane (>32k static prefix token caching).
   */
  public readonly contextCache = {
    /**
     * Evaluates whether a prompt or request meets the token threshold for context caching (default: 32,768 tokens).
     */
    evaluateEligibility: (
      request: Pick<UnifiedApiRequest, 'messages' | 'tools'>,
      minTokenThreshold?: number,
    ): ContextCacheEligibility => {
      return GeminiAgentBooster.evaluateContextCacheEligibility(
        request,
        minTokenThreshold,
      );
    },

    /**
     * Creates a cached content resource on Google Gemini for large static prompts.
     */
    create: async (
      options: CreateCachedContentOptions,
    ): Promise<CachedContentInfo> => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          'Context caching requires a configured Gemini provider.',
        );
      }
      return provider.createCachedContent(options);
    },

    /**
     * Retrieves metadata for an existing cached content resource by name.
     */
    get: async (name: string): Promise<CachedContentInfo> => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          'Context caching requires a configured Gemini provider.',
        );
      }
      return provider.getCachedContent(name);
    },

    /**
     * Lists active cached content resources.
     */
    list: async (pageSize?: number): Promise<CachedContentInfo[]> => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          'Context caching requires a configured Gemini provider.',
        );
      }
      return provider.listCachedContents(pageSize);
    },

    /**
     * Deletes a cached content resource by name.
     */
    delete: async (name: string): Promise<void> => {
      const provider = this.getGeminiProvider();
      if (!provider) {
        throw new Error(
          'Context caching requires a configured Gemini provider.',
        );
      }
      return provider.deleteCachedContent(name);
    },
  };

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
    const startCost = this.getMetrics().estimatedCostUsd;
    let totalTokens = 0;
    let latestResponse!: UnifiedApiResponse;

    const tools =
      options.tools && options.tools.length > 0
        ? options.tools
        : bridge.getTools();

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      if (options.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }

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
        timeoutMs: options.toolTimeoutMs,
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

    const endCost = this.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));

    return {
      response: latestResponse,
      messages: currentMessages,
      steps,
      totalSteps: steps.length,
      totalTokens,
      totalCostUsd,
    };
  }

  /**
   * Runs a streaming autonomous multi-step tool-calling agent loop.
   *
   * Yields real-time `AgentStreamEvent` items (`step-start`, `text-delta`, `reasoning-delta`,
   * `tool-call-start`, `tool-call-result`, `step-finish`, and `done`) while accumulating
   * fragmented streaming tool call arguments and executing MCP tools between turns.
   */
  public async *runWithToolsStream(
    options: RunWithToolsStreamOptions,
  ): AsyncGenerator<AgentStreamEvent, RunWithToolsResult, unknown> {
    const maxSteps = options.maxSteps ?? 5;
    const bridge = options.mcpBridge ?? this.mcp;
    const currentMessages: ChatMessage[] = [...options.messages];
    const steps: RunWithToolsStep[] = [];
    const startCost = this.getMetrics().estimatedCostUsd;
    let totalTokens = 0;
    let latestResponse!: UnifiedApiResponse;

    const tools =
      options.tools && options.tools.length > 0
        ? options.tools
        : bridge.getTools();

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
      if (options.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }

      yield { type: 'step-start', stepIndex };

      const stepStart = Date.now();
      const req: CreateChatCompletionRequestStreaming = {
        ...options,
        messages: currentMessages,
        stream: true,
        tools: tools.length > 0 ? tools : undefined,
      };

      const stream = await this.chat.completions.create(req);

      let responseId = `agent-step-${stepIndex}`;
      let responseModel = options.model || 'default';
      let responseProvider: string | undefined;
      let contentAcc = '';
      let reasoningAcc = '';
      let finishReason = 'stop';
      let stepUsage: ApiUsage | undefined;
      let stepGrounding: GroundingMetadata | undefined;
      const toolCallsMap = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        if (chunk.id) responseId = chunk.id;
        if (chunk.model) responseModel = chunk.model;
        if (chunk.provider) responseProvider = chunk.provider;
        if (chunk.usage) stepUsage = chunk.usage;
        if (chunk.grounding) stepGrounding = chunk.grounding;

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finishReason) {
          finishReason = choice.finishReason;
        }

        const delta = choice.delta;
        if (
          typeof delta.reasoning_content === 'string' &&
          delta.reasoning_content
        ) {
          reasoningAcc += delta.reasoning_content;
          yield {
            type: 'reasoning-delta',
            stepIndex,
            reasoningDelta: delta.reasoning_content,
            chunk,
          };
        }

        if (typeof delta.content === 'string' && delta.content) {
          contentAcc += delta.content;
          yield {
            type: 'text-delta',
            stepIndex,
            textDelta: delta.content,
            chunk,
          };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || {
              id: '',
              name: '',
              arguments: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
            toolCallsMap.set(idx, existing);
          }
        }
      }

      const assembledToolCalls: ToolCall[] = Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([idx, tc]) => ({
          id: tc.id || `call_${stepIndex}_${idx}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments || '{}',
          },
        }));

      const assistantMessage: UnifiedApiResponse['choices'][number]['message'] =
        {
          role: 'assistant',
          content: contentAcc.length > 0 ? contentAcc : null,
          ...(reasoningAcc.length > 0
            ? { reasoning_content: reasoningAcc }
            : {}),
          ...(assembledToolCalls.length > 0
            ? { tool_calls: assembledToolCalls }
            : {}),
          ...(stepGrounding ? { grounding: stepGrounding } : {}),
        };

      latestResponse = {
        id: responseId,
        model: responseModel,
        provider: responseProvider,
        choices: [
          {
            message: assistantMessage,
            finishReason:
              assembledToolCalls.length > 0 ? 'tool_calls' : finishReason,
          },
        ],
        usage: stepUsage,
        grounding: stepGrounding,
      };

      if (stepUsage) {
        const promptTokens = stepUsage.promptTokens || 0;
        const completionTokens = stepUsage.completionTokens || 0;
        totalTokens += stepUsage.totalTokens || promptTokens + completionTokens;
      }

      if (assembledToolCalls.length === 0) {
        currentMessages.push(assistantMessage);
        break;
      }

      currentMessages.push(assistantMessage);

      yield {
        type: 'tool-call-start',
        stepIndex,
        toolCalls: assembledToolCalls,
      };

      const toolExecutions = await Promise.all(
        assembledToolCalls.map(async (tc) => {
          const mcpRes = await bridge.executeToolCall(tc, {
            signal: options.signal,
            user: options.user,
            timeoutMs: options.toolTimeoutMs,
          });
          const textOutput = mcpRes.content
            .map((c) => {
              if (c.type === 'text') return c.text;
              if (c.type === 'resource') {
                return c.resource.text ?? `[Resource: ${c.resource.uri}]`;
              }
              return `[Image: ${c.mimeType}]`;
            })
            .join('\n');

          const toolMessage: ChatMessage = {
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: textOutput,
          };

          return {
            tc,
            mcpRes,
            toolMessage,
          };
        }),
      );

      const toolResults: ChatMessage[] = [];
      for (const item of toolExecutions) {
        toolResults.push(item.toolMessage);
        currentMessages.push(item.toolMessage);

        yield {
          type: 'tool-call-result',
          stepIndex,
          toolCallId: item.tc.id,
          toolName: item.tc.function.name,
          result: item.mcpRes,
          toolMessage: item.toolMessage,
        };
      }

      const durationMs = Date.now() - stepStart;
      const step: RunWithToolsStep = {
        stepIndex,
        assistantMessage,
        toolCalls: assembledToolCalls,
        toolResults,
        durationMs,
        usage: stepUsage,
      };
      steps.push(step);

      if (options.onStep) {
        await options.onStep(step);
      }

      yield {
        type: 'step-finish',
        stepIndex,
        step,
      };
    }

    const endCost = this.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));

    const finalResult: RunWithToolsResult = {
      response: latestResponse,
      messages: currentMessages,
      steps,
      totalSteps: steps.length,
      totalTokens,
      totalCostUsd,
    };

    yield {
      type: 'done',
      result: finalResult,
    };

    return finalResult;
  }

  /**
   * Instantiate an in-process multi-agent swarm orchestrator
   * supporting role-based specialist delegation, A2A handoffs, and shared memory.
   */
  public swarm(options: AgentSwarmOptions): AgentSwarm {
    return new AgentSwarm(this, options);
  }
}
