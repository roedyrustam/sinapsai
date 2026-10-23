# Changelog

## [2.9.0] - 2026-10-23
### Added
- **Gemini Agent Booster & KV-Cache Prefix Optimizer (`GeminiAgentBooster`, `canonicalizeJsonValue`)**:
  - **Dynamic Thinking Budget Allocation (`thinkingBudget: 'auto'`)**: Automatically analyzes prompt complexity (context length, code/math blocks, architectural/debugging signals, tool count, JSON schema enforcement, and turn depth) and maps it to optimal token budgets (`0`, `2048`, `8192`, or `32768`) across `GeminiProvider`, `AnthropicProvider`, and `XAiProvider`.
  - **Deterministic KV-Cache Prefix Pinning (`canonicalizeTools`, `canonicalizeRequest`)**: Lexicographically sorts tool definitions by `function.name` and recursively sorts `parameters` JSON schema keys so identical tool sets always generate byte-identical prefixes for 75%–90% prompt cache hits and exact router cache hits.
  - **Context Cache Eligibility Analyzer (`evaluateContextCacheEligibility`)**: Estimates static prefix tokens (system instructions + canonical tool schemas) and reports eligibility and FinOps savings ratio against the 32,768-token threshold.
- **Streaming Autonomous Multi-Step Agent Loop (`client.runWithToolsStream()`)**:
  - Async generator (`AsyncGenerator<AgentStreamEvent, RunWithToolsResult>`) yielding real-time events (`step-start`, `text-delta`, `reasoning-delta`, `tool-call-start`, `tool-call-result`, `step-finish`, and `done`).
  - Reconstructs fragmented `tool_calls` arguments across arbitrary SSE chunks, invokes registered MCP tools via `McpToolBridge`, appends `role: 'tool'` results to conversation history, and tracks `totalTokens` and `totalCostUsd`.
- **Streaming Reversible PII Tokenization Vault (`PIIGuardrails.restoreStream`, `createStreamTextRestorer`)**:
  - Stateful sliding-window detokenizer that restores surrogate PII tokens (`{{PII_EMAIL_1}}`, etc.) across arbitrary SSE chunk boundaries with 0ms buffering delay for normal text.
  - Automatically enabled in `SinapsClient.chat.completions.create({ stream: true })` when `piiGuardrails: { reversible: true }` is configured.
  - Deterministic left-to-right surrogate token index assignment (`_1`, `_2`) in `PIIGuardrails.tokenize()`.
- **Runnable Example 28 (`examples/28-gemini-agent-booster-and-streaming-agent.ts`)**:
  - End-to-end showcase of `GeminiAgentBooster`, `thinkingBudget: 'auto'`, Streaming Reversible PII Vault, and `client.runWithToolsStream()`.

## [2.8.1] - 2026-10-23
### Added
- **Gemini 4 Argon & Availability Fallback Invariant (`GEMINI_MODELS.ARGON_4`, `GEMINI_AVAILABILITY_FALLBACKS`)**:
  - Added canonical `GEMINI_MODELS.ARGON_4` (`'gemini-4-argon'`) and `GEMINI_MODELS.FLASH_3_8` (`'gemini-3.8-flash'`) constants with built-in 2026 pricing in `GEMINI_DEFAULT_PRICING`.
  - Added automatic availability fallback matrix (`GEMINI_AVAILABILITY_FALLBACKS`) and `enableAvailabilityFallback` option in `GeminiProvider`, degrading `gemini-4-argon`, `gemini-4-pro`, and `gemini-4-flash` seamlessly to `gemini-3.8-flash` (and `gemini-2.0-flash`) when unprovisioned or rate-limited.
- **Provider Attribution on Streaming Chunks (`chunk.provider`)**:
  - Enriched `UnifiedApiStreamChunk` with optional `provider?: string` property so streaming consumers and rate limiters know the exact provider ID serving each stream chunk.
### Fixed
- **Gemini Frontier Options Forwarding (`SinapsClient` & Vercel AI SDK Adapter)**:
  - Forwarded `cachedContent`, `googleSearch`, and `codeExecution` through `SinapsClient.chat.completions.create()` and `SinapsModelSettings` (`SinapsLanguageModel`) so native Google Context Caching, Live Search Grounding, and Python Code Execution Sandbox work end-to-end.
- **Multimodal Prompt Injection Inspection (`SecurityGuardrails.scanMessages`)**:
  - Extended `SecurityGuardrails` to inspect and sanitize text parts inside multimodal `ContentPart[]` arrays, closing a security bypass where prompt injections or custom blocked patterns embedded in multimodal messages could evade detection.
- **Collision-Resistant 64-Bit Cache Keys (`Router.computeCacheKey`, `Router.computeEmbeddingCacheKey`)**:
  - Upgraded exact cache hashing from 32-bit DJB2 to a 64-bit dual-hash (`hashString64`) and included `tools`, `toolChoice`, `responseFormat`, `thinkingBudget`, `reasoningEffort`, `cachedContent`, `googleSearch`, and `codeExecution` in `computeCacheKey` (plus `dimensions` in `computeEmbeddingCacheKey`) to prevent cross-configuration cache collisions.
