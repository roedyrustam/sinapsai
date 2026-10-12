# Dokumentasi SinapsAI

## Ikhtisar
SinapsAI adalah paket NPM Node.js/TypeScript lokal yang berfungsi sebagai *Control Plane / AI Gateway*. Paket ini menghubungkan aplikasi Anda ke berbagai penyedia LLM (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Mistral AI, Ollama, Groq, OpenRouter) melalui antarmuka API yang bersatu (*Unified API*).

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
  MistralProvider,
  GeminiProvider 
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ 
      apiKey: process.env.OPENAI_API_KEY! 
    }),
    new MistralProvider({
      apiKey: process.env.MISTRAL_API_KEY!,
      defaultModel: 'mistral-large-latest',
    }),
    new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      defaultModel: 'text-embedding-004',
    }),
  ],
});

async function run() {
  // 1. Chat Completions
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Halo, AI!' }],
  });
  console.log(response.choices[0].message.content);

  // 2. Unified Embeddings (OpenAI, Gemini, Mistral, Ollama)
  const embedding = await client.embeddings.create({
    model: 'text-embedding-004',
    input: 'Teks pencarian semantik',
  });
  console.log('Embedding dimensions:', embedding.data[0].embedding.length);

  // 3. Inspeksi Status Circuit Breaker Waktu-Nyata
  const cbStatus = await client.getCircuitBreakerStatus();
  console.log('Circuit Status:', cbStatus);

  // 4. Reset Circuit Breaker & Pembersihan Cache
  await client.resetCircuitBreaker();
  await client.clearCache();

  // 5. Telemetri Real-Time In-Process
  const metrics = client.getMetrics();
  console.log('Total Requests:', metrics.totalRequests);
  console.log('Estimated USD Spend:', metrics.estimatedCostUsd);
}
run();
```

## Fitur Utama v1.6.0
1. **Dukungan Native Mistral AI (`MistralProvider`)**: Eksekusi chat, tools, JSON mode, dan embeddings (`mistral-embed`) dengan penanganan rate-limit otomatis.
2. **Google Gemini Embeddings (`GeminiProvider.generateEmbedding`)**: Mendukung model `text-embedding-004` baik untuk string tunggal (`embedContent`) maupun batch array (`batchEmbedContents`).
3. **Inspeksi & Pemulihan Circuit Breaker (`getCircuitBreakerStatus`, `resetCircuitBreaker`)**: Pemantauan status sirkuit (`CLOSED`, `OPEN`, `HALF_OPEN`), jumlah kegagalan/sukses per provider, serta kemampuan reset manual programatik.
4. **Pembersihan Cache In-Process (`clearCache`)**: Mengosongkan memori cache respon prompt dan embeddings secara instan saat dibutuhkan.
5. **Dual-Token Pricing (`promptCostPer1k`, `completionCostPer1k`)**: Perhitungan biaya dinamis dan perutean `lowest-cost` otomatis berdasarkan rasio panjang prompt dan token keluaran.
6. **Adaptive Rate-Limiting & Proactive Throttling**: Ekstraksi header kuota rate-limit (`x-ratelimit-*`, `retry-after`) secara otomatis guna mencegah HTTP 429.
7. **OpenRouter Free Tier (`createOpenRouterFreeProvider`)**: Integrasi penuh katalog model gratis [OpenRouter](https://openrouter.ai/models?variant=free) dengan biaya $0 otomatis, meta-router `openrouter/free`, rantai fallback model native (`fallbackModels`), header peringkat (`siteUrl`, `siteName`), serta penemuan model gratis live via `OpenRouterProvider.fetchFreeModels()`.


## Keamanan & Performa
- **100% Lokal:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Overhead:** Desain lokal menjamin tambahan latensi < 10ms.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE). Anda bebas menyalin, memodifikasi, dan mendistribusikan proyek ini untuk tujuan apa pun (termasuk komersial) dengan mencantumkan atribusi yang sesuai.

