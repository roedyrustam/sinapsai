# Dokumentasi SinapsAI

## Ikhtisar
SinapsAI adalah paket NPM Node.js/TypeScript lokal yang berfungsi sebagai *Control Plane & AI Gateway in-process* (berjalan 100% di dalam proses aplikasi Anda dengan nol dependensi runtime eksternal). Paket ini menghubungkan aplikasi Anda ke 10 penyedia LLM utama (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Mistral AI, Ollama, Groq, OpenRouter, xAI Grok, dan Cohere v2) melalui satu antarmuka API yang bersatu (*Unified API*), lengkap dengan Circuit Breaker otomatis, perutean multi-strategi, pelindung keamanan & PII, kompresi konteks, batas anggaran FinOps, dan *hedged requests* untuk memangkas latensi ekor (P99).

## Instalasi
```bash
npm install sinapsai
```

## Penggunaan Dasar
```typescript
import { 
  SinapsClient, 
  OpenAiProvider, 
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  XAiProvider,
  CohereProvider
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'adaptive', // 'failover' | 'load-balance' | 'lowest-cost' | 'lowest-latency' | 'adaptive'
  providers: [
    new OpenAiProvider({ 
      apiKey: process.env.OPENAI_API_KEY! 
    }),
    new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      defaultModel: 'claude-3-7-sonnet-20250219',
    }),
    new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      defaultModel: 'gemini-2.5-flash',
    }),
    new GroqProvider({
      apiKey: process.env.GROQ_API_KEY!,
      defaultModel: 'llama-3.3-70b-versatile',
    }),
    new XAiProvider({
      apiKey: process.env.XAI_API_KEY!,
      defaultModel: 'grok-3-beta',
    }),
    new CohereProvider({
      apiKey: process.env.COHERE_API_KEY!,
      defaultModel: 'command-r-plus-08-2024',
    }),
  ],
  // 1. In-Process Circuit Breaker
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeoutMs: 30000,
  },
  // 2. Speculative Hedging untuk memangkas P99 tail-latency
  hedging: {
    enabled: true,
    delayMs: 200, // Luncurkan backup request jika primary melebihi 200ms
  },
  // 3. Batas Anggaran FinOps Kumulatif
  budget: {
    maxCostUsd: 100.0, // Batas belanja USD kumulatif
    action: 'block',    // 'block' (melempar BudgetExceededError) atau 'warn'
  },
  // 4. Kompresi Konteks Dinamis
  contextCompression: {
    enabled: true,
    maxTokens: 8000,
    strategy: 'sliding-window', // 'sliding-window' atau 'middle-out'
  },
  // 5. In-Process Security & Prompt Injection Defense
  securityGuardrails: {
    enabled: true,
    action: 'block', // 'block' | 'sanitize' | 'warn'
  },
  // 6. In-Process Zero-Dependency PII Guardrails
  piiGuardrails: {
    enabled: true,
    reversible: true, // Reversible Vault mengembalikan entitas PII asli pada respon
  },
});

async function run() {
  // 1. Chat Completions (OpenAI-compatible)
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Halo, SinapsAI!' }],
  });
  if ('choices' in response) {
    console.log(response.choices[0].message.content);
  }

  // 2. Unified Embeddings
  const embedding = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: 'Pencarian semantik cepat',
  });
  console.log('Embedding dimensions:', embedding.data[0].embedding.length);

  // 3. Inspeksi Status Gateway & Health Probes
  const health = await client.checkHealth({ ping: false });
  console.log('Gateway status:', health.status);

  // 4. Inspeksi Status Circuit Breaker Waktu-Nyata
  const cbStatus = await client.getCircuitBreakerStatus();
  console.log('Circuit Status:', cbStatus);

  // 5. Reset Circuit Breaker & Pembersihan Cache
  await client.resetCircuitBreaker();
  await client.clearCache();

  // 6. Telemetri Real-Time In-Process
  const metrics = client.getMetrics();
  console.log('Total Requests:', metrics.totalRequests);
  console.log('Cached Prompt Tokens:', metrics.totalCachedPromptTokens);
  console.log('Estimated USD Spend:', metrics.estimatedCostUsd);
}
run();
```