- **Provider-Scoped Rate Limiting & Streaming Token Balancing (`GatewayRateLimiter`, `SinapsClient`)**:
  - Added `Router.getPrimaryCandidateProviderId()` and prefix-aware `GatewayRateLimiter.matchProviderRule()` (e.g., matching `'groq'` against auto-generated `'groq-xxx'` provider IDs) so `providerRules` enforce and adjust tokens accurately across both non-streaming and streaming completions.
- **Gemini Embedding API Key Security & Timeout (`GeminiProvider.generateEmbedding`)**:
  - Removed API key leakage from the query string (`?key=...`) in `GeminiProvider.generateEmbedding`, sending credentials exclusively via the `x-goog-api-key` HTTP header, and added `AbortController` timeout enforcement (`timeoutMs`) with `linkAbortSignal` cleanup.

## [2.8.0] - 2026-10-20
### Added
- **In-Process Model Context Protocol (MCP) Tool Bridge (`McpToolBridge`)**:
  - Zero-dependency in-process MCP registry for registering local tools with JSON Schemas and asynchronous execution handlers.
  - Bi-directional schema conversion between MCP `McpTool` and OpenAI/Unified `ToolDefinition` formats (`bridge.toUnifiedTools()`, `bridge.getTools()`, `McpToolBridge.toToolDefinition()`, `McpToolBridge.fromToolDefinition()`).
  - Error-resilient execution: `bridge.executeToolCall()` and `bridge.executeToolCalls()` parse arguments safely, invoke handlers, and catch errors gracefully (`isError: true`) without crashing the process.
  - Standard Model Context Protocol JSON-RPC 2.0 protocol dispatching (`bridge.handleJsonRpc()`) supporting `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, and `ping`, enabling direct plug-and-play integration with external MCP clients (Claude Desktop, Cursor, Antigravity) and Stdio/SSE worker processes.
  - Configurable tool execution timeout (`timeoutMs` per tool definition, `toolTimeoutMs` in agent loop) racing tool execution against a timer to prevent runaway promises.
  - Bulk registration (`bridge.registerTools()`) and `bridge.size` property for convenient inspection.
  - Immediate `AbortSignal` checking before and during tool execution.
- **Autonomous Multi-Step Agent Tool-Calling Loop (`client.runWithTools()`)**:
  - High-level ergonomic method automating multi-step tool-calling workflows: iteratively queries LLM models, invokes requested MCP tools, feeds results back into conversation history (`role: 'tool'`), and returns the final response, reconstructed messages, and accurate `totalCostUsd`.
  - Granular control with `maxSteps` (default: 5) to guard against runaway loops.
  - Real-time step telemetry with `onStep` callbacks emitting `stepIndex`, `assistantMessage`, `toolCalls`, `toolResults`, `durationMs`, and token `usage`.
  - Accessible directly on `SinapsClient` via `client.mcp` and `client.runWithTools()`.
- **Reasoning Content & Streaming Usage Extraction in Ollama & Mistral**:
  - `OllamaProvider`: Extract `reasoning_content` in both non-streaming completions and streaming chunks for DeepSeek-R1 and reasoning models running locally.
  - `OllamaProvider`: Added streaming usage tracking (`stream_options: { include_usage: true }`, `prompt_eval_count`, `eval_count`) ensuring accurate sliding-window token adjustment.
  - `MistralProvider`: Added `reasoning_content` support and streaming usage extraction.
- **Runnable Example 27 (`examples/27-mcp-tool-bridge-and-agent-loop.ts`)**:
  - Comprehensive demonstration of in-process MCP tool registration, bi-directional schema conversion, JSON-RPC 2.0 dispatching, and live autonomous agent loop.
### Fixed
- **Adaptive Routing Sub-Millisecond Latency Clamp (`Router.calculateAdaptiveScore`)**:
  - Replaced falsy logical OR (`pm.averageLatencyMs || 200`) with nullish coalescing (`pm.averageLatencyMs !== undefined ? pm.averageLatencyMs : 200`), ensuring 0ms and sub-millisecond responses from ultra-fast local/mock providers clamp to the optimal 30ms floor instead of penalizing them with a 200ms default latency.
- **New Unit Tests**:
  - Added 29 new test cases across `McpBridge.test.ts`, `OllamaProvider.test.ts`, and `MistralProvider.test.ts` (total **387 tests** passing across **33 test suites** with 100% Biome cleanliness).

## [2.7.1] - 2026-10-20
### Added
- **Transparent Provider Attribution (`response.provider`)**:
  - Enriched `UnifiedApiResponse` with optional `provider?: string` property denoting the exact provider ID fulfilling the request across primary and fallback executions.
  - Automatically populated in single provider executions and speculative hedged requests (`raceResult.winnerProvider.id`).
- **Streaming Rate Limit Token Balancing**:
  - Implemented automatic token adjustment for streaming chat completions: wrapped streaming async generator tracks accumulated `usage` and invokes `adjustTokens()` in `finally` upon stream completion, preventing sliding-window token drift.
- **Observability Exporter Aliases (`toPrometheusMetrics`, `toOtelMetrics`)**:
  - Added ergonomic DX alias methods `client.toPrometheusMetrics()` and `client.toOtelMetrics()` across both `SinapsClient` and `Router`.
- **Public Type Re-Exports in `sinapsai/types`**:
  - Re-exported `SinapsClientOptions`, `RouterOptions`, `ExtendedPIIGuardrailsOptions`, `GatewayRateLimitError`, and `GatewayRateLimiter` directly from `src/types/index.ts` for clean, decoupled TypeScript imports.
### Fixed
- **Provider-Scoped Token Adjustment in `GatewayRateLimiter`**:
  - Added `providerId?: string` parameter to `adjustTokens(request, actualTokens, estimatedTokens, providerId?)` and synchronized `scopeKey` resolution with `check()`, ensuring provider-level rate limit rules adjust tokens accurately.

## [2.7.0] - 2026-10-20
### Added
- **In-Process Gateway Rate Limiting (`GatewayRateLimiter`, `GatewayRateLimitError`)**:
  - Zero-dependency sliding-window counter algorithm with sub-window counter weighting to eliminate boundary burst vulnerabilities.
  - Supports Requests Per Minute (RPM) and Tokens Per Minute (TPM) enforcement with automatic heuristic estimation and post-response token usage adjustment (`adjustTokens`).
  - Granular multi-tier rules: global default rules (`defaultRule`), model-specific caps (`modelRules`), provider caps (`providerRules`), and user/tenant partitioning via `keyGenerator` or `request.user`.
  - Configurable actions (`block` throwing `GatewayRateLimitError` or `warn` emitting `onGatewayRateLimitWarning`).
- **Native Prometheus & OpenMetrics Exporter (`exportPrometheusMetrics`)**:
  - Zero-dependency formatting utility `formatPrometheusMetrics` outputting standard OpenMetrics/Prometheus text exposition format.
  - Exposes counters for total requests, completion statuses, tokens (prompt, completion, cached), estimated cost (USD), and per-provider counters and latency gauges.
  - Accessible via `client.exportPrometheusMetrics()` and `router.exportPrometheusMetrics()` with customizable metric prefixes and static labels.
- **Native OpenTelemetry OTLP JSON Exporter (`exportOtelMetrics`)**:
  - Zero-dependency formatting utility `formatOtelMetrics` outputting OTLP v1 JSON `ResourceMetrics` schema directly sendable to any OpenTelemetry collector endpoint (`/v1/metrics`).
  - Accessible via `client.exportOtelMetrics()` and `router.exportOtelMetrics()` with configurable `serviceName`, `serviceVersion`, and custom resource attributes.
- **Native Anthropic Prompt Caching (`promptCaching`)**:
  - Added `promptCaching?: boolean | 'auto'` to `ProviderConfig` for Anthropic Claude.
  - Automatically injects `anthropic-beta: prompt-caching-2024-07-31` HTTP header and structures system prompts with `cache_control: { type: 'ephemeral' }` for prefixes >1,024 tokens.
  - Unified token extraction for `cache_creation_input_tokens` and `cache_read_input_tokens` mapped into `UnifiedApiUsage.cachedPromptTokens` across both non-streaming responses and streaming `message_start` / `message_delta` events.
- **Strict `HALF_OPEN` Canary Probing on `CircuitBreaker` (Anti-Thundering-Herd)**:
  - Enforced single-canary probe admission when recovering from `OPEN` to `HALF_OPEN`.
  - Concurrent requests arriving during canary probe execution are safely shielded (`cb:probe:${providerId}`) and routed to fallback providers via `isAvailable()`, preventing downstream thundering herd crashes.
  - Automatic probe lock cleanup across successes, failures, client aborts, and early stream cancellations.
- **Universal Signal Detach & Memory Safety (`linkAbortSignal`)**:
  - Added zero-dependency `linkAbortSignal` utility in `src/utils/signal.ts` to bridge external client signals with internal timeouts and downstream fetch controllers.
  - Guaranteed deterministic event listener removal in `finally` blocks across all 10 LLM providers (`OpenAiProvider`, `AnthropicProvider`, `GeminiProvider`, `DeepSeekProvider`, `GroqProvider`, `MistralProvider`, `OllamaProvider`, `OpenRouterProvider`, `XAiProvider`, `CohereProvider`).
  - Eliminates Node.js `MaxListenersExceededWarning` and prevents memory leaks in high-concurrency and long-running production environments.
- **Early Stream Consumer Abort & Resource Severing**:
  - Integrated `finally { controller.abort(); cleanupSignal?.(); }` inside streaming async generators across all providers.
  - Breaking or exiting early from an async stream consumer loop (`for await (const chunk of stream) { break; }`) immediately terminates the underlying upstream HTTP connection to eliminate wasted tokens and server bandwidth.

## [2.6.0] - 2026-10-18
### Added
- **Gemini 4.x & Frontier Model Alignment (2026 Edition)**:
  - Added canonical model constants in `GEMINI_MODELS`: `PRO_4` (`gemini-4-pro`), `FLASH_4` (`gemini-4-flash`), `PROJECT_ASTRA` (`gemini-4-flash`), `FLASH_2_0` (`gemini-2.0-flash`), `FLASH_2_0_LITE` (`gemini-2.0-flash-lite`), and `FLASH_THINKING_2_0` (`gemini-2.0-flash-thinking-exp`).
  - Added built-in 2026 default pricing map (`GEMINI_DEFAULT_PRICING`) for automated cost tracking across all Gemini models without requiring manual provider configuration.
- **Native Google Context Caching (`cachedContent`)**:
  - Injected `cachedContent` directly into request payloads for sub-second TTFT and up to 75%–90% cost savings on long contexts (>32k tokens).
  - Implemented zero-dependency Context Caching lifecycle methods on `GeminiProvider`: `createCachedContent()`, `getCachedContent()`, `listCachedContents()`, and `deleteCachedContent()`.
- **Live Google Search Grounding & Dynamic Citations**:
  - Added `googleSearch: true` request option to inject `{ googleSearch: {} }` into Gemini tools.
  - Automatically extracts `candidate.groundingMetadata` (queries, sources, URLs, titles) into `response.grounding` and `message.grounding`.
- **Python Code Execution Sandbox**:
  - Added `codeExecution: true` request option to enable Gemini server-side Python sandbox execution.
  - Formats `executableCode` and `codeExecutionResult` seamlessly into response choices and stream deltas.
- **Universal Reasoning Mapping (`reasoningEffort`)**:
  - Automatically maps `reasoningEffort` (`'low'` -> 2048, `'medium'` -> 8192, `'high'` -> 32768 tokens) to `thinkingConfig.thinkingBudget` for Gemini models when `thinkingBudget` is omitted.
  - Added robust CoT reasoning token extraction supporting both string thoughts and boolean `part.thought`.
- **Multimodal Extension**:
  - Expanded native media file detection in `GeminiProvider` to support documents (`application/pdf`), video (`video/mp4`, `video/webm`), and audio (`audio/mp3`, `audio/wav`).
- **FinOps 75% KV-Cache Pricing Discount in Router**:
  - Updated cost calculations in `Router.ts` (streaming & non-streaming) to factor in the 75% KV-cache discount on `cachedPromptTokens`, providing accurate real-world spend metrics.
### Fixed
- **Turn Alternation in Parallel Tool Execution**:
  - Merged multiple consecutive `role: 'tool'` messages into a single `user` turn containing multiple `functionResponse` parts, eliminating HTTP 400 turn alternation errors on Gemini endpoints.

## [2.5.0] - 2026-10-17
### Added
- **In-Process Dynamic Context Compressor (`ContextCompressor`)**:
  - Zero-dependency token estimation (`estimateMessageTokens`, `estimateTotalTokens`) and atomic tool-call group preservation.
  - Supports `'sliding-window'` and `'middle-out'` context truncation strategies while preserving `system` instructions and preventing orphaned `tool` messages.
- **FinOps Budget Enforcement & Spend Guardrails (`BudgetOptions`, `BudgetExceededError`)**:
  - Configurable hard limits (`maxCostUsd`, `maxTotalTokens`) with automatic pre-flight request blocking (`action: 'block'`) and dynamic warning callbacks (`action: 'warn'`, `onBudgetWarning`).
- **Gemini Provider Security & Structured Outputs Hardening**:
  - Migrated API key authentication from URL query string (`?key=`) to secure `x-goog-api-key` HTTP header across chat, streaming, embeddings, and model discovery.
  - Added full `json_schema` support mapped to `generationConfig.responseSchema` (with automatic `additionalProperties` sanitization).
  - Added `toolChoice` mapping (`auto`, `none`, `required`, and named function) to `toolConfig.functionCallingConfig`.
  - Added automatic `tool_call_id` to function name resolution from assistant history when `msg.name` is omitted.
- **Anthropic Provider Multi-Tool & JSON Schema Enhancements**:
  - Automatically merges consecutive `role: 'tool'` results into a single `user` message content array to prevent HTTP 400 alternation errors during parallel tool execution.
  - Added native `responseFormat` (`json_object` and `json_schema`) system prompt enforcement and `toolChoice: 'none'` handling.
- **DeepSeek Streaming Telemetry & SSE Buffer Flushing**:
  - Enabled `stream_options: { include_usage: true }` and usage chunk extraction (`cachedPromptTokens`) in `DeepSeekProvider` streams.
  - Enhanced `parseSSE` in `src/utils/stream.ts` to flush trailing buffered lines on stream completion.
  - Enhanced `extractJsonFromText` in `src/utils/structuredOutput.ts` with a string-aware balanced bracket scanner.
  - Added RFC 7231 HTTP-date parsing support to `Retry-After` in `parseRateLimitHeaders`.

## [2.4.0] - 2026-10-16
### Added
- **Virtual Model Aliases (`modelAliases`)**: Decouple application logic from vendor strings via runtime alias mapping (`setModelAlias`, `getModelAliases`).
- **Gateway Health Checks & Liveness Probes (`client.checkHealth`)**: Passive circuit state inspection and active 1-token heartbeat pings for Kubernetes/microservices readiness.
- **In-Process Security Guardrails (`SecurityGuardrails`)**: Zero-dependency prompt injection, jailbreak (DAN), delimiter hijacking, and system prompt exfiltration defense (`block`, `sanitize`, `warn`).

## [2.3.0] - 2026-10-16
### Added
- **Adaptive & Smart-Hybrid Dynamic Routing (`strategy: 'adaptive'`)**: Real-time composite provider scoring combining Laplace-smoothed reliability, moving-average latency, and dual-token cost efficiency.
- **Reversible PII Tokenization & Response Vault (`reversible: true`)**: Replaces sensitive PII with deterministic placeholders (`{{PII_EMAIL_1}}`) before LLM dispatch and automatically restores original values in responses.
- **Streaming Tool Call Accumulator (`accumulateStream`)**: Reconstructs streamed text, reasoning tokens, and chunked multi-tool calls into a complete `UnifiedApiResponse`.
- **Resilient Structured JSON Output Extraction (`extractJsonFromText`, `tryExtractJson`)**: Extracts and parses JSON payloads from markdown code blocks and conversational responses.

## [2.2.0] - 2026-10-15
### Added
- **Distributed Edge & Cluster Storage Adapters**: Zero-dependency `CloudflareKVStorage`, `RedisStorage` (Redis/Upstash/Valkey), and `D1Storage` (Cloudflare D1 SQL with auto-migration).
- **Zero-Dependency In-Process PII Guardrails (`PIIGuardrails`)**: Automatic detection and redaction for email, phone, Luhn-validated credit cards, SSN, IP address, IBAN, passport, JWT, and URLs.

## [2.1.0] - 2026-10-15
### Added
- **Official Vercel AI SDK Ecosystem Adapter (`sinapsai/ai-sdk`)**:
  - Implemented the Vercel AI SDK `LanguageModelV1` and `EmbeddingModelV1` specifications with zero external runtime dependencies.
  - Exported subpath `./ai-sdk` in `package.json` (`import { createSinapsAI, sinapsai } from 'sinapsai/ai-sdk'`) and root exports.
  - Full drop-in compatibility with Vercel AI SDK core functions: `streamText`, `generateText`, `streamObject`, `generateObject`, and Next.js 15 Route Handlers.
  - Seamless multi-modal prompt conversion: translates `LanguageModelV1Prompt` (system, user, assistant, tool, images, audio) into unified `ChatMessage[]`.
  - Transparent in-process resilience: requests invoked through Vercel AI SDK automatically benefit from SinapsAI's in-memory Circuit Breaker, automated multi-provider failover, hierarchical model fallback, lowest-latency routing, and semantic cache.
  - Deep Reasoning deltas: streams reasoning tokens (`type: 'reasoning'`) for Claude 3.7 Sonnet, Gemini Flash Thinking, DeepSeek R1, and Groq directly into Vercel AI SDK streams.
  - Full tool calling support: streaming `tool-call` and `tool-call-delta` events for autonomous multi-step agentic execution.
  - Vector embeddings integration: `sinaps.textEmbeddingModel()` and `sinaps.embedding()` conforming to `EmbeddingModelV1`.
  - Added runnable example `examples/16-vercel-ai-sdk-adapter.ts` and 13 unit tests in `src/ai-sdk/index.test.ts`.
  - Expanded test suite to 182 passed tests across 18 test suites with 100% pass rate.

## [2.0.1] - 2026-10-15
### Added
- **Ecosystem-Wide KV-Cache & Prompt Caching Unification**:
  - **DeepSeek Provider**: Extracted `prompt_cache_hit_tokens` and `prompt_tokens_details.cached_tokens` into `usage.cachedPromptTokens`, enabling audit of DeepSeek's KV cache discount in metrics.
  - **OpenRouter Provider**: Added multi-strategy cached token extraction supporting `prompt_tokens_details.cached_tokens`, `prompt_cache_hit_tokens`, and calculated tokens from `cache_discount`. Also added extraction of `reasoning_content` in both `formatResponse` and streaming delta.
  - **Gemini Provider**: Standardized `usageMetadata.cachedContentTokenCount` to `usage.cachedPromptTokens`.
  - **Groq & Mistral Providers**: Extracted `prompt_tokens_details.cached_tokens` into `usage.cachedPromptTokens`.
- **Streaming Error Resilience & Circuit Breaker Hardening**:
  - Implemented mid-stream error trapping inside the async generator in `CircuitBreaker.ts`. Mid-stream connection resets and network drops now accurately trigger `recordFailure` and trip the circuit breaker if the failure threshold is reached.
  - Corrected `recordSuccess` timing for streaming so that success is registered upon full stream delivery rather than prematurely on the first chunk.
  - Added client-side abort protection: downstream cancellation via `AbortController` (`AbortError` or `request.signal.aborted`) is gracefully handled and exempted from penalizing provider reliability in the Circuit Breaker.
- **Streaming Telemetry & TTFT (Time To First Token) Analytics**:
  - Intercepted streaming responses in `Router.ts` to accumulate token usage, cached tokens, and compute real-time TTFT and total stream duration.
  - Added `onStreamSuccess?: (provider: Provider, ttftMs: number, totalLatencyMs: number) => void` hook to `SinapsEventHooks`.
  - Added `usage` field to `UnifiedApiStreamChunk` and enabled `stream_options: { include_usage: true }` / stream usage parsing across OpenAI, Groq, Anthropic, Gemini, and OpenRouter.
- **Universal Multi-Modal Content Support (`ContentPart[]`)**:
  - Enhanced `ChatMessage.content` to support both traditional `string` and structured multi-modal `ContentPart[]` (`TextContentPart`, `ImageUrlContentPart`, `InputAudioContentPart`).
  - **Anthropic Provider**: Automatically translates `image_url` parts to native Anthropic content blocks, converting base64 data URLs (`data:image/...;base64,...`) into base64 image sources and external links into URL image sources.
  - **Gemini Provider**: Formats `ContentPart[]` into Google AI `parts`, mapping base64 images and audio to `inlineData` and URLs to `fileData`.
  - **Router Cost Estimation**: Updated `estimateRequestCost` to parse `ContentPart[]`, calculating token costs from text parts while gracefully supporting multimodal payloads.
- **Hierarchical Model-Level Fallback Engine**:
  - Implemented multi-tier hierarchical resilience: attempts candidate model fallbacks within the active provider before escalating to provider-level failover.
  - Configurable across 3 levels: request-level (`request.fallbackModels`), provider-level (`ProviderConfig.fallbackModels`), and client-level (`SinapsClientOptions.fallbackModels`).
  - Added `onModelFallback?: (error: Error, provider: Provider, fromModel: string, toModel: string) => void` observability hook to monitor model downgrades in real time.
  - Fast-failover protection: detects 401 Unauthorized / authentication failures and halts further model attempts on the compromised provider, failing over immediately.
  - Circuit Breaker alignment: successful fallback models record success and preserve provider health.
- **Zero-Dependency Semantic In-Process Response Caching**:
  - Implemented high-performance in-process vector similarity search via pure TypeScript cosine similarity (`cosineSimilarity` and `extractPromptText`) with zero runtime dependencies.
  - Added `semantic: SemanticCacheOptions | boolean` configuration to `CacheOptions`, with customizable `similarityThreshold` (default: 0.90), `embeddingModel`, `maxEntries` (default: 1000), and `customEmbed` function.
  - Sub-millisecond similarity scoring: queries are evaluated in-memory against active semantic cache vectors, returning cached responses for semantically equivalent queries phrased differently.
  - Added `onSemanticCacheHit?: (request: UnifiedApiRequest, cachedResponse: UnifiedApiResponse, similarity: number) => void` hook to inspect real-time similarity percentages on semantic cache hits.
  - Integrated with `router.clearCache()` to simultaneously flush both exact hash key storage and semantic vector indices.
- **Concurrent In-Process Batch Processing Engine (`client.batch`)**:
  - Implemented high-throughput, zero-dependency async worker pool in `BatchExecutor.ts` with configurable `concurrency` (default: 4), live `onProgress` callbacks, and `AbortSignal` cancellation support.
  - Added fail-soft settled mode (`stopOnError: false`, default) and fail-fast mode (`stopOnError: true`, throwing typed `BatchExecutionError`).
  - Integrated into `SinapsClient.batch`:
    - `client.batch.chat(requests, options)`: Concurrent execution of bulk chat completions across router failover, circuit breakers, and semantic cache.
    - `client.batch.embeddings(requests, options)`: Concurrent execution of bulk text embeddings.
    - `client.batch.create(items, handler, options)`: Generic concurrency executor for custom async tasks.
  - Added runnable example `examples/15-concurrent-batch-processing.ts` and test suite in `src/core/BatchExecutor.test.ts`.
- **Test Suite Expansion**: Added unit tests verifying mid-stream failure, abort exemptions, streaming token accumulation, TTFT hooks, multi-modal formatting, hierarchical model-level fallbacks, semantic cosine caching, and batch execution, expanding test coverage to 169 tests across 17 test suites with 100% pass rate.

## [2.0.0] - 2026-10-13 — Superintelligence Edition
### Added
- **Groq Cloud LPU Integration Hardening**:
  - Full alignment with Groq Cloud API specifications (`https://console.groq.com/docs/overview`).
  - Support for Groq high-speed LPU models: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `llama-3.1-8b-instant`.
  - Human-readable duration rate-limit header parsing in `src/utils/rateLimit.ts` (`parseDurationMs`) supporting formats like `7.66s`, `2m59.56s`, `1h20m`, and `150ms` (extracting `x-ratelimit-reset-tokens` and `x-ratelimit-reset-requests`).
  - Automatic parameter sanitization: stripped unsupported `messages[].name` (preventing Groq 400 Bad Request errors) and clamped `temperature: 0` to `1e-8`.
  - Reasoning support via `reasoning_format: 'parsed'` and extraction of both `message.reasoning` and `<think>` tags into `message.reasoning_content`.
  - Added `examples/12-groq-lightning-fast-reasoning.ts` with 12 comprehensive unit tests.
