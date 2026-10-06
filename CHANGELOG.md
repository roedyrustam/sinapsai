# Changelog

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
