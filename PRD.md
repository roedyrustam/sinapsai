# Product Requirements Document (PRD) - SinapsAI

## 1. Visi Produk
Menciptakan "Control Plane" AI in-process berbasis NPM package (TypeScript/Node.js) yang menjembatani aplikasi pengembang dengan 200+ penyedia LLM melalui satu *Unified API*. Paket ini dirancang untuk meminimalisir *downtime* dengan otomatisasi failover, retries, load balancing, perlindungan keamanan, dan optimasi latensi secara lokal (*in-memory*), tanpa kompromi pada performa (<5ms overhead) maupun privasi data (100% in-process tanpa data leakage).

## 2. Lingkup Produk (Scope)
- **Target Pengguna**: Pengembang Backend/Fullstack, AI Engineers, Tim DevOps & Enterprise AI Platform.
- **Platform Dukungan**: Node.js 18+, Bun 1.0+, Deno 2.x, Cloudflare Workers, dan Vercel Edge Runtime.
- **Batasan (Out of Scope)**: 
  - Tidak menyediakan UI Dashboard web eksternal (fokus pada core library / SDK murni).
  - Tidak mengirim telemetry, API Keys, atau prompt payload ke server cloud milik SinapsAI (100% lokal & private).

## 3. Fitur Utama

### A. Core Routing & Resilience
- **Unified API**: Berkomunikasi dengan OpenAI, Anthropic Claude, Google Gemini, Groq, DeepSeek, Mistral, Ollama, OpenRouter, xAI (Grok), dan Cohere v2 menggunakan format OpenAI Chat Completions & Embeddings.
- **Multi-Strategy Routing**:
  - `failover`: Urutan prioritas tetap dengan fallback berjenjang.
  - `load-balance`: Round-Robin antar API key dan provider untuk memaksimalkan kuota/throughput.
  - `lowest-cost`: Perutean dinamis memprioritaskan biaya terendah berdasarkan dual-pricing (input vs output tokens).
  - `lowest-latency`: Perutean berbasis Exponential Moving Average (EMA) latency dengan auto-probing.
  - `adaptive` / `smart-hybrid`: Skoring multi-faktor memadukan keandalan (Laplace smoothed), latensi, dan estimasi biaya per request.
- **In-Memory Circuit Breaker**: Memutus rute ke provider bermasalah (*OPEN*) dengan auto-recovery threshold (*HALF_OPEN* -> *CLOSED*) dan manual inspect/reset API.
- **Speculative Hedged Requests (`HedgedExecutor`)**: Meluncurkan request cadangan setelah ambang batas delay (`delayMs`) untuk memangkas latensi ekor (P99/P99.9) pada provider redundan, dengan pembatalan instan (`AbortController`) bagi request yang kalah cepat. Terintegrasi langsung pada `client.chat.completions.create`.
- **Automated Fallback & Exponential Retries**: Percobaan ulang otomatis untuk transient errors (429, 5xx, timeouts) dengan exponential backoff dan jitter.
- **Hierarchical Model-Level Fallback Engine**: Rantai model cadangan sekunder otomatis pada level provider dan request.
- **Gemini 4 Frontier Availability Fallbacks**: Otomatis fallback ke `gemini-3.8-flash` saat model Gemini 4 Pro / Argon belum terprovisi atau mengalami rate limiting.
- **In-Process Gateway Rate Limiter (`GatewayRateLimiter`)**: Algoritma sliding-window berbobot sub-window tanpa dependensi eksternal untuk kuota Requests Per Minute (RPM) dan Tokens Per Minute (TPM) dengan counter atomik (`storage.increment`).