- **Universal Frontier Reasoning Engine**:
  - Standardized cross-provider chain-of-thought and thinking budgets across all frontier AI models:
    - **Anthropic Claude 3.7 Sonnet**: Supported `thinkingBudget`, configuring `thinking = { type: 'enabled', budget_tokens }`, enforcing `temperature: 1.0`, allocating `max_tokens > budget_tokens`, and streaming `thinking_delta` into `delta.reasoning_content`.
    - **OpenAI o1 / o3 / o3-mini / o4**: Added `reasoningEffort: 'low' | 'medium' | 'high'`, mapping to `reasoning_effort` and `max_completion_tokens` (with automatic temperature omission).
    - **DeepSeek R1 & Groq**: Unified extraction into `message.reasoning_content`.
    - **Google Gemini 2.0 / 2.5 / 3.x Flash Thinking**: Mapped to native `thinkingConfig`.
- **Latency-Based Dynamic Routing Strategy (`lowest-latency`)**:
  - Added `'lowest-latency'` routing mode to `RouterStrategy`.
  - Dynamically routes requests to the fastest provider based on running average response latency.
  - Intelligent probe mechanism prioritizing unprobed providers on startup to discover baseline latencies before routing based on moving averages.
  - Seamless fallback to second-fastest provider if the fastest provider fails or trips its circuit breaker.