## Fitur Utama per Versi Rilis

### Fitur Utama v2.10.0 (ReDoS & Prototype Pollution Hardening, Atomic Storage Counters, Parallel Tools & Context Caching)
1. **Pencegahan ReDoS Infinite Loop pada Guardrail Keamanan**: Proteksi regex zero-length match pada `SecurityGuardrails` untuk mencegah `lastIndex` hang (100% CPU lock), isolasi `allowedPatterns` tanpa flag `/g`, dan perbaikan substitusi string `$1`/`$&` dengan replacer function `() => redactedReplacement`.
2. **Kekebalan Prototype Pollution pada Kanonikalisasi Tools**: Filter ketat atribut berbahaya (`__proto__`, `constructor`, `prototype`) pada `GeminiAgentBooster.canonicalizeTools()` sebelum rekonstruksi objek skema JSON.
3. **Penyimpanan Counter Atomik (`storage.increment`)**: Penambahan method atomik `increment(key, ttlSeconds)` pada `StateStorage`, `InMemoryStorage`, `RedisStorage`, `D1Storage`, dan `CloudflareKVStorage`, menghapus *race condition* konkurensi awal pada `RateLimiter`.
4. **Google Gemini Explicit Context Caching API (`client.contextCache`)**: Manajemen siklus hidup penuh untuk cache konteks besar (>32k token) dengan penghematan biaya 75%–90% via `client.contextCache.create()`, `.get()`, `.list()`, `.delete()`, dan `.evaluateEligibility()`.
5. **Eksekusi Tool Paralel Massal pada Loop Agen Streaming (`runWithToolsStream`)**: Menjalankan banyak tool call secara serentak via `Promise.all` ketika model mengembalikan 2–5 pemanggilan fungsi sekaligus dalam 1 putaran agen, memangkas latensi putaran agen hingga 80%.
6. **Gemini 4 Frontier Availability Fallback Invariant**: Otomatis menyisipkan `gemini-3.8-flash` sebagai kandidat fallback bila `gemini-4-pro`, `gemini-4-argon`, atau `gemini-4-flash` diminta dengan `enableAvailabilityFallback: true`.

### Fitur Utama v2.9.0 (Gemini Agent Booster, Streaming Autonomous Agent Loop & Streaming Reversible PII Vault)
1. **Gemini Agent Booster (`GeminiAgentBooster`)**: Alokasi anggaran penalaran dinamis `thinkingBudget: 'auto'` (0, 2048, 8192, atau 32768 token) berdasarkan analisis kompleksitas prompt, serta kanonikalisasi deterministik skema tools untuk memaksimalkan KV-cache prefix hit.
2. **Loop Agen Otonom Streaming Real-Time (`client.runWithToolsStream`)**: Asynchronous generator (`for await...of`) yang mengekspos event real-time granular (`reasoning-delta`, `text-delta`, `tool-call-start`, `tool-call-result`, `step-finish`, `done`).
3. **Streaming Reversible PII Vault**: Dekripsi dan pemulihan token surrogate PII (`{{PII_EMAIL_1}}`) secara real-time langsung pada aliran chunk SSE (`textDelta`), bahkan ketika token terbelah di perbatasan paket jaringan.

### Fitur Utama v2.8.1 (Multimodal Security Hardening & 64-Bit Collision-Resistant Cache Keys)
1. **Pemeriksaan Keamanan Multi-Modal (`SecurityGuardrails`)**: Pengecekan keamanan mendalam pada payload multimodal `ContentPart[]` (teks, gambar, audio).
2. **Kunci Cache 64-Bit Tahan Kolisi**: Caching prompt menggunakan hashing FNV-1a 64-bit yang meminimalkan risiko tabrakan kunci pada volume request tinggi.
3. **Pembatasan Laju Berbasis Provider**: Opsi pembatasan RPM/TPM spesifik per provider pada gateway rate limiting.

