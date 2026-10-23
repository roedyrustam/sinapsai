/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface ToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: 'function';
  function: ToolFunctionDefinition;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallChunk {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface InputAudioContentPart {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: 'wav' | 'mp3' | string;
  };
}

export type ContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | InputAudioContentPart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  reasoning_content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
    description?: string;
  };
}

export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface GroundingMetadata {
  webSearchQueries?: string[];
  sources?: GroundingSource[];
  searchEntryPoint?: string;
}

export interface CreateCachedContentOptions {
  model: string;
  messages?: ChatMessage[];
  // biome-ignore lint/suspicious/noExplicitAny: gemini contents
  contents?: any[];
  systemInstruction?: string;
  ttl?: string;
  displayName?: string;
}

export interface CachedContentInfo {
  name: string;
  displayName?: string;
  model: string;
  createTime?: string;
  updateTime?: string;
  expireTime?: string;
}

export interface UnifiedApiRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  toolChoice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };
  responseFormat?: ResponseFormat;
  fallbackModels?: string[];
  thinkingBudget?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  cachedContent?: string;
  googleSearch?: boolean;
  codeExecution?: boolean;
  /**
   * A unique identifier representing your end-user, useful for tracking abuse and rate limiting.
   */
  user?: string;
}

export interface CreateChatCompletionRequestNonStreaming
  extends Omit<UnifiedApiRequest, 'model' | 'stream'> {
  model?: string;
  stream?: false;
}

export interface CreateChatCompletionRequestStreaming
  extends Omit<UnifiedApiRequest, 'model' | 'stream'> {
  model?: string;
  stream: true;
}

export type CreateChatCompletionRequest =
  | CreateChatCompletionRequestNonStreaming
  | CreateChatCompletionRequestStreaming;

export interface ApiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export interface UnifiedApiStreamChunk {
  id: string;
  model: string;
  /**
   * Identifier of the provider emitting the stream chunk.
   */
  provider?: string;
  choices: Array<{
    delta: {
      role?: 'assistant';
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallChunk[];
    };
    finishReason: string | null;
  }>;
  usage?: ApiUsage;
  grounding?: GroundingMetadata;
}

export interface RateLimitInfo {
  remainingRequests?: number;
  remainingTokens?: number;
  resetMs?: number;
}

export interface UnifiedApiResponse {
  id: string;
  model: string;
  /**
   * Identifier of the provider that fulfilled the request (e.g. 'openai', 'anthropic', 'gemini').
   */
  provider?: string;
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCall[];
      grounding?: GroundingMetadata;
    };
    finishReason: string;
  }>;
  grounding?: GroundingMetadata;
  usage?: ApiUsage;
  rateLimit?: RateLimitInfo;
}

export interface ProviderConfig {
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  costPer1kTokens?: number;
  promptCostPer1k?: number;
  completionCostPer1k?: number;
  defaultModel?: string;
  modelMap?: Record<string, string>;
  fallbackModels?: string[];
  retries?: number;
  retryDelayMs?: number;
  /**
   * Enables native provider prompt caching (e.g. Anthropic cache_control breakpoints).
   * 'auto' automatically injects cache breakpoints on system instructions exceeding 2,048 chars.
   */
  promptCaching?: boolean | 'auto';
}

export interface CreateEmbeddingRequest {
  model: string;
  input: string | string[];
  user?: string;
  signal?: AbortSignal;
  dimensions?: number;
}

export interface EmbeddingItem {
  index: number;
  embedding: number[];
  object: 'embedding';
}

export interface CreateEmbeddingResponse {
  object: 'list';
  data: EmbeddingItem[];
  model: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface ProviderMetricEntry {
  requests: number;
  successes: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  latencySumMs: number;
  averageLatencyMs: number;
}

export interface SinapsMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cachedRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedPromptTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  providerMetrics: Record<string, ProviderMetricEntry>;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
}

export interface ProviderHealth {
  id: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  circuitState: CircuitState;
  latencyMs?: number;
  error?: string;
  successRate: number;
}

export interface GatewayHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  providers: ProviderHealth[];
}

export interface HealthCheckOptions {
  /**
   * If true, sends an active probe request to test provider connectivity.
   * If false (default), conducts a passive inspection of circuit states & metrics.
   */
  ping?: boolean;
  /**
   * Timeout in milliseconds for probe ping requests (default: 3000ms).
   */
  timeoutMs?: number;
}

