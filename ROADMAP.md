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

## Phase 18: In-Process Multi-Agent Swarm & Agent-to-Agent (A2A) Handoff Protocol (v2.11.0) - *Completed*
- [x] **In-Process Multi-Agent Swarm (`AgentSwarm`, `client.swarm`)**: Orkestrasi multi-agen otonom in-memory dengan peran terspesialisasi (`SwarmAgentConfig`), instruksi sistem independen, dan override model per agen.
- [x] **Automated A2A Handoff Tool Synthesis**: Sintesis otomatis pemanggilan alat delegasi `transfer_to_<agent>` dengan argumen alasan (`reason`) dan pembaruan konteks (`context_updates`).
- [x] **Thread-Safe Shared Memory Context (`SwarmContext`)**: State memori bersama yang dimutasi secara atomik lintas putaran agen dan diinjeksikan secara transparan ke instruksi sistem agen berikutnya.
- [x] **Standard A2A Agent Card Exporter (`exportAgentCards`)**: Ekspor manifesto penemuan agen sesuai standar terbuka `/.well-known/agent.json` mencakup kapabilitas, streaming, dan skill metadata.
- [x] **Dual Execution Modes (Non-Streaming & Streaming)**:
  - `swarm.run()`: Eksekusi lengkap berjenjang mengembalikan `SwarmResult` dengan breakdown langkah per agen dan biaya kumulatif.
  - `swarm.runStream()`: Generator asynchronous menyiarkan event real-time (`agent-start`, `text-delta`, `reasoning-delta`, `tool-call-start`, `tool-call-result`, `handoff`, `done`).
- [x] **Cycle & Ping-Pong Safeguard**: Deteksi perulangan siklus otomatis (`maxHandoffs`) untuk mencegah deadlock atau infinite delegation loop antar agen.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 30 (`examples/30-multi-agent-swarm-and-a2a-handoff.ts`); total 419/419 tes lulus di 35 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.11.0.

## Phase 19: Universal LLM Optimization Engine (LLMO) & AI-Ready Manifests (v2.12.0) - *Completed*
- [x] **Universal Prompt Minification & Token Compression (`LlmOptimizer`)**: Pemangkasan spasi berlebih, tab horizontal, dan trailing newline tanpa merusak blok kode (code blocks preserved verbatim) dengan mode `lossless` dan `aggressive`.
- [x] **System Instruction Deduplication**: Penggabungan dan deduplikasi aturan instruksi sistem yang berulang lintas riwayat percakapan.
- [x] **Deterministic KV-Cache Prefix Alignment**: Kanonikalisasi urutan tools dan properti JSON Schema secara leksikografis untuk memaksimalkan hit rate Prompt Caching (75%–90% penghematan biaya token) pada provider OpenAI, Anthropic, Gemini, dan DeepSeek.
- [x] **Multi-Signal Complexity Analysis & Adaptive Model Cascading**: Skoring kompleksitas prompt otomatis (0.0 hingga 1.0) memetakan request ke 3 tingkatan model: `tier1` (Fast/Light), `tier2` (Standard), dan `tier3` (Deep Reasoning).
- [x] **Dynamic Thinking Budget & Output Optimization**: Alokasi otomatis `thinkingBudget` berdasarkan kompleksitas prompt.
- [x] **FinOps Savings Telemetry (`llmoMetrics`)**: Penjejakan total tokens saved, estimated USD saved, average compression ratio, dan cascaded requests count pada `client.getMetrics()`.
- [x] **Standard LLMO & GEO Manifests (`llms.txt` & `llms-full.txt`)**: Standar industri modern untuk penemuan dan konsumsi kontekstual oleh LLM frontier (ChatGPT, Claude, Gemini, Perplexity, Cursor, Copilot).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 31 (`examples/31-llm-optimization-llmo.ts`); total 429/429 tes lulus di 36 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.12.0.

## Phase 20: Real-Time Multimodal Voice & WebSockets (v2.12.0) - *Completed*
- [x] **Real-Time Bidirectional Voice & WebSockets (`client.realtime`)**: Abstraksi terpadu untuk koneksi WebSocket/WebRTC berlatensi ultra-rendah (<300ms) ke OpenAI Realtime API dan Gemini Multimodal Live API.
- [x] **WebRTC SDP Negotiation Engine (`client.realtime.negotiateWebRtc`)**: Negosiasi REST SDP offer/answer untuk streaming audio WebRTC langsung dari browser.

