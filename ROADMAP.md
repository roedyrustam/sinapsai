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

## Phase 7: Semantic In-Process Caching, Concurrent Batching & Resilient Streaming Control Plane (v2.0.1) - *Completed*
- [x] **Zero-Dependency Semantic Response Caching**: Algoritma in-process cosine similarity murni (`cosineSimilarity` & `extractPromptText`), opsi konfigurasi `semantic: SemanticCacheOptions` (`similarityThreshold`, `maxEntries`, `embeddingModel`, `customEmbed`), serta hook observabilitas `onSemanticCacheHit`.
- [x] **Hierarchical Model-Level Fallback Engine**: Rantai model fallback berjenjang (request, provider, dan client) dengan fast-failover pada 401 Unauthorized dan hook `onModelFallback`.
- [x] **Universal Multi-Modal Content (`ContentPart[]`)**: Format payload OpenAI terpadu untuk `text`, `image_url` (URL & base64), dan `input_audio` yang dipetakan secara mulus ke Google Gemini dan Anthropic Claude.
- [x] **Concurrent In-Process Batch Processing Engine (`client.batch`)**: Worker pool konkuren tanpa dependensi eksternal untuk bulk chat completions (`client.batch.chat`), embeddings (`client.batch.embeddings`), dan task generik (`client.batch.create`) dengan kontrol konkurensi, pelaporan progres (`onProgress`), dan mode eksekusi terselesaikan bertoleransi kesalahan (*fail-soft settled mode*).
- [x] **Streaming Error Resilience & TTFT Telemetry**: Penjagaan mid-stream connection drop pada Circuit Breaker, registrasi `recordSuccess` pada penyelesaian penuh stream, pembebasan pembatalan klien (`AbortSignal`), dan telemetri Time-To-First-Token (`onStreamSuccess`) serta akumulasi token pada `UnifiedApiStreamChunk.usage`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 14 (`examples/14-semantic-caching-and-fallbacks.ts`) dan contoh 15 (`examples/15-concurrent-batch-processing.ts`).
- [x] 169/169 Tests Passed di 17 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.0.1.

## Phase 8: Vercel AI SDK Ecosystem Adapter & Control Plane (v2.1.0) - *Completed*
- [x] **Official Vercel AI SDK Ecosystem Adapter (`sinapsai/ai-sdk`)**: Implementasi spesifikasi resmi Vercel AI SDK `LanguageModelV1` dan `EmbeddingModelV1` murni tanpa runtime dependencies eksternal.
- [x] **Universal Stream & Reasoning Integration**: Aliran token delta terintegrasi (`text-delta`), penalaran mendalam (`type: 'reasoning'`), dan pelaporan token penggunaan (`usage`) yang kompatibel langsung dengan `streamText`, `generateText`, `streamObject`, dan `generateObject`.
- [x] **Multi-Modal & Tool Calling Streaming**: Konversi mulus `LanguageModelV1Prompt` (gambar base64, URL, audio) dan streaming `tool-call` / `tool-call-delta` untuk loop agen multi-langkah (`maxSteps`).
- [x] **Transparent In-Process Resilience**: Menjembatani seluruh keunggulan SinapsAI (In-Memory Circuit Breaker, Multi-Provider Failover, Lowest-Latency Routing, dan Semantic Cache) di balik antarmuka Vercel AI SDK.
- [x] **Vector Embeddings Unified AI SDK API**: `sinaps.textEmbeddingModel()` dan `sinaps.embedding()` untuk integrasi `embed` dan `embedMany`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 16 (`examples/16-vercel-ai-sdk-adapter.ts`) dan pengujian komprehensif di `src/ai-sdk/index.test.ts`.
- [x] 182/182 Tests Passed di 18 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.1.0.

## Phase 9: Distributed Edge Synchronization & In-Process PII Guardrails (v2.2.0) - *Completed*
- [x] **Cross-Worker / Distributed Storage Adapters**: Integrasi state circuit breaker dan cache metadata untuk Cloudflare KV (`CloudflareKVStorage`), Cloudflare D1 (`D1Storage`), dan Redis Cluster (`RedisStorage`) tanpa dependensi runtime eksternal.
- [x] **In-Process Zero-Dependency PII Guardrails (`PIIGuardrails`)**: Redaksi otomatis data sensitif (email, nomor telepon, kartu kredit dengan algoritma Luhn, SSN, IPv4/IPv6, nomor paspor, IBAN, JWT, dan URL).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 17 (`examples/17-distributed-storage-adapters.ts`), 25 unit test storage baru, 29 unit test PII baru, total 236/236 tes lulus.