export interface SemanticCacheOptions {
  enabled?: boolean;
  /**
   * Similarity threshold between 0 and 1 (default: 0.90).
   * If cosine similarity is >= similarityThreshold, the cached response is returned.
   */
  similarityThreshold?: number;
  /**
   * Optional model to use for generating embeddings (e.g., 'text-embedding-3-small').
   */
  embeddingModel?: string;
  /**
   * Maximum number of semantic cache entries kept in-memory (default: 1000).
   */
  maxEntries?: number;
  /**
   * Optional custom embedding function: (text: string) => Promise<number[]>
   */
  customEmbed?: (text: string) => Promise<number[]>;
}

export interface CacheOptions {
  enabled?: boolean;
  ttlSeconds?: number;
  /**
   * Optional semantic caching configuration.
   */
  semantic?: SemanticCacheOptions | boolean;
}

export interface BudgetOptions {
  maxCostUsd?: number;
  maxTotalTokens?: number;
  action?: 'block' | 'warn';
  onBudgetWarning?: (currentCostUsd: number, limitUsd: number) => void;
}

export class BudgetExceededError extends Error {
  public readonly currentCostUsd?: number;
  public readonly limitUsd?: number;
  public readonly currentTotalTokens?: number;
  public readonly limitTokens?: number;

  constructor(
    message: string,
    details?: {
      currentCostUsd?: number;
      limitUsd?: number;
      currentTotalTokens?: number;
      limitTokens?: number;
    },
  ) {
    super(message);
    this.name = 'BudgetExceededError';
    this.currentCostUsd = details?.currentCostUsd;
    this.limitUsd = details?.limitUsd;
    this.currentTotalTokens = details?.currentTotalTokens;
    this.limitTokens = details?.limitTokens;
  }
}

import type { Provider } from '../providers/Provider.js';

export interface SinapsEventHooks {
  onSuccess?: (
    provider: Provider,
    response: UnifiedApiResponse,
    latencyMs: number,
  ) => void;
  onStreamSuccess?: (
    provider: Provider,
    ttftMs: number,
    totalLatencyMs: number,
  ) => void;
  onEmbeddingSuccess?: (
    provider: Provider,
    response: CreateEmbeddingResponse,
    latencyMs: number,
  ) => void;
  onFallback?: (
    error: Error,
    fromProvider: Provider,
    toProvider: Provider,
  ) => void;
  onModelFallback?: (
    error: Error,
    provider: Provider,
    fromModel: string,
    toModel: string,
  ) => void;
  onSemanticCacheHit?: (
    request: UnifiedApiRequest,
    cachedResponse: UnifiedApiResponse,
    similarity: number,
  ) => void;
  onCircuitOpen?: (provider: Provider) => void;
  onCircuitClose?: (provider: Provider) => void;
  onRateLimit?: (provider: Provider, error: Error) => void;
  onRateLimitWarning?: (provider: Provider, rateLimit: RateLimitInfo) => void;
  onRetry?: (
    provider: Provider,
    error: Error,
    attempt: number,
    delayMs: number,
  ) => void;
  onSecurityViolation?: (
    violation: SecurityViolation,
    messageIndex: number,
  ) => void;
  onHedgeFired?: (
    primaryProvider: Provider,
    backupProvider: Provider,
    delayMs: number,
  ) => void;
  onHedgeWon?: (winnerProvider: Provider, elapsedMs: number) => void;
  onGatewayRateLimitWarning?: (violation: GatewayRateLimitViolation) => void;
}

export interface BatchProgress {
  /**
   * Number of items completed (succeeded or failed).
   */
  completed: number;
  /**
   * Total number of items in the batch.
   */
  total: number;
  /**
   * Completion percentage (0 to 100).
   */
  percentage: number;
  /**
   * Number of successfully fulfilled items so far.
   */
  successful: number;
  /**
   * Number of failed/rejected items so far.
   */
  failed: number;
}