## Phase 21: CLI Gateway, Standalone MCP, Type-Safe Schemas, GraphRAG & Durable Swarms (v2.13.0) - *Completed*
- [x] **Zero-Dependency Type-Safe Schema Builder (`s`, `client.s`)**: Builder skema deklaratif fluent bergaya Zod (`s.object`, `s.string`, `s.number`, `s.boolean`, `s.array`, `s.enum`) dengan validasi runtime dan kompilasi otomatis ke OpenAI ToolDefinition dan MCP InputSchema.
- [x] **In-Process Knowledge Graph & GraphRAG (`KnowledgeGraph`, `client.graph`)**: Representasi graf in-memory adjacency list, ekstraksi triples (Subjek-Predikat-Objek), multi-hop BFS traversal dengan decay scoring, dan sintesis subgraph ke context prompt.
- [x] **Durable Agent Workflows & State Checkpoint Engine (`DurableWorkflowEngine`, `client.workflows`)**: Checkpoint state per langkah agen, rekaman mutasi konteks bersama, dan fungsi `resume` pemulihan pasca restart/crash tanpa duplikasi tool runs.
- [x] **In-Process LLM Evals & Faithfulness Guardrail (`LlmEvals`, `client.evals`)**: Evaluasi groundedness klaim terhadap konteks RAG, skor relevansi terhadap prompt, dan audit keamanan konten/toksisitas zero-dependency.
- [x] **Standalone CLI & OpenAI-Compatible Gateway (`sinapsai serve`)**: Server HTTP native tanpa dependensi eksternal mengekspos `/v1/chat/completions` (streaming & non-streaming), `/v1/models`, `/health`, dan `/metrics`.
- [x] **Standalone MCP Stdio Server (`sinapsai mcp`)**: Protokol JSON-RPC 2.0 native over stdin/stdout untuk integrasi langsung ke Claude Desktop, Cursor, Antigravity, dan Windsurf.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 36–39; total 486/486 tes lulus di 46 test suites, 100% Biome Clean, Siap Rilis ke NPM v2.13.0.

## Phase 22: Cognitive Brain, Parallel Swarm Fan-Out & Human-in-the-Loop (HITL) Workflows (v2.14.0) - *Completed*
- [x] **Unified In-Process Cognitive Brain (`CognitiveBrain`, `client.brain`)**:
  - Tri-Memory Fusion terpadu: memadukan Episodic Memory (fakta pengguna), In-Memory Knowledge Graph (triples entitas), dan Hybrid RAG (BM25 + Dense Vectors) dalam satu panggilan deklaratif (`client.brain.retrieveContext`).
  - Mekanisme proteksi alokasi memori in-memory LRU cache dan memory byte cap untuk keandalan di edge/serverless runtime.
- [x] **Parallel Subagent Fan-Out / Fan-In with Map-Reduce (`client.swarm.runParallel`)**:
  - Eksekusi serentak sub-agen spesialis (`Promise.all`) dengan pemisahan konteks (*context pruning*) untuk mencegah context window explosion.
  - Sintesis agregator cerdas (*Map-Reduce*) yang merangkum hasil kerja semua sub-agen ke dalam satu respons terpadu.
- [x] **Human-in-the-Loop (HITL) Suspension & Resumption Engine (`client.workflows.suspendForApproval`, `client.workflows.resolveApproval`)**:
  - Penangguhan alur kerja otomatis pada tool/aksi berisiko tinggi dengan status `waiting_approval`.
  - State serialisasi atomik ke `StateStorage` (Memory, Redis, D1, Cloudflare KV) dengan resumption API instan tanpa pengulangan eksekusi tool terdahulu.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 40 (`examples/40-cognitive-brain-and-parallel-swarm.ts`); total 547/547 unit tests lulus.

## Phase 23: Universal MCP Client Ingestion & Autonomous Schema Drift Healer (v2.15.0) - *Completed*
- [x] **Universal MCP Client Ingestion Connector (`client.mcp.connectExternalServer`, `McpClientConnector`)**:
  - Transport ganda zero-dependency (Stdio transport untuk Node.js/Bun/Deno dan SSE/HTTP transport untuk Cloudflare Workers/Edge).
  - Penemuan alat otomatis (*tools/list*) dan konversi instan ke OpenAI / Unified `ToolDefinition`.
