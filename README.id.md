# ⚡ SinapsAI

<p align="center">
  <a href="./README.md">English</a> •
  <b>Bahasa Indonesia</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sinapsai"><img src="https://img.shields.io/npm/v/sinapsai.svg" alt="npm version" /></a>
  <a href="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml"><img src="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome" /></a>
  <a href="https://creativecommons.org/licenses/by/4.0/"><img src="https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg" alt="License: CC BY 4.0" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" alt="TypeScript Ready" /></a>
  <img src="https://img.shields.io/badge/Tests-70%20Passed-brightgreen.svg" alt="Tests Passed" />
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%3E%3D18.0.0-green.svg" alt="Node >= 18.0.0" /></a>
</p>

**SinapsAI** adalah *Local AI Control Plane* & *Unified Gateway* berbasis Node.js dan TypeScript. SinapsAI dirancang untuk menjembatani aplikasi Anda dengan berbagai penyedia LLM (OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, dan penyedia mandiri) melalui satu antarmuka terpadu (*Unified API*).

Dibangun dengan pendekatan **100% in-process / in-memory**, SinapsAI meminimalisir *downtime* dengan failover otomatis, load balancing, dan *Circuit Breaker* tanpa memerlukan server gateway perantara, tanpa database/Redis tambahan, serta dengan overhead latensi minimal (<10ms).

---

## 🥊 Mengapa SinapsAI?

Sebagian besar gateway AI populer (LiteLLM, Portkey, Helicone) mengharuskan Anda menjalankan container Docker terpisah, menyiapkan Redis/PostgreSQL, atau mengirimkan API keys dan prompt pengguna melalui server pihak ketiga.

**SinapsAI berjalan langsung di dalam proses aplikasi Node.js Anda:**

| Fitur | **SinapsAI** ⚡ | SDK Provider Langsung | Cloud Gateway (Portkey/Helicone) | LiteLLM Proxy |
| :--- | :---: | :---: | :---: | :---: |
| **Bebas Infrastruktur Tambahan** (Tanpa Docker/Redis) | ✅ **100% In-Process** | ✅ Ya | ❌ Perlu Akun Cloud Pihak Ketiga | ❌ Perlu Docker / Python |
| **Tambahan Latensi Eksekusi** | ⚡ **<10ms** | 0ms | ⚠️ +50ms s/d +250ms (Extra hop) | ⚠️ +20ms s/d +80ms |
| **Privasi Data & Kunci API** | 🔒 **Zero Data Leakage** | 🔒 Langsung | ⚠️ Melalui Gateway Pihak Ketiga | 🔒 Self-hosted |
| **In-Memory Circuit Breaker** | ✅ **Bawaan** | ❌ Manual coding | ⚠️ Fitur cloud | ⚠️ Retry dasar |
| **Failover Multi-Provider Otomatis** | ✅ **Bawaan** | ❌ Tidak ada | ✅ Ya | ✅ Ya |
| **Round-Robin Load Balancing** | ✅ **Bawaan** | ❌ Tidak ada | ✅ Ya | ✅ Ya |
| **Perutean Biaya Terendah (Lowest Cost)** | ✅ **Bawaan** | ❌ Tidak ada | ⚠️ Paket berbayar | ✅ Ya |
| **Native TypeScript (Zero Runtime Deps)**| ✅ **Native `fetch`** | ⚠️ Bervariasi | ❌ Layanan terpisah | ❌ Python |

> 📁 Ingin langsung mencoba kodenya? Kunjungi **[Folder Contoh Kode (`/examples`)](./examples)**!

---

## 📑 Daftar Isi