- **KV-Cache & Prompt Caching Optimization Analytics**:
  - Tracking of `cachedPromptTokens` across providers: Anthropic (`cache_read_input_tokens`), OpenAI (`prompt_tokens_details.cached_tokens`), and Gemini.
  - Extended in-process telemetry: `totalCachedPromptTokens` in `SinapsMetrics` and `cachedPromptTokens` in `ProviderMetricEntry`, enabling teams to audit 70-90% cloud token cost savings from prompt caching.
- **Examples & Test Suite**:
  - Added `examples/13-superintelligence-latency-and-reasoning.ts` demonstrating multi-provider thinking budgets, lowest-latency routing, and KV-cache analytics.
  - Expanded test suite to 134 tests across 15 test suites with 100% pass rate.
  - Clean Biome lint validation and production dual ESM/CJS build.

## [1.7.0] - 2026-10-12
### Added
- **OpenRouter Free Tier Support (`createOpenRouterFreeProvider`)**:
  - Full integration with OpenRouter's Free Models catalog (`https://openrouter.ai/models?variant=free`).
  - Automatic zero-cost token accounting (`costPer1kTokens: 0`, `promptCostPer1k: 0`, `completionCostPer1k: 0`).
  - Meta-router default model `openrouter/free` and native fallback model chains via `fallbackModels` payload array parameter.
  - Attribution headers for OpenRouter leaderboard ranking (`siteUrl` mapped to `HTTP-Referer`, `siteName` mapped to `X-Title`).
  - Dynamic model discovery method `OpenRouterProvider.fetchFreeModels()` directly querying `/models` API.
  - Helper functions and constants: `createOpenRouterFreeProvider()`, `isOpenRouterFreeModel()`, `OPENROUTER_FREE_MODELS`.
  - Added runnable example `examples/10-openrouter-free-tier.ts`.