### Fitur Utama v2.8.0 (Model Context Protocol / MCP Tool Bridge & Loop Agen Otonom)
1. **In-Process Model Context Protocol (MCP) Tool Bridge (`McpToolBridge`)**: Registri tools lokal zero-dependency dengan validasi skema JSON Schema dan handler asynchronous yang tangguh.
2. **Konversi Skema Dua Arah (Bi-directional Schema Conversion)**: Konversi otomatis antara standar MCP (`McpTool`) dan spesifikasi OpenAI/Unified `ToolDefinition` via `toUnifiedTools()`, `getTools()`, `toToolDefinition()`, dan `fromToolDefinition()`.
3. **Eksekusi Tool Paralel Tahan-Kesalahan (`executeToolCalls`)**: Eksekusi paralel panggilan tool dengan parsing JSON tahan-kesalahan, penangkapan error runtime (`isError: true`), dan konversi langsung ke `role: 'tool'` messages (`ChatMessage[]`).
4. **Dispatcher Protokol Standar MCP JSON-RPC 2.0 (`handleJsonRpc`)**: Menangani pesan JSON-RPC 2.0 untuk `tools/list`, `tools/call`, dan `ping`, memungkinkan integrasi mulus dengan worker Stdio/SSE dan klien eksternal MCP.
5. **Loop Agen Otonom Multi-Langkah (`client.runWithTools`)**: Mengotomasi siklus eksekusi agen LLM: berulang kali memanggil model dengan tools MCP, mengeksekusi tools, memasukkan hasil kembali ke riwayat obrolan, dan mengembalikan jawaban final lengkap beserta telemetri langkah (`onStep`).
6. **Ekstraksi Reasoning & Streaming Usage di Ollama & Mistral**: Dukungan token penalaran (`reasoning_content`) pada model lokal (DeepSeek-R1, QwQ) dan Mistral AI, serta penjejakan usage streaming untuk penyesuaian rate limiter TPM secara presisi.

### Fitur Utama v2.7.0 - v2.7.1 (Gateway Rate Limiting, Metrics Exporters & Canary Probing)
1. **In-Process Gateway Rate Limiting (`GatewayRateLimiter`)**: Algoritma sliding-window counter berbobot sub-window tanpa dependensi eksternal, mendukung batasan Requests Per Minute (RPM) dan Tokens Per Minute (TPM) lintas request non-streaming dan streaming (`adjustTokens`).
2. **Eksportir Metrik Prometheus & OpenMetrics (`exportPrometheusMetrics`, `toPrometheusMetrics`)**: Format eksposisi teks standar OpenMetrics/Prometheus tanpa dependensi runtime, mengekspos metrik request, status, token, biaya USD, serta latency gauge per provider.
3. **Eksportir Metrik OpenTelemetry OTLP JSON (`exportOtelMetrics`, `toOtelMetrics`)**: Format JSON OTLP v1 `ResourceMetrics` siap kirim ke collector `/v1/metrics`.
4. **Atribusi Provider Transparan (`response.provider`)**: Properti `provider` pada setiap respons `UnifiedApiResponse` yang menandai provider mana yang menyelesaikan permintaan.
5. **Prompt Caching Native Anthropic Claude (`promptCaching`)**: Header `anthropic-beta: prompt-caching-2024-07-31` otomatis dan injeksi breakpoint `cache_control: { type: 'ephemeral' }` pada system prompt >1,024 token.
6. **Proteksi Strict Canary Probing & Signal Detach**: Proteksi transisi Circuit Breaker `HALF_OPEN` dengan kanari tunggal dan pelepasan listener `AbortSignal` deterministik pada blok `finally`.

