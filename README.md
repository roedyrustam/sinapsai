# ⚡ SinapsAI

[![License: CC BY 4.0](https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/Node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

**SinapsAI** adalah *Local AI Control Plane* & *Unified Gateway* berbasis Node.js dan TypeScript. SinapsAI menjembatani aplikasi Anda dengan berbagai penyedia LLM (OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, dan penyedia kustom) melalui satu antarmuka standar (*Unified API*).

Dibangun dengan arsitektur **100% in-process / in-memory**, SinapsAI meminimalisir *downtime* dengan failover otomatis, load balancing, dan *Circuit Breaker* tanpa memerlukan server gateway perantara, tanpa Redis tambahan, serta dengan overhead latensi sangat rendah (<10ms).

---

## ✨ Fitur Utama

- 🌐 **Unified API**: Berkomunikasi dengan berbagai model LLM menggunakan format request & response standar yang kompatibel dengan pola OpenAI Chat Completions.
- 🛡️ **In-Memory Circuit Breaker**: Mendeteksi kegagalan provider secara instan dan membuka sirkuit (*Open Circuit*) guna mencegah *cascading failures* dan latensi tinggi saat provider sedang down.
- 🔀 **Strategi Perutean Fleksibel**:
  - `failover`: Otomatis beralih ke provider cadangan jika provider utama mengalami error / timeout.
  - `load-balance`: Distribusi beban permintaan secara rotasi (*Round-Robin*) untuk membagi kuota dan mencegah *Rate Limit* (429).
  - `lowest-cost`: Memilih provider termurah berdasarkan konfigurasi `costPer1kTokens`.
- 🌊 **Dukungan Streaming SSE**: Streaming respons teks *real-time* lintas provider menggunakan async generator (`for await...of`).
- 🔒 **Privasi & Keamanan Maksimal**: 100% lokal di dalam memori runtime aplikasi Anda. Tidak ada transmisi API key atau prompt ke server perantara pihak ketiga.
- 🪝 **Event Hooks**: Tangkap event siklus hidup (`onFallback`, `onCircuitOpen`, `onCircuitClose`, `onRateLimit`) untuk observabilitas dan logging aplikasi.

---

## 📦 Instalasi

```bash
npm install sinapsai
```

Atau menggunakan yarn / pnpm / bun:

```bash
pnpm add sinapsai
# atau
yarn add sinapsai
# atau
bun add sinapsai
```

---

## 🚀 Memulai Cepat (Quick Start)

### 1. Inisialisasi Klien dengan Failover

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
    failureThreshold: 3, // Buka sirkuit setelah 3 kegagalan berturut-turut
    resetTimeoutMs: 30000, // Coba kembali setelah 30 detik
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
      { role: 'system', content: 'Anda adalah asisten AI yang cerdas.' },
      { role: 'user', content: 'Jelaskan konsep Circuit Breaker secara singkat!' },
    ],
    temperature: 0.7,
  });

  // Type assertion ke response non-streaming
  if ('choices' in response) {
    console.log(response.choices[0]?.message.content);
  }
}

main().catch(console.error);
```

---

### 2. Streaming Respons Real-Time

SinapsAI mendukung streaming berbasis SSE secara native:

```typescript
import { SinapsClient, OpenAiProvider } from 'sinapsai';

const client = new SinapsClient({
  providers: [new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! })],
});

async function streamDemo() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Buatlah puisi pendek tentang kode.' }],
    stream: true,
  });

  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta.content || '';
      process.stdout.write(text);
    }
  }
}

streamDemo();
```

---

### 3. Load Balancing Antar Beberapa Kunci / Provider

Distribusikan traffic secara *Round-Robin* di antara beberapa endpoint atau API keys:

```typescript
import { SinapsClient, GroqProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'load-balance',
  providers: [
    new GroqProvider({ id: 'groq-key-1', apiKey: process.env.GROQ_KEY_1! }),
    new GroqProvider({ id: 'groq-key-2', apiKey: process.env.GROQ_KEY_2! }),
  ],
});
```

---

### 4. Perutean Biaya Terendah (Lowest Cost)

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
      costPer1kTokens: 0.0005, // Akan diprioritaskan terlebih dahulu
    }),
  ],
});
```