- [x] **Autonomous API Schema Drift Healer (`AutonomousDriftHealer`)**:
  - Heuristik koreksi parameter tool runtime otomatis (fuzzy camelCase/snake_case renaming, deep type coercion, default values injection) dan toleransi perubahan skema API upstream.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 41 (`examples/41-mcp-client-ingestion-and-drift-healer.ts`); total 552/552 unit tests lulus.

## Phase 24: Enterprise OpenTelemetry GenAI Tracing, Live Swarm Canvas & Confidence Cascading (v3.0.0) - *Completed*
- [x] **Native OpenTelemetry GenAI Semantic Conventions v1.30+ Tracing (`toOtelTracePayload`, `exportOtelTraces`)**:
  - Format eksposisi JSON OTLP Traces (`/v1/traces`) standar industri untuk visualisasi distributed spans (Gateway -> Router -> Guardrails -> Provider Call -> Tool Call -> Evals) di Langfuse, Arize Phoenix, Datadog, dan Jaeger.
- [x] **Dashboard Server 2.0 (Live Swarm Visualizer Canvas, Traces API & Playground)**:
  - Endpoint `/api/traces` mengekspos jejak rentang eksekusi OTLP langsung ke visualizer dashboard.
- [x] **Confidence-Calibrated Cascading & Early-Exit Inference (`evaluateResponseConfidence`)**:
  - Evaluasi skor kepastian/entropi output model Tier 1 dengan eskalasi otomatis ke model Tier 3 saat terdeteksi ambiguitas atau ketidakpastian.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 42 (`examples/42-opentelemetry-genai-tracing-and-confidence-cascading.ts`); total 556/556 unit tests lulus di 53 test suites, 100% Biome Clean, 100% Zero Runtime Dependencies.

## Phase 25: Enterprise Cloud Providers, Steganography Firewall 2.0 & Atomic Swarm Deep-Merge (v3.1.0) - *Completed*
- [x] **AWS Bedrock Provider with Pure Zero-Dependency SigV4 Signer (`AwsBedrockProvider`)**:
  - Converse API (`/model/{modelId}/converse`) mendukung Claude 3.7/3.5, Amazon Nova (Pro/Lite/Micro), Meta Llama 3.3/3.1, dan Mistral Large.
  - Implementasi penandatanganan request AWS SigV4 murni menggunakan Web Crypto standard (`crypto.subtle`) tanpa membebani runtime dependencies eksternal.
- [x] **Azure OpenAI Service Provider (`AzureOpenAiProvider`)**:
  - Konfigurasi deployment ID kustom dan target resource name Azure OpenAI Studio.
  - Dukungan autentikasi ganda: `api-key` header dan Microsoft Entra ID (Bearer token).
  - Integrasi lengkap chat completions, embeddings, dan streaming SSE.