## Phase 10: Adaptive Smart-Hybrid Routing & Reversible PII Vault (v2.3.0) - *Completed*
- [x] **Adaptive Multi-Factor Dynamic Routing (`strategy: 'adaptive'` / `'smart-hybrid'`)**: Algoritma perutean cerdas multi-faktor memadukan reliability (Laplace smoothed), moving latency, dan estimasi biaya per request secara real-time.
- [x] **Reversible PII Vault (`piiGuardrails: { reversible: true }`)**: Tokenisasi dua arah (`{{PII_EMAIL_1}}`) yang secara otomatis mendekripsi dan mengembalikan entitas PII asli ke dalam respons LLM non-streaming.
- [x] **Universal Text + Multi-Modal Part Helper (`client.chat.completions.createTextWithParts`)**: Helper pembantu perakitan pesan multimodal tanpa boilerplate.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 18 (`examples/18-adaptive-smart-hybrid-routing.ts`) dan contoh 19 (`examples/19-reversible-pii-vault.ts`), total 241/241 tes lulus.

## Phase 11: Security Guardrails, Model Aliases, Health Probes & Stream Accumulator (v2.4.0) - *Completed*
- [x] **In-Process Security Guardrails (`SecurityGuardrails`)**: Pertahanan lokal dari prompt injection, jailbreak ("DAN", "evil confidant"), manipulasi system role, delimiter hijacking, dan secret exfiltration (`block`, `sanitize`, `warn`).
- [x] **Dynamic Virtual Model Aliases (`modelAliases`)**: Pemetaan nama alias virtual ramah developer (misal: `{ 'fast': 'gpt-4o-mini', 'smart': 'claude-3-7-sonnet' }`).
- [x] **Proactive Gateway Health Probes (`client.checkHealth()`)**: Evaluasi liveness dan kesehatan provider secara pasif (circuit state, success rate) dan aktif (`ping: true`).
- [x] **Streaming Tool-Call Accumulator & Balanced JSON Extractor (`accumulateStream`, `extractJson`)**: Rekonstruksi otomatis aliran delta streaming SSE ke dalam objek respons lengkap dan parser JSON tahan-kesalahan (*fault-tolerant*).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 20, 21, dan 22; total 283/283 tes lulus.

## Phase 12: Context Compression, FinOps Budget Caps, Speculative Hedging & Frontier Providers (v2.5.0) - *Completed*
- [x] **In-Process Dynamic Context Compressor (`ContextCompressor`)**: Estimasi token zero-dependency (~4 chars per token) dan pemotongan percakapan otomatis (`sliding-window` & `middle-out`) dengan preservasi atomik grup `tool_calls` & `tool`.
- [x] **FinOps Spend & Token Guardrails (`BudgetGuardrails`)**: Pelacakan dan pembatasan batas kumulatif USD (`maxCostUsd`) dan volume token (`maxTotalTokens`) dengan mode `block` (`BudgetExceededError`) atau `warn`.
- [x] **Speculative Hedged Requests (`HedgedExecutor` & Client Option `hedging`)**: Luncurkan permintaan cadangan setelah ambang batas jeda delay (`delayMs`) guna memangkas latensi ekor (P99/P99.9) pada provider redundan, dengan pembatalan otomatis bagi request yang kalah cepat.
- [x] **Provider Frontier Baru (xAI Grok & Cohere v2)**: Integrasi kelas satu untuk xAI Grok (dengan `reasoningEffort`) dan Cohere v2 (Command A, Embed v4).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 23, 24, dan 25; total 320/320 tes lulus di 29 test suites, 100% Biome Clean.