export interface BatchOptions {
  /**
   * Maximum number of concurrent in-flight requests (default: 4).
   */
  concurrency?: number;
  /**
   * If true, execution halts immediately when any item errors,
   * throwing a BatchExecutionError with partial results.
   * If false, all items are processed to completion (like Promise.allSettled).
   * Default: false
   */
  stopOnError?: boolean;
  /**
   * Optional callback triggered whenever an item in the batch completes.
   */
  onProgress?: (progress: BatchProgress) => void;
  /**
   * Optional AbortSignal to cancel remaining unprocessed items in the batch.
   */
  signal?: AbortSignal;
}

export interface BatchItemResult<T> {
  /**
   * 0-based index corresponding to the original request position.
   */
  index: number;
  /**
   * Result status: 'fulfilled' on success, 'rejected' on failure.
   */
  status: 'fulfilled' | 'rejected';
  /**
   * Fulfilled response value when status is 'fulfilled'.
   */
  value?: T;
  /**
   * Error object when status is 'rejected'.
   */
  error?: Error;
}

export interface BatchResult<T> {
  /**
   * Array of settled item results in the same order as input requests.
   */
  results: BatchItemResult<T>[];
  /**
   * Total number of requests in the batch.
   */
  total: number;
  /**
   * Total successful requests.
   */
  successful: number;
  /**
   * Total failed requests.
   */
  failed: number;
  /**
   * Total execution time in milliseconds.
   */
  durationMs: number;
}

export type SecurityAction = 'block' | 'sanitize' | 'warn';

export type ThreatCategory =
  | 'prompt_injection'
  | 'jailbreak'
  | 'system_override'
  | 'delimiter_hijack'
  | 'secret_exfiltration';

export interface SecurityViolation {
  category: ThreatCategory;
  pattern: string;
  matchedText: string;
  action: SecurityAction;
  timestamp: number;
}

export interface SecurityScanResult {
  safe: boolean;
  sanitizedText: string;
  violations: SecurityViolation[];
}

export interface SecurityGuardrailsOptions {
  enabled?: boolean;
  /**
   * Action to perform when a threat is detected:
   * - 'block': Throws a SecurityGuardrailError before sending to provider (default).
   * - 'sanitize': Redacts or neutralizes the detected threat tokens and continues.
   * - 'warn': Logs or emits onSecurityViolation hook without modifying text or blocking.
   */
  action?: SecurityAction;
  /**
   * Optional custom detection patterns.
   */
  customPatterns?: Array<{ category: ThreatCategory; regex: RegExp }>;
  /**
   * Optional allowlist patterns that should be ignored even if matched by detection rules.
   */
  allowedPatterns?: RegExp[];
}

export type {
  CompressionResult,
  ContextCompressionOptions,
} from '../core/ContextCompressor.js';

export type ContextCompressionResult =
  import('../core/ContextCompressor.js').CompressionResult;

export type {
  HedgeRaceResult,
  HedgingOptions,
} from '../core/HedgedExecutor.js';

export interface GatewayRateLimitRule {
  /**
   * Maximum allowed requests in the window (Requests Per Minute).
   */
  requestsPerMinute?: number;
  /**
   * Maximum allowed cumulative tokens (prompt + completion) in the window (Tokens Per Minute).
   */
  tokensPerMinute?: number;
  /**
   * Duration of the sliding-window in milliseconds (default: 60,000 = 1 minute).
   */
  windowMs?: number;
}

export interface GatewayRateLimitOptions {
  /**
   * Enable in-process gateway rate limiting. Default: true when options are provided.
   */
  enabled?: boolean;
  /**
   * Default rule applied to requests if no model-specific or provider-specific rule matches.
   */
  defaultRule?: GatewayRateLimitRule;
  /**
   * Model-specific rules (e.g. { 'claude-3-7-sonnet': { requestsPerMinute: 20 } }).
   */
  modelRules?: Record<string, GatewayRateLimitRule>;
  /**
   * Provider-specific rules (e.g. { 'groq': { requestsPerMinute: 30 } }).
   */
  providerRules?: Record<string, GatewayRateLimitRule>;
  /**
   * Custom key generator to partition limits by tenant, user, or IP.
   * Defaults to extracting `request.user` or returns 'global'.
   */
  keyGenerator?: (request: UnifiedApiRequest) => string;
  /**
   * Action when limit is exceeded:
   * - 'block': Throws GatewayRateLimitError (default).
   * - 'warn': Invokes onRateLimitExceeded and hook, but allows request.
   */
  action?: 'block' | 'warn';
  /**
   * Callback invoked whenever a rate limit threshold is exceeded.
   */
  onRateLimitExceeded?: (violation: GatewayRateLimitViolation) => void;
}