- **Google Gemini 2.5 & 3.x Models Integration (`GEMINI_MODELS`)**:
  - Official model catalog alignment with Google AI Developer documentation (`https://ai.google.dev/gemini-api/docs/models?hl=id`): `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3.8-flash`, `gemini-flash-latest`, `gemini-pro-latest`, `gemini-embedding-001`, `gemini-embedding-2`.
  - Intelligent default model resolution upgraded to `gemini-2.5-flash`.
  - Extended thinking / reasoning support (`thinkingBudget`) mapped to Gemini's `generationConfig.thinkingConfig`.
  - Automatic candidate thought extraction (`thought: true`) mapped directly into `message.reasoning_content`.
  - Custom safety threshold filtering (`safetySettings` / `GeminiSafetySetting[]`).
  - Matryoshka Representation Learning (MRL) embeddings support with dynamic dimensionality reduction (`dimensions` mapped to `outputDimensionality`).
  - Rate limit header extraction (`parseRateLimitHeaders`) for proactive throttling.
  - Live model discovery method `GeminiProvider.fetchAvailableModels()`.
  - Added runnable example `examples/11-gemini-models-and-thinking.ts`.
- **Test Suite Expansion**: Total tests increased from 108 to 119 across 15 test suites with 100% pass rate.

## [1.6.0] - 2026-10-12
### Added
- **Native Mistral AI Provider (`MistralProvider`)**: First-class support for Mistral AI models (`mistral-large-latest`, `codestral-latest`, `mistral-embed`) including chat completions, SSE streaming, tool calling, JSON schema enforcement, and rate limit extraction.
- **Gemini Embeddings (`GeminiProvider.generateEmbedding`)**: Direct support for Google Gemini embedding models (`text-embedding-004`) for single strings and batch string arrays (`embedContent` & `batchEmbedContents`).
- **Circuit Breaker Inspection & Reset APIs**: Added `client.getCircuitBreakerStatus()` returning detailed state (`CLOSED`, `OPEN`, `HALF_OPEN`), failure counts, and successes for each configured provider. Added `client.resetCircuitBreaker(providerId?)` for manual/programmatic circuit recovery.
- **In-Process Cache Control (`client.clearCache()`)**: Added `clearCache()` to programmatically purge all in-memory completion and embedding cached entries on demand.
- **Root `.gitignore`**: Standardized exclusion for `node_modules`, `dist`, `.env*`, and coverage artifacts.
- Added comprehensive unit test suites for MistralProvider, Gemini embeddings, and Circuit Breaker status APIs (108/108 tests passing).
- Added runnable example `examples/09-circuit-breaker-and-mistral.ts`.