- [x] **Steganography Firewall 2.0 di Security Guardrails (`SecurityGuardrails`)**:
  - Deteksi dan netralisasi karakter tersembunyi Zero-Width (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`, `\u2060`, `\u180E`), tag characters (ASCII smuggling `\u{E0000}-\u{E007F}`), dan Bidi text direction overrides (`\u202A-\u202E`).
  - Normalisasi NFKC Unicode untuk menangkal injeksi prompt tersembunyi.
- [x] **Atomic Concurrency Deep-Merge pada Multi-Agent Swarm (`AgentSwarm.runParallel`)**:
  - Algoritma `deepMergeContext` dan metode `SwarmContext.merge` menggabungkan mutasi state cabang agen paralel secara rekursif, dengan union dan deduplikasi array serta penanganan konflik kustom (`onContextConflict`).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 43 (`examples/43-aws-bedrock-and-azure-openai.ts`) dan contoh 44 (`examples/44-steganography-firewall-and-parallel-merge.ts`); total 573/573 unit tests lulus di 55 test suites, 100% Biome Clean, 100% Zero Runtime Dependencies, Siap Rilis ke NPM v3.1.0.

## Phase 26: Actor-Critic Consensus Swarm, Streaming Workflows & Privacy Deletion (v3.2.0) - *Completed*
- [x] **Actor-Critic Self-Correcting Consensus Swarm Loop (`client.swarm.runActorCritic`, `AgentSwarm.runActorCritic`)**:
  - Alur iterasi perbaikan mandiri otomatis: Agen Worker/Implementer menyusun draft/solusi kode, Agen Reviewer/Critic mengevaluasi kepatuhan terhadap rubrik kualitas dan skor kebenaran.
  - Perbaikan otomatis berkelanjutan hingga tercapai status `APPROVED` atau batas skor (`minScore`), dengan pelaporan siklus live (`onIteration`).
- [x] **Streaming Durable Workflows (`DurableWorkflowEngine.onStep`)**:
  - Langganan event live (`WorkflowStepEvent`) per langkah eksekusi alur kerja untuk penyiaran real-time ke WebSocket atau Server-Sent Events (SSE).
- [x] **Permanent Checkpoint Deletion (`DurableWorkflowEngine.deleteWorkflow`)**:
  - Penghapusan instan seluruh state dan riwayat checkpoint dari `StateStorage` untuk kepatuhan penuh terhadap UU PDP No. 27/2022 dan GDPR Art. 17 (*Right to be Forgotten*).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 45 (`examples/45-actor-critic-consensus-swarm.ts`); total 575/575 unit tests lulus di 55 test suites, 100% Biome Clean, 100% Zero Runtime Dependencies, Siap Rilis ke NPM v3.2.0.

## Phase 27: In-Process Semantic Prompt Router, Synthetic Dataset Distiller & Swarm DPO Pipeline (v3.3.0) - *Completed*
- [x] **In-Process Semantic Prompt Router (`SemanticRouter`, `client.semanticRouter`)**:
  - Routing semantik sub-milidetik (<0.5ms) menggunakan klasifikasi centroid vektor dan perbandingan kosinus sampel acuan tanpa latensi LLM classifier.
  - Vektorisasi L2-normalized 128-dimensi berbasis n-gram karakter dan hashing token dengan peredaman stop-word untuk memisahkan domain secara akurat.
  - Integrasi otomatis pada `SinapsClient` via opsi `semanticRouter`, auto-klasifikasi pada `chat.completions.create`, dan hook lifecycle `onSemanticRouteMatch`.
- [x] **Synthetic Dataset Distiller (`DatasetDistiller`, `client.distiller`)**:
  - Kurasi in-process dan ekstraksi dataset fine-tuning otomatis dari interaksi pengguna dan trajektori multi-agen.
  - Perekaman pasangan preferensi DPO (`recordDpo`) yang diekspor ke format JSONL standar HuggingFace/TRL (`prompt`, `chosen`, `rejected`).
  - Perekaman percakapan multi-turn SFT (`recordSft`) dengan format standar OpenAI / Axolotl (`messages: ChatMessage[]`).
  - Sanitasi PII otomatis menggunakan `PIIGuardrails` (redaksi nama, email, nomor telepon, API key, dan kartu kredit) sebelum diekspor.
  - Estimasi volume token per set data dan persistensi opsional ke `StateStorage`.
- [x] **Autonomous DPO Pair Recording in Swarm Loops (`AgentSwarm.runActorCritic`)**:
  - Opsi terintegrasi `recordDpo` dalam siklus Actor-Critic yang secara otomatis memetakan draft awal sebagai `rejected` dan revisi tervalidasi sebagai `chosen` ke dalam `client.distiller`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 46 (`examples/46-semantic-router-and-dataset-distiller.ts`); total 589/589 unit tests lulus di 57 test suites, 100% Biome Clean, 100% Zero Runtime Dependencies, Siap Rilis ke NPM v3.3.0.

## Phase 28: Clustered Semantic Cache, Swarm Tournament Consensus & KV-Cache Prefix Pinning (v3.4.0) - *Completed*
- [x] **In-Process Clustered Semantic Cache (`ClusteredSemanticCache`, `client.clusteredCache`)**:
  - Pengindeksan centroid spherical K-means in-memory yang memangkas lookup cache dari $O(N)$ pemindaian linear menjadi $O(K + N/K)$ (<0.08ms lookup) untuk repositori cache prompt besar.
  - Pembaruan centroid online bertahap saat penyisipan, pemeringkatan jarak cluster kandidat, pencarian terbalik antar cluster dengan fallback, dan eviksi LRU deterministik berbasis penghitung sekuensial monotonik.
  - Integrasi native pada `SinapsClient` via opsi `clusteredCache` lengkap dengan metrik hit/miss real-time (`getStats()`).
- [x] **Swarm Multi-Model Tournament & Voting Consensus (`TournamentConsensusEngine`, `AgentSwarm.runTournament`)**:
  - Musyawarah multi-agen lintas model LLM heterogen dengan komputasi matriks kesamaan kosinus berpasangan dan pengelompokan semantik respon.
  - Strategi konsensus fleksibel: Plurality Majority Voting, Borda-count Positional Ranking, dan Reliability-Weighted Scoring dengan estimasi interval keyakinan [0.0–1.0].
  - Ekstraksi pandangan minoritas yang berbeda pendapat (*minority dissent*) dan eskalasi opsional ke Master Synthesizer.
  - Distilasi dataset Direct Preference Optimization (DPO) otomatis memetakan pemenang konsensus sebagai `chosen` dan disenter minoritas utama sebagai `rejected` langsung ke `client.distiller`.
- [x] **KV-Cache Prefix Pinning Optimizer (`KvCacheOptimizer`, `client.kvCache`, `request.pinKvCache`)**:
  - Partisi pesan 3-tingkat: Static Prefix (instruksi sistem, definisi peran), Stable Memory (memori episodik, triple knowledge graph), dan Volatile Tail (kueri pengguna, konteks runtime).
  - Relokasi otomatis timestamp ISO dinamis dari instruksi sistem ke header standar `[RUNTIME_CONTEXT]` di bagian ekor kueri untuk menjaga prefix byte-identik.
  - Kanonikalisasi leksikografis deterministik skema fungsi dan tool untuk menjamin kecocokan prompt cache byte-identik pada Claude 3.7/3.5, Gemini 4/2.5, dan GPT-4.1.
  - Prediksi ketercapaian cache hit, perhitungan token prefix stabil, dan estimasi penghematan biaya USD prompt cache secara real-time.
  - Lifecycle hook `onKvCachePartition` yang melaporkan batas token partisi dan status kelayakan cache hit.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 47 (`examples/47-clustered-cache-tournament-and-prefix-pinning.ts`); total 608/608 unit tests lulus di 60 test suites, 100% Biome Clean, 100% Zero Runtime Dependencies, Siap Rilis ke NPM v3.4.0.

## Phase 29: Vision Token Optimizer, Speculative Stream Verifier, Agent Personas & Unified Hot-Path Pipeline (v3.5.0) - *Completed*
- [x] **Multimodal Vision Token Optimizer (`VisionOptimizer`)**:
  - Inspeksi dimensi header gambar zero-dependency (PNG, JPEG, GIF, WebP) serta estimasi token/biaya spesifik OpenAI, Anthropic, dan Gemini.
  - Sinkronisasi properti `image_url` dan alias `imageUrl` serta auto-downsampling `high` -> `low` detail melalui `client.vision.optimizeContentParts()`.
- [x] **Speculative Stream Verification (`SpeculativeStreamVerifier`)**:
  - Eksekusi paralel draft stream + auditor latar belakang dengan union adapter `SpeculativeProviderLike` (mendukung `Provider.generateContent` standar maupun `execute`/`executeStream`), callback non-blokir `onCorrection`, dan factory `client.createSpeculativeStream()`.
- [x] **Dynamic Agent Persona Registry & Swarm Lifecycle (`AgentPersonaRegistry` + `AgentSwarm`)**:
  - Integrasi `consumeTurn()` dan `detectDrift()` ke `AgentSwarm.run()` dan `AgentSwarm.runStream()`, dilengkapi `onPersonaDrift`, `prunedEphemeralSkills`, dan `personaDrift` di `SwarmResult`.
- [x] **Unified Hot-Path Pipeline (`SinapsClient`)**:
  - Penyatuan `useBrain` (Tri-Memory retrieval & injection), `clusteredCache` / `useClusteredCache` (dengan `onSemanticCacheHit`), dan perekaman otomatis `GenAiSpan` ring buffer (`getRecordedSpans()`, `clearRecordedSpans()`, argumen opsional pada `toOtelTraces()`/`exportOtelTraces()`).
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 48 (`examples/48-vision-optimizer-speculative-stream-and-personas.ts`); total 630/630 unit tests lulus di 63 test suites, 100% Biome Clean (0 error, 0 warning), Strict TypeScript Pass, 100% Zero Runtime Dependencies, Siap Rilis ke NPM v3.5.0.

## Phase 30: Late-2026 Frontier LLM Control Plane, Responses API, Adaptive Thinking, AI SDK v5/v6 & MCP 2025-06-18 (v3.6.0) - *Completed*
- [x] **Unified Frontier Model Registry (`FrontierModelRegistry`, `FRONTIER_MODELS`, `FRONTIER_AVAILABILITY_FALLBACKS`)**:
  - Katalog model frontier late-2026 dalam 4 tier (`high-fast`, `fast`, `medium`, `high`): Gemini 4 Carbon/Neon/Hydrogen/Argon/Pro/Flash & Gemini 3.8 Flash / 3.1 Pro / Live, Claude Sonnet/Opus 5.5, Fable 5.1, Opus 4.7, Sonnet/Opus 4.6, OpenAI GPT-5.6 Sol Medium, GPT-5.5/5.4/5-mini/5-nano/o3/o4-mini/gpt-realtime, xAI Grok 4.7/4.6/4.3/4-mini, DeepSeek V4 Pro/V4.1 Flash/V3.2/R1, Mistral Large/Small 4 & Magistral, Cohere Command A Reasoning/Vision, Groq Llama 4 Maverick/Scout & Qwen 3.8.
- [x] **Kepatuhan Protokol API Frontier Lintas 10+ Provider**:
  - **OpenAI**: OpenAI Responses API (`/v1/responses` non-streaming & SSE), `max_completion_tokens` pada GPT-5+/o-series, `developer` role (`useDeveloperRole`), `reasoningEffort` hingga `xhigh`/`max`, `verbosity`, `serviceTier`, `reasoningTokens`, dan `dimensions` embedding.
  - **Anthropic**: Adaptive Thinking (`thinking: { type: 'adaptive' }` + `output_config.effort`) untuk Claude 4.6/4.7/5.x, native JSON Schema (`output_config.format`), `promptCacheTtl: '1h'` (`extended-cache-ttl-2025-04-11`), konteks 1M (`context-1m-2025-08-07`), serta `cacheWriteTokens`.
  - **Google Gemini**: `thinkingLevel`, `includeThoughts`, `developer` role, `webSearch` alias, preservasi round-trip `thoughtSignature` pada function call (non-stream & stream), serta `thoughtsTokenCount` -> `usage.reasoningTokens`.
  - **xAI, DeepSeek, Mistral, Cohere, Groq, Bedrock & Azure**: Konstanta model 2026, xAI Live Search, Mistral `prompt_mode: 'reasoning'`, Cohere `thinking`, Groq Llama 4 & normalisasi effort, Bedrock Claude 5.5/Nova 2/Llama 4 + `cachePoint` + Converse thinking + `reasoningContent`, serta Azure `apiMode: 'v1'` (`/openai/v1/*`) dan `max_completion_tokens` GPT-5.
- [x] **Upgrade Core Protokol, SDK & Gateway HTTP**:
  - **Gemini Live `BidiGenerateContent` `v1beta` & OpenAI Realtime GA (`RealtimeClient`)**: Siklus lengkap `setup`, `clientContent`, `realtimeInput`, `sendVideoFrame`, `serverContent` (`onThinkingDelta`, `onSetupComplete`, `onTurnComplete`, `onInterrupted`), dan event GA OpenAI (`response.output_text.delta`, `response.output_audio.delta`).
  - **MCP `2025-06-18` Streamable HTTP & Sampling (`McpBridge`, `McpClientConnector`)**: Negosiasi versi `2025-06-18`, RPC `sampling/createMessage` + handler default pada `SinapsClient`, serta transport `'streamable-http'` dengan pelacakan `Mcp-Session-Id`, `MCP-Protocol-Version`, `notifications/initialized`, dan respons SSE.
  - **Vercel AI SDK v5 (`LanguageModelV2`) & v6 (`LanguageModelV3`)**: Adapter `SinapsLanguageModelV2`, `SinapsLanguageModelV3`, `createSinapsAIV2`, `createSinapsAIV3`.
  - **Optimasi, Telemetri & CLI Server**: `FRONTIER_CASCADE_PRESETS`, `AutonomousDriftHealer` diagnosa parameter frontier, `VisionOptimizer.estimateVideoTokens` & Grok tiles, atribut trace OTel GenAI 1.30+, ekspor metrik token `reasoning`, serta endpoint `/v1/models` (katalog frontier), `POST /v1/responses`, dan `POST /mcp` pada gateway server.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 49 (`examples/49-frontier-llm-2026-control-plane.ts`); total 661/661 unit tests lulus di 64 test suites, 100% Biome Clean (140 file, 0 error, 0 warning), Strict TypeScript Pass (`src/` & `examples/`), build ESM/CJS sukses, 100% Zero Runtime Dependencies, Siap Rilis NPM v3.6.0.

## Phase 31: Alibaba Qwen Frontier Provider Integration (v3.6.0+) - *Completed*
- [x] **Native `QwenProvider` (`src/providers/QwenProvider.ts`)**:
  - Kompatibilitas penuh DashScope OpenAI-compatible mode (International `dashscope-intl.aliyuncs.com`, Domestic China `dashscope.aliyuncs.com`, dan self-hosted vLLM/Ollama).
  - **Qwen 3 Hybrid Thinking Mode**: Pemetaan otomatis `thinkingBudget` & `reasoningEffort` ke `enable_thinking` dan `thinking_budget`, plus normalisasi `role: 'developer'` ➔ `'system'`.
  - **DashScope Built-in Web Search**: Pemetaan `webSearch: true` ➔ `enable_search: true`.
  - **Deep Reasoning & Multimodal**: Ekstraksi `reasoning_content` (`qwq-plus`, `qwq-32b`, `qwen3-max`), multimodal `image_url` (`qwen-vl-max`, `qwen3-vl-plus`), dan dense embeddings (`text-embedding-v3`, `text-embedding-v2`).
- [x] **Integrasi Control Plane, Registry, Vision & CLI**:
  - Registrasi katalog lengkap Qwen (`qwen3-max`, `qwen3-plus`, `qwen3-turbo`, `qwen3-coder-plus`, `qwen3-235b-a22b`, `qwen3-vl-plus`, `qwq-plus`, `qwq-32b`, `qwen-2.5-*`, `qwen-vl-max`) & Availability Fallbacks di `FrontierModelRegistry`.
  - Preset cascade `'qwen'` di `LlmOptimizer` (`qwen3-turbo` ➔ `qwen3-plus` ➔ `qwen3-max`).
  - Kalkulasi token visual patch dinamis `28×28` untuk Qwen2.5-VL / Qwen3-VL di `VisionOptimizer`.
  - Auto-discovery CLI untuk `QWEN_API_KEY` dan `DASHSCOPE_API_KEY`.
- [x] **Contoh & Validasi Lengkap**: Penambahan contoh 50 (`examples/50-qwen-provider-and-reasoning.ts`); total 673/673 unit tests lulus di 65 test suites, 100% Biome Clean (142 file, 0 error, 0 warning), Strict TypeScript Pass (`src/` & `examples/`).

## Phase 32: Moonshot AI (Kimi K2) & Zhipu AI (GLM-4.5) + v3.7.0 Release - *Completed*
- [x] **Native `MoonshotProvider` (`src/providers/MoonshotProvider.ts`)**: Dukungan penuh Kimi K2 (`kimi-k2-thinking`, `kimi-k2-0905-preview`, `kimi-k2-turbo-preview`, `moonshot-v1-128k`), `reasoning_content`, injeksi otomatis `$web_search`, `cached_tokens`, dan normalisasi peran `developer`.
- [x] **Native `ZhipuProvider` (`src/providers/ZhipuProvider.ts`)**: Dukungan penuh GLM-4.5 & GLM-Z1 (`glm-4.5`, `glm-4.5-air`, `glm-4.5-flash`, `glm-4.5v`, `glm-z1-air`), Hybrid Thinking (`thinking: { type: 'enabled' | 'disabled' }`), `web_search` native, dan dense embeddings `embedding-3`/`embedding-2`.
- [x] **15 Provider Terpadu, Cascade Presets & Rilis v3.7.0**: Penambahan preset `'kimi'` & `'glm'` di `LlmOptimizer`, katalog `FrontierModelRegistry`, auto-discovery CLI (`MOONSHOT_API_KEY`/`KIMI_API_KEY`, `ZHIPU_API_KEY`/`GLM_API_KEY`), Example 51 (`examples/51-moonshot-kimi-and-zhipu-glm.ts`), dan pembaruan versi ke **v3.7.0**.

## Phase 33: Multi-Tenant Virtual API Key Manager & Enterprise Gateway Auth (v3.8.0) - *Completed*
- [x] **In-Process `VirtualKeyManager` (`src/core/VirtualKeyManager.ts` & `client.virtualKeys`)**:
  - Penerbitan virtual key kriptografis (`sk-sinaps-...`) berbasis Web Crypto + hashing SHA-256 (tanpa menyimpan plaintext secret di memori).
  - Penegakan per-tenant: **Model ACLs** (`allowedModels` wildcard), **Provider ACLs** (`allowedProviders`), **FinOps USD Budget Caps** (`maxBudgetUsd`), **Sliding-Window RPM/TPM**, **TTL Expiration**, **Zero-Downtime Key Rotation** (`rotateKey`), dan **Instant Revocation** (`revokeKey`).
- [x] **Integrasi HTTP Gateway Server (`src/cli/server.ts`)**: Opsi `enforceVirtualKeys` dengan respons standar HTTP `401`/`402`/`403`/`429`.
- [x] **Contoh & Rilis v3.8.0**: Example 52 (`examples/52-multi-tenant-virtual-keys.ts`) dan bump versi ke **v3.8.0**.

## Phase 34: Virtual Key Admin REST API, Live Model ACL & Spend Attribution (v3.9.0) - *Completed*
- [x] **Admin REST API pada Gateway Server (`src/cli/server.ts`)**: `GET /v1/keys`, `POST /v1/keys`, `POST /v1/keys/:id/revoke`, dan `POST /v1/keys/:id/rotate`.
- [x] **Live Model ACL & Automatic Spend Attribution**: Validasi Model ACL per-request pada `/v1/chat/completions`, `/v1/responses`, dan `/v1/embeddings` serta pencatatan biaya USD otomatis pasca-respons via `FrontierModelRegistry.estimateCost` ke `client.virtualKeys.recordSpend()`.
- [x] **Rilis v3.9.0**: Penambahan `VirtualKeyError`, `UnifiedApiRequest.virtualKey`, integration tests di `src/cli/server.test.ts`, dan bump versi ke **v3.9.0**.

## Phase 35: Enterprise & Edge-Modular Edition (v4.0.0) - *Completed*
- [x] **Edge Purity & Modular Subpaths**: Lazy `await import('node:http')` pada `DashboardServer` + ESM code-splitting & subpath exports (`sinapsai/providers`, `sinapsai/mcp`, `sinapsai/rag`, `sinapsai/swarm`).
- [x] **Distributed `VirtualKeyManager` & Hot-Path Enforcement**: Sinkronisasi lintas-worker via `StateStorage` serta penegakan `request.virtualKey` langsung di `SinapsClient.chat.completions.create()` & `embeddings.create()`.
- [x] **Full MCP `2025-06-18` & Self-Healing `createStructured<T>()`**: Dukungan `resources/list`, `resources/read` (`sinaps://models/frontier`, `sinaps://knowledge-graph/stats`), `prompts/list`, `prompts/get`, `elicitation/create`, dan loop validasi JSON terstruktur otomatis.
- [x] **Realtime Auto-Tool-Calling, Qwen-Omni & Dashboard 3.0**: Eksekusi tool `McpToolBridge` hands-free di `RealtimeClient`, provider `'qwen'` (`qwen3-omni-flash-realtime`), endpoint/UI `/api/keys` & `/api/cache` di `DashboardServer` 3.0, Example 53, dan rilis mayor **v4.0.0** (691/691 tests lulus).