---

## 🧩 Penyedia yang Didukung (Supported Providers)

| Provider | Kelas | Fitur Utama |
| :--- | :--- | :--- |
| **OpenAI** | `OpenAiProvider` | GPT-4o, GPT-4o-mini, Streaming, Custom Base URL |
| **Anthropic** | `AnthropicProvider` | Claude 3.5 Sonnet, Haiku, Opus, Streaming |
| **Google Gemini** | `GeminiProvider` | Gemini 1.5 Pro, Flash, Streaming, Custom API Version |
| **Groq** | `GroqProvider` | Llama 3, Mixtral, Latensi Ultra Cepat, Streaming |
| **OpenRouter** | `OpenRouterProvider` | Agregator 200+ Model, Streaming |
| **Custom** | `Provider` (Interface) | Implementasikan interface `Provider` untuk LLM lokal (Ollama, vLLM, LM Studio) |

### Membuat Provider Kustom

```typescript
import type { Provider, UnifiedApiRequest, UnifiedApiResponse } from 'sinapsai';

export class OllamaProvider implements Provider {
  id = 'ollama-local';
  name = 'Ollama';

  async generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse> {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'llama3',
        messages: request.messages,
        stream: false,
      }),
    });

    const data = await res.json();
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

## 🏛️ Arsitektur & Cara Kerja

```
Aplikasi Anda
    │
    ▼
[SinapsClient] ─── Unified chat.completions.create()
    │
    ▼
[Router] ──────── Pilih provider berdasarkan strategi (failover / load-balance / lowest-cost)
    │
    ▼
[CircuitBreaker] ─ Periksa kondisi provider (CLOSED / OPEN / HALF_OPEN)
    │
    ├── Provider A (Sehat) ──────► Berhasil ✅
    │
    └── Provider A (Gagal) ──────► Buka Circuit Breaker ❌
                                   │
                                   └── Fallback otomatis ke Provider B ✅
```

---

## ⚙️ Opsi Konfigurasi

### `SinapsClientOptions`

```typescript
interface SinapsClientOptions {
  providers: Provider[];                    // Daftar instance provider
  strategy?: 'failover' | 'load-balance' | 'lowest-cost'; // Default: 'failover'
  storage?: StateStorage;                   // Default: InMemoryStorage
  circuitBreaker?: {
    failureThreshold?: number;             // Default: 5
    recoverySuccessThreshold?: number;     // Default: 2
    resetTimeoutMs?: number;               // Default: 30000 (30 detik)
  };
  hooks?: {
    onFallback?: (error: Error, fromProvider: Provider, toProvider: Provider) => void;
    onCircuitOpen?: (provider: Provider) => void;
    onCircuitClose?: (provider: Provider) => void;
    onRateLimit?: (provider: Provider, error: Error) => void;
  };
}
```

---

## 🧪 Pengujian (Testing)

SinapsAI dilengkapi dengan pengujian unit dan integrasi komprehensif menggunakan **Vitest**:

```bash
# Menjalankan pengujian
npm test

# Menjalankan linter & formatter (Biome)
npm run lint
```

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah **[Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE)**.

Anda bebas untuk:
- **Berbagi (Share)** — menyalin dan menyebarluaskan materi ini dalam media atau format apa pun.
- **Mengadaptasi (Adapt)** — mengubah, menggubah, dan membuat turunan dari materi ini untuk kepentingan apa pun, termasuk komersial.

Dengan syarat mencantumkan atribusi yang sesuai dan memberikan tautan ke lisensi.

---

Dibuat dengan ❤️ oleh **Roedy Rustam** & Kontributor SinapsAI.