export interface GatewayRateLimitViolation {
  key: string;
  scope: 'global' | 'user' | 'model' | 'provider';
  limitType: 'requests' | 'tokens';
  limit: number;
  current: number;
  resetMs: number;
  retryAfterSec: number;
  model?: string;
  providerId?: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  violation?: GatewayRateLimitViolation;
  remainingRequests?: number;
  remainingTokens?: number;
  resetMs: number;
}

export interface PrometheusExportOptions {
  /**
   * Metric name prefix (default: 'sinaps_').
   */
  prefix?: string;
  /**
   * Additional static labels to inject into all metric lines (e.g. { env: 'production' }).
   */
  labels?: Record<string, string>;
  /**
   * Include current millisecond timestamp at the end of each metric line. Default: false
   */
  includeTimestamps?: boolean;
}

export interface OtelExportOptions {
  /**
   * Service name reported in resource attributes (default: 'sinapsai-gateway').
   */
  serviceName?: string;
  /**
   * Service version reported in resource attributes (default: '2.8.1').
   */
  serviceVersion?: string;
  /**
   * Custom attributes attached to the root resource.
   */
  resourceAttributes?: Record<string, string | number | boolean>;
}

export interface OtelMetricItem {
  name: string;
  description: string;
  unit: string;
  sum?: {
    dataPoints: Array<{
      asInt?: number;
      asDouble?: number;
      timeUnixNano: string;
      attributes: Array<{
        key: string;
        value: { stringValue: string };
      }>;
    }>;
    aggregationTemporality: number;
    isMonotonic: boolean;
  };
  gauge?: {
    dataPoints: Array<{
      asDouble: number;
      timeUnixNano: string;
      attributes: Array<{
        key: string;
        value: { stringValue: string };
      }>;
    }>;
  };
}

export interface OtelResourceMetrics {
  resourceMetrics: Array<{
    resource: {
      attributes: Array<{
        key: string;
        value: {
          stringValue?: string;
          intValue?: number;
          boolValue?: boolean;
          doubleValue?: number;
        };
      }>;
    };
    scopeMetrics: Array<{
      scope: {
        name: string;
        version?: string;
      };
      metrics: OtelMetricItem[];
    }>;
  }>;
}

export interface RunWithToolsStep {
  stepIndex: number;
  assistantMessage: ChatMessage;
  toolCalls: ToolCall[];
  toolResults: ChatMessage[];
  durationMs: number;
  usage?: ApiUsage;
}

export interface RunWithToolsOptions
  extends CreateChatCompletionRequestNonStreaming {
  /**
   * Maximum number of autonomous tool calling iterations before returning.
   * Default: 5
   */
  maxSteps?: number;
  /**
   * Optional custom McpToolBridge instance. If omitted, uses client.mcp.
   */
  mcpBridge?: import('../core/McpBridge.js').McpToolBridge;
  /**
   * Callback executed after each tool-calling step.
   */
  onStep?: (step: RunWithToolsStep) => void | Promise<void>;
  /**
   * Optional execution timeout in milliseconds for each tool invocation.
   */
  toolTimeoutMs?: number;
}

export interface RunWithToolsResult {
  response: UnifiedApiResponse;
  messages: ChatMessage[];
  steps: RunWithToolsStep[];
  totalSteps: number;
  totalTokens: number;
  totalCostUsd?: number;
}

export {
  type McpContent,
  type McpImageContent,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpResourceContent,
  type McpTextContent,
  type McpTool,
  McpToolBridge,
  type McpToolContext,
  type McpToolDefinition,
  type McpToolHandler,
  type McpToolInputSchema,
  type McpToolResult,
} from '../core/McpBridge.js';

export {
  GatewayRateLimitError,
  GatewayRateLimiter,
} from '../core/RateLimiter.js';

export type { RouterOptions } from '../core/Router.js';
export type {
  ExtendedPIIGuardrailsOptions,
  SinapsClientOptions,
} from '../core/SinapsClient.js';