### Fitur Utama v2.5.0 (Context Compression, FinOps Budget, Speculative Hedging & Frontier Providers)
1. **Dynamic Context Compressor (`ContextCompressor`)**: Estimasi token zero-dependency (~4 karakter per token) dan algoritma pemangkasan percakapan otomatis (`sliding-window` & `middle-out`) yang mengamankan instruksi sistem (`system`) serta mempertahankan grup pemanggilan fungsi (`tool_calls` dan `tool`) secara atomik agar tidak memicu error API.
2. **FinOps Spend & Token Guardrails (`BudgetGuardrails`)**: Pembatasan pengeluaran kumulatif USD (`maxCostUsd`) dan volume token (`maxTotalTokens`) secara proaktif sebelum request dikirim, mendukung aksi pemblokiran keras (`BudgetExceededError`) atau peringatan lembut (`onBudgetWarning`).
3. **Speculative Hedged Requests (`HedgedExecutor` & Client Option `hedging`)**: Mengirim request cadangan secara spekulatif setelah jeda delay (`delayMs`) guna memangkas latensi ekor (P99/P99.9) pada provider redundan, dengan pembatalan otomatis bagi request yang kalah cepat.
4. **Dukungan Provider Frontier Baru (xAI Grok & Cohere v2)**: Integrasi kelas satu untuk xAI Grok (`XAiProvider`, mendukung model Grok 3 dan `reasoningEffort`) dan Cohere v2 (`CohereProvider`, mendukung Command A, Command R+, dan Embed v4).

### Fitur Utama v2.4.0 (Security Guardrails, Model Aliases, Health Probes & Stream Accumulator)
1. **In-Process Security Guardrails (`SecurityGuardrails`)**: Pertahanan lokal tanpa dependensi dari serangan *prompt injection*, *jailbreak* ("DAN", "evil confidant"), manipulasi *system role*, *delimiter hijacking*, dan kebocoran rahasia (*secret exfiltration*) dengan mode `block`, `sanitize`, atau `warn`.
2. **Virtual Model Aliases (`modelAliases`)**: Pemetaan nama alias virtual yang memisahkan logika aplikasi dari kode model vendor (misal: `{ 'fast': 'gpt-4o-mini', 'smart': 'claude-3-7-sonnet' }`).
3. **Gateway Health Probes (`client.checkHealth()`)**: Evaluasi kesehatan provider dan gateway secara pasif (state sirkuit, tingkat keberhasilan) dan aktif via heartbeat 1-token (`ping: true`).
4. **Streaming Tool-Call Accumulator (`accumulateStream`)**: Rekonstruksi otomatis aliran delta streaming SSE (teks, penalaran, dan potongan panggilan alat multi-langkah) ke dalam format respons lengkap `UnifiedApiResponse`.

### Fitur Utama v2.3.0 (Adaptive Dynamic Routing & Reversible PII Vault)
1. **Adaptive Multi-Factor Dynamic Routing (`strategy: 'adaptive'`)**: Skoring cerdas multi-faktor memadukan keandalan (Laplace-smoothed reliability), latensi bergerak (moving-average latency), dan estimasi biaya per request secara real-time.
2. **Reversible PII Vault (`piiGuardrails: { reversible: true }`)**: Tokenisasi dua arah (`{{PII_EMAIL_1}}`) yang menyamarkan data sensitif sebelum dikirim ke LLM dan secara otomatis mengembalikan nilai asli pada respons non-streaming.

### Fitur Utama v2.2.0 (Distributed Edge Storages & In-Process PII Guardrails)
1. **Distributed Edge & Cluster Storage Adapters**: Integrasi state Circuit Breaker dan cache untuk Cloudflare KV (`CloudflareKVStorage`), Cloudflare D1 (`D1Storage`), dan Redis Cluster (`RedisStorage`) tanpa dependensi runtime eksternal.
2. **Zero-Dependency In-Process PII Guardrails (`PIIGuardrails`)**: Deteksi dan redaksi otomatis data pribadi sensitif (email, nomor telepon, kartu kredit tervalidasi algoritma Luhn, SSN, IPv4/IPv6, nomor paspor, IBAN, JWT, dan URL).

### Fitur Utama v2.1.0 (Official Vercel AI SDK Ecosystem Adapter)
1. **Vercel AI SDK Drop-In Adapter (`sinapsai/ai-sdk`)**: Implementasi spesifikasi resmi Vercel AI SDK `LanguageModelV1` dan `EmbeddingModelV1` murni tanpa dependensi eksternal, kompatibel penuh dengan `streamText`, `generateText`, `streamObject`, `generateObject`, `embed`, dan Next.js 15 App Router Handlers.

