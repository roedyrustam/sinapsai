# Product Requirements Document (PRD) - SinapsAI

## 1. Visi Produk
Menciptakan "Control Plane" AI lokal berbasis NPM package (TypeScript/Node.js) yang menjembatani aplikasi pengembang dengan 200+ penyedia LLM melalui satu *Unified API*. Paket ini dirancang untuk meminimalisir *downtime* dengan otomatisasi failover, retries, dan load balancing secara lokal (*in-memory*), tanpa kompromi pada performa (<10ms overhead) maupun privasi data.

## 2. Lingkup Produk (Scope)
- **Target Pengguna**: Pengembang Backend/Fullstack, Tim DevOps.
- **Platform Dukungan**: Lingkungan berbasis Node.js dan TypeScript.
- **Batasan (Out of Scope)**: 
  - Tidak menyediakan UI Dashboard web (fokus pada core library / SDK murni).
  - Tidak mengirim telemetry / API Keys ke server cloud milik SinapsAI (100% lokal).

## 3. Fitur Utama
- **Unified API**: Berkomunikasi dengan OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Ollama, dan OpenRouter menggunakan struktur payload seragam (standar format OpenAI Chat Completions & Embeddings).
- **Universal Frontier Reasoning Engine**: Kontrol terpadu Chain-of-Thought lintas model frontier (`thinkingBudget`, `reasoningEffort: 'low' | 'medium' | 'high'`, dan ekstraksi `message.reasoning_content`) untuk Claude 3.7 Sonnet, OpenAI o1/o3/o4, Groq LPU, DeepSeek R1, dan Google Gemini 2.0/2.5/3.x.
- **Latency-Based Dynamic Routing (`lowest-latency`)**: Perutean adaptif ke provider tercepat berdasarkan moving average latency, dengan probing inisial otomatis dan failover instan.
- **KV-Cache & Prompt Caching Analytics**: Penjejakan `cachedPromptTokens` per provider dan global (`totalCachedPromptTokens`) untuk mengaudit penghematan biaya token cloud 70-90%.
- **Automated Fallback & Exponential Retries**: Memanggil provider/model cadangan secara otomatis jika terjadi downtime, timeout, atau rate limit, dilengkapi jitter backoff.
- **Load Balancing**: Merutekan traffic ke sejumlah API Key atau endpoint secara rotasi (*Round Robin*) untuk memaksimalkan throughput.
- **In-Memory Circuit Breaker**: Memutus rute permintaan ke provider yang secara konstan gagal (*OPEN*) dengan auto-recovery (*HALF_OPEN* -> *CLOSED*) dan manual inspect/reset API.
- **Unified Embeddings**: Pipeline embedding dengan caching in-memory hash, automatic failover, dan dukungan MRL dimensionality reduction.
- **Adaptive Rate Limiting & Proactive Throttling**: Parser header rate-limit otomatis (`x-ratelimit-*`, durasi detik/menit Groq `7.66s`, `retry-after`) yang menahan request sebelum error 429 terjadi di jaringan.

## 4. Non-Functional Requirements (NFR)
- **Performa Eksekusi**: Overhead proses internal sangat minim (<5ms, sub-millisecond cache hits).
- **Zero Heavy Dependencies**: Murni memanfaatkan standar runtime web (`fetch`, Web Streams, EventSource SSE).
- **Edge Runtime Certified**: Kompatibel 100% di Node.js 18+, Bun, Deno, dan Cloudflare Workers.
- **Manajemen State**: Berjalan *in-memory* secara default dengan antarmuka `StateStorage` yang dapat diekstensikan.