- [Mengapa SinapsAI?](#-mengapa-sinapsai)
- [Fitur Utama](#-fitur-utama)
- [Arsitektur & Alur Kerja](#-arsitektur--alur-kerja)
- [Instalasi](#-instalasi)
- [Panduan Penggunaan Cepat](#-panduan-penggunaan-cepat)
  - [1. Inisialisasi Klien & Failover Otomatis](#1-inisialisasi-klien--failover-otomatis)
  - [2. Streaming Respons Real-Time (SSE)](#2-streaming-respons-real-time-sse)
  - [3. Round-Robin Load Balancing](#3-round-robin-load-balancing)
  - [4. Perutean Biaya Terendah (Lowest Cost)](#4-perutean-biaya-terendah-lowest-cost)
  - [5. Observabilitas via Event Hooks](#5-observabilitas-via-event-hooks)
  - [6. Retries dengan Exponential Backoff & Jitter](#6-retries-dengan-exponential-backoff--jitter)
  - [7. In-Memory Prompt Response Caching](#7-in-memory-prompt-response-caching)
  - [8. Tool Calling & Eksekusi Fungsi](#8-tool-calling--eksekusi-fungsi)
  - [9. Structured Outputs (JSON Mode)](#9-structured-outputs-json-mode)
- [Penyedia yang Didukung (Providers)](#-penyedia-yang-didukung-providers)
  - [Membuat Provider Kustom](#membuat-provider-kustom-contoh-ollama)
- [Referensi Konfigurasi](#-referensi-konfigurasi)
- [Pengujian & Pengembangan](#-pengujian--pengembangan)
- [Cara Berkontribusi](#-cara-berkontribusi)
- [Lisensi](#-lisensi)

---

## ✨ Fitur Utama

- 🌐 **Unified API**: Berkomunikasi dengan berbagai model LLM menggunakan format request & response standar yang kompatibel dengan format OpenAI Chat Completions.
- 🛠️ **Universal Tool Calling & JSON Mode**: Definisikan fungsi/tools sekali saja dengan format JSON Schema standar (`tools`, `toolChoice`). SinapsAI secara otomatis mengonversikannya ke format XML/tools Anthropic Claude, fungsi Gemini, dan OpenAI.
- 🛡️ **In-Memory Circuit Breaker**: Mendeteksi lonjakan error provider secara instan dan membuka sirkuit (*Open Circuit*) guna mencegah *cascading failures* dan waktu tunggu (timeout) yang berlebihan.
- 🔀 **Strategi Perutean Fleksibel**:
  - `failover`: Otomatis beralih ke provider berikutnya secara instan saat provider utama mengalami error / timeout.
  - `load-balance`: Membagi lalu lintas permintaan secara rotasi (*Round-Robin*) untuk menghindari pembatasan kuota (*Rate Limit 429*).
  - `lowest-cost`: Mengurutkan dan merutekan permintaan ke provider termurah berdasarkan konfigurasi `costPer1kTokens`.
- ⚡ **Exponential Backoff & Retries**: Mencoba ulang kegagalan jaringan sementara (429, 5xx) dengan jitter acak sebelum melakukan failover.
- 💾 **In-Memory Prompt Hash Caching**: Menyimpan cache respons di memori dengan TTL untuk prompt identik sehingga menghemat token dan waktu respons.
- 🌊 **Dukungan Streaming SSE**: Streaming respons teks *real-time* menggunakan async generator native (`for await...of`).
- 🔒 **Privasi & Keamanan Penuh**: 100% berjalan lokal di memori proses aplikasi Anda. Kunci API dan konten prompt tidak pernah dikirimkan ke server pihak ketiga.
- 🪝 **Event Hooks Lengkap**: Memantau siklus hidup request (`onSuccess`, `onFallback`, `onCircuitOpen`, `onCircuitClose`, `onRateLimit`, `onRetry`) untuk integrasi ke sistem APM, Prometheus, atau logging.

---

## 🏛️ Arsitektur & Alur Kerja

```
Aplikasi Klien
      │
      ▼
┌────────────────────────────────────────────────────────┐
│                      SinapsClient                      │
│            chat.completions.create(request)            │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                         Router                         │
│   Strategi: 'failover' | 'load-balance' | 'lowest-cost' │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                     CircuitBreaker                     │
│    Mengecek State: [ CLOSED | OPEN | HALF_OPEN ]       │
└──────────────────────────┬─────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
    [Sirkuit CLOSED]                [Sirkuit OPEN]
Eksekusi ke Provider Terpilih   Lewati & Coba Provider Cadangan
           │                               │
     ┌─────┴─────┐                         │
  Sukses       Gagal                       │
     │           │                         ▼
     ▼           └──────────────► Fallback Otomatis
Kembalikan Response               (Trigger onFallback Hook)
```

---

## 📦 Instalasi

Pasang paket melalui manajer paket favorit Anda:

```bash
# Menggunakan NPM
npm install sinapsai

# Menggunakan PNPM
pnpm add sinapsai

# Menggunakan Yarn
yarn add sinapsai

# Menggunakan Bun
bun add sinapsai
```

---

## 🚀 Panduan Penggunaan Cepat

### 1. Inisialisasi Klien & Failover Otomatis

Jika provider utama (misalnya OpenAI) mengalami kegagalan, SinapsAI akan secara transparan mengalihkan permintaan ke provider cadangan (Anthropic Claude / Google Gemini):

```typescript
import { 
  SinapsClient, 
  OpenAiProvider, 
  AnthropicProvider, 
  GeminiProvider 
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }),
  ],
  circuitBreaker: {
    failureThreshold: 3,        // Buka sirkuit setelah 3 kegagalan beruntun
    recoverySuccessThreshold: 2, // Pulihkan sirkuit setelah 2 panggilan sukses
    resetTimeoutMs: 30000,      // Tunggu 30 detik sebelum mencoba uji sirkuit (Half-Open)
  },
  hooks: {
    onFallback: (error, fromProvider, toProvider) => {
      console.warn(`[Failover] ${fromProvider.name} gagal (${error.message}). Mengalihkan ke ${toProvider.name}...`);
    },
    onCircuitOpen: (provider) => {
      console.error(`[Circuit Breaker] Sirkuit untuk ${provider.name} DIBUKA.`);
    },
  },
});

async function main() {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Anda adalah asisten AI yang ramah dan solutif.' },
      { role: 'user', content: 'Jelaskan cara kerja distributed lock secara singkat!' },
    ],
    temperature: 0.7,
  });

  if ('choices' in response) {
    console.log('Jawaban:', response.choices[0]?.message.content);
    console.log('Penggunaan Token:', response.usage);
  }
}

main().catch(console.error);
```

---

### 2. Streaming Respons Real-Time (SSE)

Gunakan parameter `stream: true` untuk menerima output secara bertahap:

```typescript
import { SinapsClient, OpenAiProvider } from 'sinapsai';

const client = new SinapsClient({
  providers: [new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! })],
});

async function streamDemo() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Buatlah puisi 4 bait tentang fajar.' }],
    stream: true,
  });

  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta.content || '';
      process.stdout.write(content);
    }
    console.log('\n--- Selesai Streaming ---');
  }
}

streamDemo();
```

---

### 3. Round-Robin Load Balancing

Distribusikan beban ke beberapa API key atau endpoint guna mengoptimalkan throughput dan mencegah rate limits:

```typescript
import { SinapsClient, GroqProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'load-balance',
  providers: [
    new GroqProvider({ id: 'groq-pool-1', apiKey: process.env.GROQ_API_KEY_1! }),
    new GroqProvider({ id: 'groq-pool-2', apiKey: process.env.GROQ_API_KEY_2! }),
    new GroqProvider({ id: 'groq-pool-3', apiKey: process.env.GROQ_API_KEY_3! }),
  ],
});
```

---

### 4. Perutean Biaya Terendah (Lowest Cost)

SinapsAI akan secara otomatis memprioritaskan provider dengan konfigurasi `costPer1kTokens` termurah:

```typescript
import { SinapsClient, OpenAiProvider, GroqProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'lowest-cost',
  providers: [
    new OpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      costPer1kTokens: 0.005,
    }),
    new GroqProvider({
      apiKey: process.env.GROQ_API_KEY!,
      costPer1kTokens: 0.0005, // Akan dipanggil pertama kali karena termurah
    }),
  ],
});
```

---

### 5. Observabilitas via Event Hooks

Tangkap seluruh aktivitas penting secara terprogram:

```typescript
const client = new SinapsClient({
  providers: [...],
  hooks: {
    onSuccess: (provider, response, latencyMs) => {
      metrics.recordLatency(provider.name, latencyMs);
      console.log(`[Success] ${provider.name} selesai dalam ${latencyMs}ms`);
    },
    onFallback: (error, fromProvider, toProvider) => {
      metrics.increment('ai.gateway.fallback', { from: fromProvider.name, to: toProvider.name });
    },
    onCircuitOpen: (provider) => {
      alerts.send(`Perhatian: Sirkuit provider ${provider.name} mengalami down.`);
    },
    onCircuitClose: (provider) => {
      alerts.send(`Pemulihan: Sirkuit provider ${provider.name} telah pulih normal.`);
    },
    onRateLimit: (provider, error) => {
      metrics.increment('ai.gateway.rate_limited', { provider: provider.name });
    },
    onRetry: (provider, error, attempt, delayMs) => {
      console.warn(`[Retry] Mencoba ulang ${provider.name} (percobaan ${attempt}) setelah ${Math.round(delayMs)}ms...`);
    },
  },
});
```

---

### 6. Retries Otomatis dengan Exponential Backoff & Jitter

Konfigurasikan percobaan ulang otomatis untuk menangani lonjakan error jaringan sesaat (5xx, timeout, 429) sebelum berpindah ke provider cadangan:

```typescript
const client = new SinapsClient({
  retries: 2,            // Maksimal 2x retry per provider
  retryDelayMs: 250,     // Delay awal backoff (otomatis berlipat ganda + random jitter)
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  ],
});
```

---

### 7. In-Memory Response Caching

Layani permintaan prompt yang identik secara instan dengan 0ms latensi dan tanpa konsumsi token tambahan:

```typescript
const client = new SinapsClient({
  cache: {
    enabled: true,       // Aktifkan in-memory cache
    ttlSeconds: 300,     // Masa aktif cache (default: 5 menit)
  },
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
});
```

---

### 8. Tool Calling & Eksekusi Fungsi

Definisikan format fungsi sekali saja menggunakan format JSON Schema OpenAI standar. SinapsAI secara otomatis mengonversikannya untuk OpenAI, Anthropic Claude, dan Google Gemini:

```typescript
import { SinapsClient, OpenAiProvider, AnthropicProvider, GeminiProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }),
  ],
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Berapa harga saham Apple (AAPL) saat ini?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_stock_price',
        description: 'Mendapatkan harga saham terkini berdasarkan simbol ticker',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Simbol saham, contoh: AAPL' },
          },
          required: ['symbol'],
        },
      },
    },
  ],
  toolChoice: 'auto',
});

if (response.choices[0].finishReason === 'tool_calls') {
  const toolCall = response.choices[0].message.tool_calls?.[0];
  console.log('Fungsi yang dipanggil:', toolCall?.function.name);
  console.log('Argumen:', toolCall?.function.arguments);
}
```

---

### 9. Structured Outputs (JSON Mode)

Pastikan model selalu menghasilkan output objek JSON yang valid dan konsisten (`responseFormat: { type: 'json_object' }`):

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Anda adalah ekstraktor data. Selalu kembalikan respons dalam format JSON.' },
    { role: 'user', content: 'Buat profil singkat untuk Budi, usia 28, engineer di Jakarta.' },
  ],
  responseFormat: { type: 'json_object' },
});

const data = JSON.parse(response.choices[0].message.content || '{}');
console.log(data);
```

---

## 🧩 Penyedia yang Didukung (Providers)

| Provider | Kelas Ekspor | Parameter Tambahan |
| :--- | :--- | :--- |
| **OpenAI** | `OpenAiProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Anthropic Claude** | `AnthropicProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Google Gemini** | `GeminiProvider` | `apiVersion`, `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Groq** | `GroqProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **OpenRouter** | `OpenRouterProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Custom / On-Prem** | `Provider` (Interface) | Implementasi mandiri untuk Ollama, LocalAI, vLLM, dll. |

### Membuat Provider Kustom (Contoh: Ollama)

```typescript
import type { Provider, UnifiedApiRequest, UnifiedApiResponse } from 'sinapsai';

export class OllamaProvider implements Provider {
  id = 'ollama-local';
  name = 'Ollama Local';

  async generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse> {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'llama3',
        messages: request.messages,
        stream: false,
      }),
    });

    const data = await response.json();
    return {
      id: `ollama-${Date.now()}`,
      model: request.model,
      choices: [
        {
          message: { role: 'assistant', content: data.message.content },
          finishReason: 'stop',
        },
      ],
    };
  }
}
```

---

## ⚙️ Referensi Konfigurasi

### `SinapsClientOptions`

| Properti | Tipe | Nilai Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `providers` | `Provider[]` | *(Wajib)* | Daftar instance provider yang digunakan |
| `strategy` | `'failover' \| 'load-balance' \| 'lowest-cost'` | `'failover'` | Algoritma perutean request |
| `storage` | `StateStorage` | `InMemoryStorage` | Tempat penyimpanan state sirkuit breaker |
| `circuitBreaker` | `CircuitBreakerOptions` | `{}` | Konfigurasi toleransi kegagalan sirkuit |
| `hooks` | `SinapsEventHooks` | `{}` | Handler event monitoring dan logging |

### `CircuitBreakerOptions`

| Properti | Tipe | Nilai Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `failureThreshold` | `number` | `5` | Jumlah kegagalan beruntun sebelum sirkuit dibuka |
| `recoverySuccessThreshold` | `number` | `2` | Jumlah keberhasilan beruntun untuk memulihkan sirkuit |
| `resetTimeoutMs` | `number` | `30000` (30s) | Durasi sirkuit tetap OPEN sebelum beralih ke HALF_OPEN |

---

## 🧪 Pengujian & Pengembangan

Proyek ini menggunakan **TypeScript**, **Biome**, dan **Vitest**:

```bash
# Menjalankan seluruh pengujian unit & integrasi
npm test

# Menjalankan linter & formatting check
npm run lint

# Membangun bundle produksi (CJS + ESM + Type Declarations)
npm run build
```

---

## 🤝 Cara Berkontribusi

Kami menyambut kontribusi dalam berbagai bentuk — provider baru, perbaikan bug, pengujian, maupun peningkatan dokumentasi!

Baca **[Panduan Berkontribusi (CONTRIBUTING.md)](./CONTRIBUTING.md)** untuk informasi lengkap tentang:
- Persiapan lingkungan pengembangan lokal
- Panduan langkah demi langkah menambahkan provider LLM baru
- Standar penulisan pengujian dengan Vitest mock
- Aturan gaya kode (Biome: indentasi, kutipan, semicolons)
- Konvensi pesan commit (Conventional Commits)
- Cara membuka Pull Request yang terstruktur dengan baik

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah **[Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE)**.

Anda bebas untuk:
- **Berbagi (Share)** — menyalin dan menyebarluaskan materi ini dalam media atau format apa pun.
- **Mengadaptasi (Adapt)** — mengubah, menggubah, dan membuat turunan dari materi ini untuk kepentingan apa pun, termasuk komersial.

Dengan syarat mencantumkan atribusi yang sesuai dan memberikan tautan ke lisensi.

---

Dibuat dengan dedikasi oleh **Roedy Rustam** & Tim Kontributor SinapsAI.
