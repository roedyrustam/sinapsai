# Product Requirements Document (PRD) — SinapsAI v3.2.0

## 1. Visi Produk
Menciptakan "Control Plane & Cognitive Architecture" AI in-process berbasis NPM package (TypeScript/Node.js) yang menjembatani aplikasi pengembang dengan 200+ model LLM melalui satu *Unified API*. Dirancang dengan prinsip **Zero Runtime Dependencies** guna meminimalisir *downtime* dengan otomatisasi failover, retries, load balancing, perlindungan privasi (PII Reversible Vault), pertahanan injeksi prompt & steganografi (Steganography Firewall 2.0), optimasi latensi ekor (Hedged Requests), memori kognitif terpadu (Cognitive Brain Tri-Memory), orkestrasi agen paralel (Map-Reduce Swarm dengan Deep-Merge atomik), loop konsensus koreksi-mandiri (Actor-Critic Swarm Loop), alur kerja tangguh (Streaming Durable Workflows dengan HITL dan pembersihan checkpoint permanen), penelusuran terdistribusi OpenTelemetry GenAI v1.30+, serta integrasi enterprise cloud (AWS Bedrock SigV4 & Azure OpenAI) dan MCP eksternal yang mampu memulihkan drift skema secara otonom.

## 2. Lingkup Produk (Scope)
- **Target Pengguna**: Pengembang Backend/Fullstack, AI Engineers, Tim DevOps, Multi-Agent Swarm Designers, dan Enterprise AI Platform.
- **Platform Dukungan**: Node.js 18+, Bun 1.0+, Deno 2.x, Cloudflare Workers, dan Vercel Edge Runtime.
- **Batasan (Out of Scope)**:
  - Tidak mengirim telemetry, API Keys, atau payload prompt ke server cloud milik SinapsAI (100% lokal & private).
  - Tidak memuat dependensi runtime eksternal pihak ketiga (Zero Runtime Dependencies invariant).

---

## 3. Fitur Utama (Functional Specifications)

### A. Core Routing, Resilience & Fault Tolerance
- **Unified API**: Berkomunikasi dengan 12 provider kelas dunia: OpenAI, Anthropic Claude, Google Gemini, AWS Bedrock, Azure OpenAI, Groq LPU, DeepSeek, Mistral AI, Ollama, OpenRouter, xAI Grok, dan Cohere v2 menggunakan format OpenAI Chat Completions & Embeddings.
- **Multi-Strategy Dynamic Routing**:
  - `failover`: Urutan prioritas tetap dengan fallback berjenjang.
  - `load-balance`: Round-Robin antar API key dan provider untuk memaksimalkan kuota dan throughput.
  - `lowest-cost`: Perutean dinamis memprioritaskan biaya terendah berdasarkan dual-pricing (input vs output tokens).
  - `lowest-latency`: Perutean berbasis Exponential Moving Average (EMA) latency dengan auto-probing.
  - `adaptive` / `smart-hybrid`: Skoring multi-faktor memadukan reliability (Laplace smoothed), latensi bergerak, dan estimasi biaya per request.
- **Circuit Breaker dengan Strict Canary Probing**: Transisi status otomatis (`CLOSED`, `OPEN`, `HALF_OPEN`) dengan satu probe kanari tunggal anti-thundering-herd serta inspeksi status pasif/aktif (`client.getCircuitBreakerStatus()` & `client.resetCircuitBreaker()`).
- **Active Canary Health Probing (`client.canary`)**: Probe latar belakang non-blocking untuk mendeteksi pemadaman provider lebih awal sebelum request user tiba.
- **Speculative Hedged Requests (`HedgedExecutor`)**: Meluncurkan request cadangan setelah ambang batas delay (`delayMs`) untuk memangkas latensi ekor (P99/P99.9) pada provider redundan dengan pembatalan instan (`AbortController`).
- **Hierarchical Model-Level Fallback Engine**: Rantai model cadangan sekunder otomatis pada level provider dan request.
- **Google Gemini 4 Frontier Availability Fallbacks**: Otomatis fallback ke `gemini-3.8-flash` saat model `gemini-4-argon`, `gemini-4-pro`, atau `gemini-4-flash` belum terprovisi atau mengalami rate limiting.
- **In-Process Gateway Rate Limiter (`GatewayRateLimiter`)**: Algoritma sliding-window berbobot sub-window tanpa dependensi eksternal untuk kuota Requests Per Minute (RPM) dan Tokens Per Minute (TPM) dengan counter atomik (`storage.increment`) dan penyesuaian paska-respons non-streaming dan streaming.