## Phase 13: Google Gemini 4.x & Frontier Model Alignment (v2.6.0) - *Completed*
- [x] **Gemini 4.x & Frontier Model Alignment**: Model constants resmi (`gemini-4-pro`, `gemini-4-flash`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.0-flash-thinking-exp`) dan tabel kalkulasi biaya FinOps default 2026 (`GEMINI_DEFAULT_PRICING`).
- [x] **Native Google Context Caching (`cachedContent`)**: Integrasi penuh context caching Google Gemini (>32k tokens) dengan diskon 75%–90% pada FinOps tracking, dilengkapi helper lifecycle in-process (`createCachedContent`, `getCachedContent`, `listCachedContents`, `deleteCachedContent`).
- [x] **Live Google Search Grounding & Dynamic Citations**: Opsi request `googleSearch: true` dengan ekstraksi otomatis query dan sitasi terverifikasi (`groundingMetadata`).
- [x] **Python Code Execution Sandbox**: Opsi request `codeExecution: true` untuk eksekusi kode Python sandbox di sisi server Gemini dengan output terstruktur.
- [x] **Universal Reasoning Mapping**: Pemetaan dinamis `reasoningEffort` (`low`, `medium`, `high`) ke `thinkingBudget` pada model Gemini reasoning.

## Phase 14: In-Process Gateway Rate Limiting, Prometheus / OpenTelemetry Exporters & Canary Probing (v2.7.0 - v2.7.1) - *Completed*
- [x] **In-Process Gateway Rate Limiting (`GatewayRateLimiter`, `GatewayRateLimitError`)**: Algoritma sliding-window counter berbobot sub-window tanpa dependensi eksternal, mendukung Requests Per Minute (RPM) dan Tokens Per Minute (TPM) dengan estimasi proaktif dan penyesuaian paska-respons (`adjustTokens`) lintas request non-streaming dan streaming.
- [x] **Granular Multi-Tier Rate Limit Rules**: Konfigurasi global default (`defaultRule`), per-model (`modelRules`), per-provider (`providerRules`), dan partisi user/tenant (`keyGenerator` atau `request.user`) dengan aksi `block` atau `warn`.
- [x] **Native Prometheus & OpenMetrics Exporter (`exportPrometheusMetrics`, `toPrometheusMetrics`)**: Format eksposisi teks standar OpenMetrics/Prometheus tanpa dependensi runtime, mengekspos counter total requests, status breakdown, token (prompt, completion, cached), biaya USD, serta counter dan latency gauge per provider.
- [x] **Native OpenTelemetry OTLP JSON Exporter (`exportOtelMetrics`, `toOtelMetrics`)**: Format JSON OTLP v1 `ResourceMetrics` siap kirim ke endpoint collector `/v1/metrics` dengan `serviceName` dan atribut resource yang dapat dikonfigurasi.
- [x] **Native Anthropic Prompt Caching (`promptCaching`)**: Header `anthropic-beta: prompt-caching-2024-07-31` otomatis dan injeksi breakpoint `cache_control: { type: 'ephemeral' }` pada system prompt >1,024 token serta ekstraksi metrik `cachedPromptTokens`.
- [x] **Anti-Thundering-Herd Strict Canary Probing**: Proteksi transisi Circuit Breaker `HALF_OPEN` dengan kanari tunggal dan pengalihan ke provider cadangan saat probe berlangsung.
- [x] **Universal Signal Detach & Memory Safety (`linkAbortSignal`)**: Pelepasan event listener deterministik pada blok `finally` dan pemutusan dini stream upstream saat pembatalan konsumen (`for await { break; }`).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 26 (`examples/26-gateway-rate-limiting-and-metrics-export.ts`); total 357/357 tes lulus di 32 test suites, 100% Biome Clean.

## Phase 15: In-Process Model Context Protocol (MCP) Tool Bridge & Autonomous Agent Loop (v2.8.0) - *Completed*
- [x] **In-Process Model Context Protocol (MCP) Tool Bridge (`McpToolBridge`)**: Registri tools lokal zero-dependency dengan validasi skema JSON Schema dan handler asynchronous.
- [x] **Bi-directional Schema Conversion**: Konversi mulus antara skema MCP (`McpTool`) dan spesifikasi OpenAI / Unified `ToolDefinition` (`toUnifiedTools`, `getTools`, `toToolDefinition`, `fromToolDefinition`).
- [x] **Error-Resilient Tool Call Execution**: Eksekusi paralel `executeToolCalls(calls)` dengan parsing argumen tahan-kesalahan, penangkapan exception runtime (`isError: true`), dan konversi langsung ke `role: 'tool'` messages (`ChatMessage[]`).
- [x] **Standard MCP JSON-RPC 2.0 Protocol Dispatcher**: Handler RPC `handleJsonRpc` siap integrasi dengan Stdio/SSE worker dan external MCP clients untuk metode `tools/list`, `tools/call`, dan `ping`.
- [x] **Autonomous Agent Multi-Step Loop (`client.runWithTools`)**: Siklus eksekusi agen otonom multi-langkah (`maxSteps`) dengan agregasi token penggunaan, preservasi riwayat percakapan, dan pelaporan progres real-time (`onStep`).
- [x] **Local & Cloud Reasoning Extraction**: Dukungan `reasoning_content` pada Ollama (DeepSeek-R1 / QwQ) dan Mistral AI, serta ekstraksi penggunaan streaming (`usage`) untuk rate limiting presisi.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 27 (`examples/27-mcp-tool-bridge-and-agent-loop.ts`); total 387/387 tes lulus di 33 test suites, 100% Biome Clean.

## Phase 16: Gemini Agent Booster, Streaming Autonomous Agent Loop & Streaming Reversible PII Vault (v2.8.1 - v2.9.0) - *Completed*
- [x] **Gemini Agent Booster & Dynamic Thinking Budget (`thinkingBudget: 'auto'`)**: Alokasi anggaran penalaran dinamis berbasis analisis kompleksitas multi-sinyal (`0`, `2048`, `8192`, `32768` token) lintas Gemini 4 Argon/Pro, Anthropic Claude, dan xAI Grok.
- [x] **Deterministic KV-Cache Prefix Pinning (`canonicalizeTools`, `canonicalizeRequest`)**: Kanonikalisasi urutan tools dan properti JSON Schema secara leksikografis untuk memaksimalkan hit rate Prompt Caching (75%–90% penghematan biaya) dan exact cache 64-bit.
- [x] **Streaming Autonomous Agent Loop (`client.runWithToolsStream`)**: Loop agen MCP multi-langkah secara streaming (`step-start`, `text-delta`, `reasoning-delta`, `tool-call-start`, `tool-call-result`, `step-finish`, `done`) dengan rekonstruksi argumen tool terfragmentasi.
- [x] **Streaming Reversible PII Tokenization Vault (`PIIGuardrails.restoreStream`)**: Detokenisasi sliding-window real-time untuk memulihkan token surrogate PII yang terpotong lintas chunk SSE dengan latensi 0ms pada teks normal.
- [x] **Multimodal Security Guardrails & Gemini 4 Argon Fallbacks**: Inspeksi prompt injection pada array `ContentPart[]` multimodal serta dukungan `GEMINI_MODELS.ARGON_4` (`gemini-4-argon`) dengan fallback otomatis ke `gemini-3.8-flash`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 28 (`examples/28-gemini-agent-booster-and-streaming-agent.ts`); total 404/404 tes lulus di 34 test suites, 100% Biome Clean.

## Phase 17: Security Hardening, Context Caching Control Plane & Massively Parallel Agent Loops (v2.10.0) - *Completed*
- [x] **ReDoS & Security Vulnerability Hardening**: Pencegahan infinite loop pada zero-length regex matches di `SecurityGuardrails` serta sanitasi aman terhadap string replacement berbasis fungsi `() => ...` untuk mencegah korupsi karakter `$`.
- [x] **Prototype Pollution Defense**: Sanitasi kunci `__proto__`, `constructor`, dan `prototype` pada algoritma kanonikalisasi leksikografis `GeminiAgentBooster.canonicalizeJsonValue`.
- [x] **First-Class Google Context Caching API (`client.contextCache`)**: Endpoint kontrol terpadu untuk evaluasi kelayakan (`evaluateEligibility`), pembuatan (`create`), pengambilan metadata (`get`), daftar (`list`), dan penghapusan (`delete`) cache konteks Google Gemini (>32k token) guna memangkas biaya hingga 90%.
- [x] **Automatic Gemini 4 Frontier Availability Fallback Invariant**: Penyisipan otomatis `gemini-3.8-flash` ke dalam rantai kandidat model saat memanggil `gemini-4-argon`, `gemini-4-pro`, atau `gemini-4-flash` pada provider Gemini.
- [x] **Massively Parallel Tool Execution di `client.runWithToolsStream`**: Eksekusi paralel multi-tool calls konkuren berbasis `Promise.all` guna memangkas latensi putaran agen hingga 80% sambil tetap menyiarkan event streaming secara reaktif.
- [x] **Streaming Tool Deduplication & Atomic Rate Limit Increment**: Perbaikan duplikasi nama tool calling pada stream accumulator dan dukungan atomic increment dengan TTL pada `StateStorage`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 29 (`examples/29-gemini-context-caching-and-parallel-agents.ts`); total 411/411 tes lulus di 34 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.10.0.

## Phase 18: Real-Time Multimodal Voice & WebSockets (Upcoming / v3.0.0)
- [ ] **Real-Time Bidirectional Voice & WebSockets (`client.realtime`)**: Abstraksi terpadu untuk koneksi WebSocket/WebRTC berlatensi ultra-rendah (<300ms) ke OpenAI Realtime API dan Gemini Multimodal Live API.


