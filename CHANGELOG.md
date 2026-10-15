# Changelog

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