## [1.5.0] - 2026-10-06
### Added
- **Dual-Token Pricing & Weighted Routing**: Added separate `promptCostPer1k` and `completionCostPer1k` configuration across all providers. The `lowest-cost` strategy now calculates dynamic weighted prompt/completion costs per query.
- **Adaptive Rate-Limit Headers & Proactive Throttling**: Universal parser `parseRateLimitHeaders` extracting `x-ratelimit-*`, `anthropic-ratelimit-*`, and `retry-after`. Proactively throttles exhausted providers before sending HTTP requests, preventing 429 errors.
- **In-Process Gateway Telemetry (`client.getMetrics()`)**: Real-time cumulative tracking for total requests, cache hits, token usage (prompt/completion), estimated USD spend, and per-provider latency/success/failure metrics.
- **Event Hook**: Added `onRateLimitWarning(provider, rateLimit)` to `SinapsEventHooks`.
- Added comprehensive unit test suite `MetricsAndRateLimit.test.ts` (98/98 tests passing).
- Added `examples/08-metrics-and-rate-limiting.ts`.
### Added
- **Unified Embeddings Control Plane**: Added `client.embeddings.create({ model, input })` with automatic multi-provider failover, load balancing, circuit breaker protection, and retries.
- **In-Memory Embedding Caching**: Exact input hash caching for embeddings to eliminate duplicate API costs and achieve sub-millisecond retrieval.
- **Provider Embedding Implementations**: Implemented `generateEmbedding` in `OpenAiProvider` and `OllamaProvider`.
- **Event Hook**: Added `onEmbeddingSuccess` event hook to `SinapsEventHooks`.
- Added comprehensive unit test suite `Embeddings.test.ts` (90/90 tests passing).
- Added `examples/07-embeddings-failover.ts`.