### B. Security, Privacy & FinOps Guardrails
- **In-Process Zero-Dependency PII Guardrails (`PIIGuardrails`)**: Deteksi dan redaksi otomatis data sensitif (email, nomor telepon internasional/lokal, kartu kredit dengan validasi algoritma Luhn, SSN, IPv4/IPv6, nomor paspor, IBAN, JWT, dan URL). Mendukung mode **Reversible Tokenization Vault** untuk mendekripsi respons non-streaming maupun streaming secara real-time.
- **Prompt Injection & Security Guardrails (`SecurityGuardrails`)**: Deteksi heuristik zero-dependency untuk prompt injection, jailbreak ("DAN", "evil confidant"), manipulasi system role, delimiter hijacking, dan secret exfiltration dengan proteksi ReDoS (zero-length match advancing) dan replacer function anti-injection.
- **Steganography Firewall 2.0**: Deteksi dan netralisasi otomatis karakter Zero-Width (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`, `\u2060`, `\u180E`), penyelundupan karakter tag ASCII (`\u{E0000}-\u{E007F}`), pembalikan arah teks Bidi (`\u202A-\u202E`), dan normalisasi Unicode NFKC menyeluruh guna menangkal serangan prompt injection tersembunyi.
- **Prototype Pollution Immunity**: Sanitasi atribut berbahaya (`__proto__`, `constructor`, `prototype`) saat kanonikalisasi skema JSON tools di `GeminiAgentBooster`.
- **FinOps Spend & Token Guardrails (`BudgetGuardrails`)**: Pembatasan batas pengeluaran kumulatif USD (`maxCostUsd`) dan volume token (`maxTotalTokens`) dengan mode pemblokiran keras (`BudgetExceededError`) atau peringatan lembut (`warn`).
- **In-Process Dynamic Context Compressor (`ContextCompressor`)**: Estimasi token zero-dependency (~4 chars per token) dan pemotongan cerdas (`sliding-window` & `middle-out`) yang mengamankan pesan sistem dan mempreservasi grup pemanggilan fungsi tool secara atomik.
- **Universal LLM Optimization Engine (`LlmOptimizer` / LLMO)**: Optimasi prompt minification cerdas ramah blok kode, deduplikasi instruksi sistem, kanonikalisasi urutan tools dan JSON schema untuk memaksimalkan KV-cache prefix hits, skoring kompleksitas multi-sinyal [0.0, 1.0], adaptive model cascading 3-tier, serta evaluasi keyakinan respons (*confidence-calibrated cascading*).

### C. Multi-Agent Swarm, Cognitive Brain & Durable Workflows
- **Unified In-Process Cognitive Brain (`CognitiveBrain`, `client.brain`)**:
  - *Tri-Memory Fusion Architecture*: Memadukan Memori Episodik Vektor (fakta profil pengguna), In-Memory Knowledge Graph (triples entitas relasional), dan Hybrid RAG (BM25 sparse + Dense Vector Reciprocal Rank Fusion) dalam satu pemanggilan konteks terpadu (`retrieveContext`).
  - Proteksi alokasi memori in-memory LRU cache dan memory byte cap untuk keandalan di edge/serverless runtime.
- **In-Process Multi-Agent Swarm & Agent-to-Agent (A2A) Handoff Protocol (`client.swarm`)**:
  - Orkestrasi agen otonom sekuensial (handoff dinamis dengan alat otomatis `transfer_to_<agent_id>`).
  - Proteksi deadlock dan ping-pong recursion (`maxHandoffs`).
  - Memori konteks bersama thread-safe (`SwarmContext`).
  - Ekspor manifesto kartu agen standar terbuka A2A (`exportAgentCards()`) sesuai spesifikasi `/.well-known/agent.json`.
- **Parallel Subagent Swarm with Map-Reduce (`client.swarm.runParallel`)**:
  - Eksekusi serentak cabang sub-agen spesialis (`Promise.all`) dengan pemisahan konteks (*context pruning*) untuk mencegah context window explosion.
  - Sintesis agregator cerdas (*Map-Reduce*) yang merangkum temuan seluruh sub-agen ke dalam satu respons terpadu.
  - **Atomic Concurrency Deep-Merge (`deepMergeContext`)**: Penggabungan mutasi state cabang agen paralel secara rekursif, dengan union dan deduplikasi array serta penanganan konflik kustom (`onContextConflict`).
- **Actor-Critic Self-Correcting Consensus Swarm Loop (`client.swarm.runActorCritic`, `AgentSwarm.runActorCritic`)**:
  - Alur iterasi perbaikan mandiri otomatis: Agen Worker/Implementer menyusun draft solusi kode/teks, Agen Reviewer/Critic mengevaluasi kepatuhan terhadap rubrik kualitas dan skor kebenaran [0–100].
  - Siklus revisi berkelanjutan berpandukan umpan balik terstruktur hingga tercapai status `APPROVED` atau batas skor (`minScore`), dengan pelaporan progres live (`onIteration`).
- **Durable Agent Workflows, Streaming Events & Checkpoint Deletion (`client.workflows`)**:
  - Checkpoint state per langkah agen ke `StateStorage` (Memory, Redis, D1, Cloudflare KV).
  - Penangguhan alur kerja otomatis pada aksi/tool berisiko tinggi dengan status `waiting_approval` (Human-in-the-Loop).
  - Resumption API instan tanpa pengulangan eksekusi tool terdahulu setelah otorisasi diberikan.
  - **Streaming Workflows (`onStep`)**: Penyiaran real-time event langkah alur kerja ke antarmuka WebSocket atau Server-Sent Events (SSE).
  - **Permanent Checkpoint Deletion (`deleteWorkflow`)**: Penghapusan instan seluruh state dan checkpoint alur kerja guna mematuhi hak pelindungan data.
- **Universal External MCP Client Ingestion (`client.mcp.connectExternalServer`)**:
  - Transport ganda zero-dependency: Stdio transport (Node.js/Bun) dan SSE/HTTP transport (Edge/Serverless).
  - Penemuan alat otomatis (`tools/list`) dan pemetaan ke Unified Tool Definition.
- **Autonomous API Schema Drift & Argument Self-Healer (`AutonomousDriftHealer`)**:
  - Heuristik koreksi parameter tool runtime otomatis (fuzzy renaming, deep type coercion, default values injection) dan penerjemah kode error provider upstream.
- **In-Process LLM Evals & Faithfulness Sentinel (`client.evals` & `client.sentinel`)**:
  - Evaluasi groundedness klaim terhadap konteks RAG, relevansi query, dan deteksi halusinasi zero-dependency.

### D. Enterprise Cloud Providers
- **AWS Bedrock Provider (`AwsBedrockProvider`)**:
  - Converse API (`/model/{modelId}/converse`) mendukung Claude 3.7/3.5, Amazon Nova (Pro/Lite/Micro), Meta Llama 3.3/3.1, dan Mistral Large.
  - Implementasi penandatanganan request AWS SigV4 murni menggunakan Web Crypto standard (`crypto.subtle`) tanpa dependensi eksternal `@aws-sdk/client-bedrock-runtime`.
  - Dukungan tool calling otomatis, mapping JSON schema, system prompt translation, dan session token credentials.
- **Azure OpenAI Service Provider (`AzureOpenAiProvider`)**:
  - Resolusi endpoint deployment kustom (`https://{resourceName}.openai.azure.com/openai/deployments/{deploymentId}`).
  - Autentikasi ganda: Azure `api-key` header dan Microsoft Entra ID Bearer token.
  - Dukungan penuh Chat Completions, Embeddings API, streaming SSE, dan ekstraksi header rate limit Azure.

### E. Observability, Telemetry & Ecosystem
- **Native OpenTelemetry GenAI Semantic Conventions v1.30+ Tracing (`client.exportOtelTraces`, `client.toOtelTraces`)**:
  - Format eksposisi JSON OTLP Traces (`/v1/traces`) standar industri untuk visualisasi distributed spans di Langfuse, Arize Phoenix, Datadog, dan Jaeger.
- **Native Prometheus & OpenMetrics Exporter (`client.exportPrometheusMetrics`)**:
  - Format teks standar Prometheus/OpenMetrics mengekspos request counter, latency gauge, breakdown token, dan biaya USD per provider.
- **Embedded Web UI Dashboard Server (`DashboardServer`, port default: 3140)**:
  - Dashboard web lokal zero-dependency responsif dark-mode untuk inspeksi KPI real-time, status Circuit Breaker, Active Canary, riwayat request, dan API traces.
- **Standalone CLI Gateway & MCP Stdio Server**:
  - `sinapsai serve`: Server HTTP mandiri kompatibel format OpenAI (`/v1/chat/completions`, `/v1/models`, `/health`, `/metrics`).
  - `sinapsai mcp`: Stdio JSON-RPC 2.0 bridge untuk Claude Desktop, Cursor, Antigravity, dan Windsurf.
- **Official Vercel AI SDK Adapter (`sinapsai/ai-sdk`)**:
  - Implementasi spesifikasi resmi `LanguageModelV1` dan `EmbeddingModelV1` untuk integrasi mulus dengan `streamText`, `generateText`, `streamObject`, dan `embed`.
- **Zero-Dependency Type-Safe Schema Builder (`s`, `client.s`)**:
  - Builder skema deklaratif fluent bergaya Zod dengan validasi runtime dan kompilasi otomatis ke JSON Schema.

---

## 4. Kepatuhan Hukum, Privasi & Trio Legal Wajib (Legal Trio Invariant)
Sesuai amanat UU No. 27/2022 tentang Pelindungan Data Pribadi (UU PDP), EU GDPR Art. 17 (*Right to be Forgotten*), dan kebijakan Apple App Store / Google Play, SinapsAI dirancang dengan prinsip *Privacy-by-Design*:
1. **Kebijakan Privasi (/privacy)**: SinapsAI beroperasi 100% in-process. Tidak ada data pengguna, API key, atau konten percakapan yang dikirim ke server pusat pihak ketiga.
2. **Syarat & Ketentuan (/terms)**: Lisensi MIT terbuka, tanggung jawab kepatuhan kunci API penyedia LLM berada di tangan developer pengguna.
3. **Alur & Endpoint Penghapusan Data (/delete-account & /data-deletion)**: API terpadu `client.clearCache()`, `client.brain.memory.delete(id)`, dan `client.workflows.delete(workflowId)` menjamin seluruh memori episodik, jejak audit, state alur kerja, dan penyimpanan lokal/terdistribusi dapat dihapus secara permanen seketika.

---

## 5. Non-Functional Requirements (NFR)
- **Performa Eksekusi**: Overhead proses internal sangat minim (<5ms, sub-millisecond cache hits).
- **Zero Runtime Dependencies**: Murni memanfaatkan standar runtime web (`fetch`, Web Streams, EventSource SSE, Web Crypto, Node HTTP).
- **Edge Runtime Certified**: Kompatibel 100% di Node.js 18+, Bun, Deno, dan Cloudflare Workers.
- **Type Safety**: TypeScript strict mode dengan isolated declarations dan types definition lengkap (`dist/index.d.ts`).
- **Verifikasi Kualitas**: 575/575 unit & integration tests lulus di 55 test suites (100% pass rate), 100% Biome clean (0 error, 0 warning), dan 45 contoh siap pakai di `examples/`.
