# Roadmap & Progress (SinapsAI)

## Phase 1: MVP (v1.0.0) - *Completed*
- [x] Inisialisasi proyek TypeScript & konfigurasi (Biome linter).
- [x] Definisi skema Unified API (mengikuti standar format OpenAI).
- [x] Implementasi routing core dan HTTP client native (`fetch`).
- [x] Integrasi provider utama: OpenAI, Anthropic, Gemini, Groq, OpenRouter.
- [x] Implementasi `In-Memory Circuit Breaker` & Automated Fallback.
- [x] Rilis versi alpha lokal & pengujian komprehensif (58 unit tests).

## Phase 2: Advanced Features & DX (v1.1 - v1.2) - *Completed*
- [x] Dukungan Server-Sent Events (SSE) Streaming untuk semua provider via native async iterator.
- [x] Load balancing requests ke multiple API keys (algoritma Round-Robin).
- [x] Model Translation & Cross-Provider Mapping (`modelMap`, `defaultModel`).
- [x] Circuit Breaker recovery threshold (`recoverySuccessThreshold`).
- [x] Retries dengan Exponential Backoff & Jitter untuk transient errors (5xx/timeouts/429).
- [x] In-Memory Response Caching (Prompt Hash Cache) dengan TTL.
- [x] Event Hooks lengkap (`onSuccess`, `onFallback`, `onCircuitOpen`, `onCircuitClose`, `onRateLimit`, `onRetry`).
- [x] Downstream `AbortSignal` propagation.

## Phase 3: Optimizations & Enterprise (v1.2 - v1.5) - *Completed*
- [x] *Cost-Based Routing* (`lowest-cost` sorting provider via `costPer1kTokens` & Dual-Pricing `promptCostPer1k`/`completionCostPer1k`).
- [x] Tool Calling / Function Calling schema mapping (`tools`, `tool_choice`).
- [x] Structured Output JSON schema enforcement (`responseFormat: { type: 'json_object' }`).
- [x] Dukungan eksekusi dan sertifikasi di Edge Runtime (Cloudflare Workers, Bun, Deno).
- [x] Vector Embeddings Unified API dengan Multi-Provider Failover & Caching.
- [x] Adaptive Rate-Limiting & Proactive Throttling (`x-ratelimit-*`, `retry-after`).
- [x] In-Process Telemetry Cumulative Tracker (`client.getMetrics()`).

## Phase 4: Extended Ecosystem & Enterprise Control Plane (v1.6.0) - *Completed*
- [x] Integrasi native Mistral AI (`MistralProvider`: Chat, Embeddings, Tools, JSON, Rate Limits).
- [x] Integrasi Google Gemini Embeddings (`GeminiProvider.generateEmbedding`: Single & Batch text-embedding-004).
- [x] In-process Circuit Breaker Inspection (`client.getCircuitBreakerStatus()`).
- [x] Manual Circuit Breaker Recovery (`client.resetCircuitBreaker()`).
- [x] In-process Cache Purge API (`client.clearCache()`).
- [x] 100% Biome Clean & 108/108 Tests Passed.

## Phase 5: Frontier Model Expansion & Zero-Cost Routing (v1.7.0) - *Completed*
- [x] Integrasi OpenRouter Free Models Tier (`createOpenRouterFreeProvider`, penjejakan biaya $0 otomatis, rantai fallback models native, header peringkat leaderboard OpenRouter, live discovery model).
- [x] Integrasi Resmi Model Google Gemini 2.5 & 3.x (`GEMINI_MODELS`: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3.8-flash`, `gemini-flash-latest`, `gemini-embedding-001`, `gemini-embedding-2`).
- [x] Extended Thinking & Reasoning Budget Gemini (`thinkingBudget` -> `thinkingConfig`, ekstraksi token penalaran ke `message.reasoning_content`).
- [x] Pengaturan Keamanan Gemini (`safetySettings` / `GeminiSafetySetting[]`).
- [x] MRL Embeddings dengan reduksi dimensi vektor (`dimensions` -> `outputDimensionality`).
- [x] Ekstraksi Header Rate-Limit Gemini untuk proactive throttling.
- [x] Penemuan Model Live Gemini (`GeminiProvider.fetchAvailableModels()`).
- [x] 119/119 Tests Passed, 100% Biome Clean, Siap Rilis ke NPM v1.7.0.

## Phase 6: Superintelligence Edition & Latency-Based Control Plane (v2.0.0) - *Completed*
- [x] **Groq Cloud LPU Hardening**: Penyelarasan penuh dengan dokumentasi resmi Groq Cloud (`llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`), parser durasi rate limit (`parseDurationMs` untuk `7.66s`, `2m59.56s`, `120ms`), sanitasi parameter `messages[].name`, dan clamping `temperature: 0` ke `1e-8`.
- [x] **Universal Frontier Reasoning Engine**: Standarisasi penalaran mendalam dan Chain-of-Thought di seluruh provider:
  - Claude 3.7 Sonnet (`thinkingBudget`, `temperature: 1.0`, `max_tokens > budget`, streaming `thinking_delta`).
  - OpenAI o1, o3, o3-mini, o4 (`reasoningEffort: 'low' | 'medium' | 'high'`, `max_completion_tokens`).
  - Groq & DeepSeek R1 (`reasoning_content` extraction).
  - Google Gemini 2.0 / 2.5 / 3.x Flash Thinking (`thinkingBudget`).
- [x] **Latency-Based Dynamic Routing Strategy (`lowest-latency`)**: Penentuan rute cerdas berbasis moving average latency dengan auto-probe unprobed providers dan failover otomatis.
- [x] **KV-Cache & Prompt Caching Analytics**: Penjejakan `cachedPromptTokens` per provider dan global (`totalCachedPromptTokens` di `getMetrics()`) untuk mengaudit penghematan biaya token 70-90%.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 12 (`examples/12-groq-lightning-fast-reasoning.ts`) dan contoh 13 (`examples/13-superintelligence-latency-and-reasoning.ts`).
- [x] 134/134 Tests Passed di 15 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.0.0.