## [1.3.0] - 2026-10-06
### Added
- **Native DeepSeek Provider**: Added `DeepSeekProvider` supporting `deepseek-chat` (V3) and `deepseek-reasoner` (R1).
- **Reasoning Tokens Support**: Integrated `reasoning_content` across `ChatMessage`, `UnifiedApiResponse`, and streaming `UnifiedApiStreamChunk` for chain-of-thought models.
- **Native Ollama Provider**: Added first-class `OllamaProvider` for zero-configuration local models (Llama 3.2, Qwen 2.5, DeepSeek-R1-Distill, Mistral) with optional `apiKey` and automatic token usage resolution.
- Added comprehensive unit tests for `DeepSeekProvider` and `OllamaProvider` (81/81 total unit tests passing).
- Added `examples/06-deepseek-reasoner.ts` showcasing reasoning tokens and chain-of-thought workflows.

## [1.2.0] - 2026-10-06
### Added
- **Edge Runtime Certification**: 100% universal Web Standards execution certified for Cloudflare Workers, Bun, Deno, and Vercel Edge.
- Added `workerd` and `edge-light` export conditions in `package.json`.
- Added `autoSweep` configuration to `InMemoryStorage` for serverless and edge environments.
- Added Edge Runtime test suite (`EdgeRuntime.test.ts`) and Cloudflare Workers example (`examples/05-edge-cloudflare-worker.ts`).
- Added comprehensive unit tests for `tools`, `toolChoice`, and `responseFormat` across OpenAI, Groq, OpenRouter, and `SinapsClient`.

### Fixed
- Replaced Node-specific `NodeJS.Timeout` signatures with universal `ReturnType<typeof setTimeout>`.
- Safeguarded `unref()` handling in `InMemoryStorage` to avoid failures in non-Node runtimes.

## [1.0.0] - 2026-09-29
### Added
- Complete AI Gateway package with Providers (OpenAI, Anthropic, Gemini, Groq, OpenRouter).
- Advanced Circuit Breaker and Router functionality for fallback and load balancing.
- Extensible state storage architecture with `InMemoryStorage`.
- SSE Streaming capabilities for chunked AI generation.

### Fixed
- Fixed minor formatting warnings (Biome).
- Resolved unused imports and missing implicit type annotations.
- Eradicated all blocking tech debt from previous iteratives (Strict `any` type removal across all core and provider files).
- Fixed `useYield` and strict `NodeJS.Timeout` usage for intervals across core components.
