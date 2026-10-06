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

## Phase 3: Optimizations & Enterprise (v1.2 - v2.0) - *Completed*
- [x] *Cost-Based Routing* (`lowest-cost` sorting provider via `costPer1kTokens`).
- [x] Tool Calling / Function Calling schema mapping (`tools`, `tool_choice`).
- [x] Structured Output JSON schema enforcement (`responseFormat: { type: 'json_object' }`).
- [x] Dukungan eksekusi dan sertifikasi di Edge Runtime (Cloudflare Workers, Bun, Deno).