### B. Security, Privacy & FinOps Guardrails
- **In-Process Zero-Dependency PII Guardrails (`PIIGuardrails`)**: Deteksi dan redaksi otomatis data sensitif (email, nomor telepon internasional/lokal, kartu kredit dengan algoritma Luhn, SSN, IPv4/IPv6, nomor paspor, IBAN, JWT, dan URL). Mendukung mode **Reversible Tokenization Vault** untuk mendekripsi respons non-streaming maupun streaming secara real-time.
- **Prompt Injection & Security Guardrails (`SecurityGuardrails`)**: Deteksi heuristik zero-dependency untuk prompt injection, jailbreak, manipulasi system role, delimiter hijacking, dan secret exfiltration dengan proteksi ReDoS (zero-length match advancing) dan replacer function anti-injection.
- **Prototype Pollution Immunity**: Sanitasi atribut berbahaya (`__proto__`, `constructor`, `prototype`) saat kanonikalisasi skema JSON tools di `GeminiAgentBooster`.
- **FinOps Spend & Token Guardrails (`BudgetGuardrails`)**: Pembatasan batas pengeluaran kumulatif USD (`maxCostUsd`) dan volume token (`maxTotalTokens`) dengan mode pemblokiran keras (`action: 'block'` melempar `BudgetExceededError`) atau peringatan lembut (`action: 'warn'`).
- **In-Process Dynamic Context Compressor (`ContextCompressor`)**: Estimasi token zero-dependency (~4 chars per token) dan pemotongan cerdas (`sliding-window` & `middle-out`) yang mengamankan pesan sistem dan mempreservasi grup pemanggilan fungsi tool secara atomik.

### C. Developer Experience & Ecosystem
- **Official Vercel AI SDK Adapter (`sinapsai/ai-sdk`)**: Implementasi resmi spesifikasi `LanguageModelV1` dan `EmbeddingModelV1` murni tanpa dependensi eksternal, mendukung `streamText`, `generateText`, `streamObject`, `embed`, dan `embedMany`.
- **In-Process Model Context Protocol (MCP) Tool Bridge (`McpToolBridge`)**: Registri tools lokal zero-dependency dengan validasi skema JSON Schema, handler async, dispatcher JSON-RPC 2.0 (`tools/list`, `tools/call`, `ping`), dan loop agen otonom multi-langkah (`client.runWithTools` & `client.runWithToolsStream`).
- **Massively Parallel Tool Execution**: Eksekusi serentak panggilan tool menggunakan `Promise.all` di `runWithToolsStream` saat model menghasilkan beberapa tool call sekaligus dalam 1 putaran agen.
- **Universal Frontier Reasoning Engine**: Kontrol terpadu Chain-of-Thought (`thinkingBudget: number | 'auto'`, `reasoningEffort: 'low' | 'medium' | 'high'`, dan ekstraksi `reasoning_content`) untuk Gemini 4 Pro / Flash Thinking, Claude 3.7 Sonnet, OpenAI o1/o3/o4, DeepSeek R1, Groq LPU, dan xAI Grok.
- **Native Gemini Context Caching (`client.contextCache`)**: Integrasi penuh explicit context caching Google Gemini (>32k tokens) dengan diskon 75%–90% pada FinOps tracking, dilengkapi helper CRUD in-process (`create`, `get`, `list`, `delete`, `evaluateEligibility`).
- **Live Search Grounding & Python Code Execution**: Injeksi tool live Google Search dengan ekstraksi sitasi terverifikasi (`groundingMetadata`), serta eksekusi kode Python server-side sandbox.
- **Model Aliases & Health Probes**: Pemetaan alias virtual (misal `{ 'fast': 'gpt-4o-mini' }`) dan inspeksi status gateway pasif/aktif (`client.checkHealth()`).
- **Concurrent In-Process Batch Engine (`client.batch`)**: Worker pool konkuren tanpa dependensi eksternal untuk bulk chat completions dan embeddings dengan pembatasan konkurensi dan pelaporan progres (`onProgress`).
- **Zero-Dependency Semantic Caching**: Caching semantik berbasis cosine similarity murni in-process dengan threshold kemiripan dan hook observabilitas.
- **Distributed Storage Adapters**: Integrasi state sirkuit breaker dan cache untuk Cloudflare KV, Cloudflare D1, dan Redis Cluster dengan dukungan counter atomik (`increment`) tanpa dependensi runtime eksternal.

## 4. Non-Functional Requirements (NFR)
- **Performa Eksekusi**: Overhead proses internal sangat minim (<5ms, sub-millisecond cache hits).
- **Zero Runtime Dependencies**: Murni memanfaatkan standar runtime web (`fetch`, Web Streams, EventSource SSE).
- **Edge Runtime Certified**: Kompatibel 100% di Node.js 18+, Bun, Deno, dan Cloudflare Workers.
- **Type Safety**: TypeScript 100% strict mode dengan isolated declarations dan types definition lengkap.
- **Verifikasi Kualitas**: 411/411 unit & integration tests lulus di 34 test suites (100% pass rate), 100% Biome clean, dan 29 contoh siap pakai di `examples/`.