### Fitur Utama v2.0.1 (Resilience & Throughput Edition)
1. **Zero-Dependency Semantic In-Process Caching**: Caching respon semantik berbasis cosine similarity murni di dalam memori tanpa dependensi native eksternal (`similarityThreshold`, `maxEntries`, `embeddingModel`, `customEmbed`, dan hook `onSemanticCacheHit`).
2. **Pemrosesan Batch Konkuren In-Process (`client.batch`)**: Mesin konkurensi worker pool lokal (`client.batch.chat`, `client.batch.embeddings`, dan `client.batch.create`) dengan kontrol konkurensi (`concurrency`), pemantauan progres (`onProgress`), dan mode eksekusi terselesaikan bertoleransi kesalahan (*fail-soft*).
3. **Hierarchical Model-Level Fallbacks**: Mekanisme cadangan berjenjang 3 level (request, provider, dan client) sebelum memicu failover lintas provider, dengan fast-failover pada 401 Unauthorized.
4. **Dukungan Multi-Modal Terpadu (`ContentPart[]`)**: Standar payload OpenAI terpadu untuk teks, gambar (URL & base64), dan audio (`input_audio`) yang otomatis diterjemahkan ke format native Anthropic Claude dan Google Gemini.
5. **Telemetri Streaming TTFT & Pengerasan Circuit Breaker**: Pengukuran presisi Time-To-First-Token (TTFT) via hook `onStreamSuccess`, akumulasi token streaming ke `UnifiedApiStreamChunk.usage`, pencegatan error di tengah stream (*mid-stream connection reset*) ke Circuit Breaker, serta perlindungan pembatalan pengguna (`AbortSignal`).

### Fitur Utama v2.0.0 (Superintelligence Edition)
1. **Universal Frontier Reasoning Engine**: Kontrol terpadu penalaran mendalam dan Chain-of-Thought di seluruh provider: Claude 3.7 Sonnet (`thinkingBudget`), OpenAI o1/o3/o4 (`reasoningEffort`), Groq LPU, DeepSeek R1, Google Gemini Flash Thinking, dan xAI Grok. Semua hasil penalaran disajikan seragam pada `message.reasoning_content`.
2. **Perutean Dinamis Latensi Terendah (`strategy: 'lowest-latency'`)**: Secara real-time mengukur moving-average latency setiap provider, mengarahkan prompt ke provider tercepat dengan probing inisial instan dan fallback otomatis.
3. **Telemetri KV-Cache & Prompt Caching Analytics**: Penjejakan `cachedPromptTokens` per response dan `totalCachedPromptTokens` pada `client.getMetrics()`, memungkinkan audit efisiensi prompt caching (penghematan biaya token 70-90%).

## Keamanan & Standar Kualitas
- **100% In-Process & Privat:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Runtime Dependencies:** Murni menggunakan standar runtime web modern (`fetch`, Web Streams, EventSource SSE, `AbortController`).
- **Overhead Sangat Rendah:** Latensi eksekusi gateway internal di bawah 5ms.
- **Pengujian Komprehensif:** 411/411 unit & integration tests lulus di 34 test suites (100% pass rate) mencakup seluruh 10 provider, modul fallback, canary circuit breaker, signal cleanup, prompt caching, gateway rate limiting, Prometheus/OTel exporters, MCP tool bridge, parallel tool execution, Gemini Context Caching, ReDoS hardening, prototype pollution immunity, semantic cache, batch engine, PII, budget, security, dan hedged requests.
- **100% Biome Clean:** Kode sumber sepenuhnya sesuai dengan standar ketat linter Biome v2 tanpa peringatan maupun error.
- **29 Contoh Siap Pakai:** Seluruh contoh pada folder `examples/` (1 s/d 29) teruji dan 100% lulus kompilasi TypeScript.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [MIT License](./LICENSE). Anda bebas menyalin, memodifikasi, mendistribusikan, dan menggunakan proyek ini untuk keperluan apa pun (termasuk komersial) dengan menyertakan pemberitahuan hak cipta asli.
