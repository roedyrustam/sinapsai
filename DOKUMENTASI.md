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

## Fitur Utama v2.0.1 (Resilience & Throughput Edition)
1. **Zero-Dependency Semantic In-Process Caching**: Caching respon semantik berbasis cosine similarity murni di dalam memori tanpa dependensi native eksternal. Mendukung ambang batas kemiripan (`similarityThreshold`: 0.0 s/d 1.0, default 0.90), kapasitas entri maksimum (`maxEntries`), model embedding otomatis (`embeddingModel`), serta injeksi fungsi vektor kustom (`customEmbed`). Dilengkapi lifecycle hook `onSemanticCacheHit`.
2. **Pemrosesan Batch Konkuren In-Process (`client.batch`)**: Mesin konkurensi worker pool lokal tanpa dependensi eksternal (`client.batch.chat`, `client.batch.embeddings`, dan `client.batch.create`) dengan batas konkurensi terukur (`concurrency`), pemantauan progres live (`onProgress`), dan eksekusi toleran kesalahan (*fail-soft settled mode* via `stopOnError: false`).
3. **Hierarchical Model-Level Fallbacks**: Mekanisme cadangan berjenjang 3 level (request, provider, dan client). Mencoba kandidat model alternatif pada provider aktif sebelum memicu failover lintas provider, lengkap dengan fast-failover saat mendeteksi error autentikasi 401 serta hook `onModelFallback`.
4. **Dukungan Multi-Modal Terpadu (`ContentPart[]`)**: Standar payload OpenAI terpadu untuk teks, gambar (remote URL & base64), dan audio (`input_audio`) yang otomatis diterjemahkan ke format native Anthropic Claude dan Google Gemini.
5. **Telemetri Streaming TTFT & Pengerasan Circuit Breaker**: Pengukuran presisi Time-To-First-Token (TTFT) via hook `onStreamSuccess`, akumulasi token streaming ke `UnifiedApiStreamChunk.usage`, pencegatan error di tengah stream (*mid-stream connection reset*) ke Circuit Breaker, serta perlindungan pembatalan pengguna (`AbortSignal`) agar tidak merusak metrik provider.

## Fitur Utama v2.0.0 (Superintelligence Edition)
1. **Universal Frontier Reasoning Engine**: Kontrol terpadu penalaran mendalam dan Chain-of-Thought di seluruh provider: Claude 3.7 Sonnet (`thinkingBudget`, `temperature: 1.0`, `max_tokens > budget`, streaming `thinking_delta`), OpenAI o1/o3/o4 (`reasoningEffort: 'low' | 'medium' | 'high'`, `max_completion_tokens`), Groq LPU (`reasoning_format: 'parsed'`), DeepSeek R1, dan Google Gemini Flash Thinking (`thinkingBudget`). Semua hasil penalaran disajikan seragam pada `message.reasoning_content`.
2. **Perutean Dinamis Latensi Terendah (`strategy: 'lowest-latency'`)**: Secara real-time mengukur moving-average latency setiap provider, mengarahkan prompt ke provider tercepat dengan probing inisial instan dan fallback otomatis.
3. **Telemetri KV-Cache & Prompt Caching Analytics**: Penjejakan `cachedPromptTokens` per response dan `totalCachedPromptTokens` pada `client.getMetrics()`, memungkinkan audit efisiensi prompt caching (penghematan biaya token 70-90%).
4. **Inferensi Kilat & Penalaran Groq LPU (`GroqProvider`)**: Integrasi penuh spesifikasi [GroqCloud Docs Overview](https://console.groq.com/docs/overview) untuk inferensi ultra-cepat (~500+ token/detik) menggunakan chip LPU. Mencakup model produksi (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`), pemisahan token penalaran (`reasoning_format: 'parsed'` ke `reasoning_content`), structured outputs JSON Schema, parsing durasi header rate-limit Groq (`x-ratelimit-reset-tokens: 7.66s`, `x-ratelimit-reset-requests: 2m59.56s`), penyesuaian suhu (clamping 0 ke `1e-8`), serta sanitasi otomatis field yang tidak didukung (`messages[].name`) demi mencegah error 400.
5. **OpenRouter Free Tier (`createOpenRouterFreeProvider`)**: Integrasi penuh katalog model gratis [OpenRouter](https://openrouter.ai/models?variant=free) dengan biaya $0 otomatis, meta-router `openrouter/free`, rantai fallback model native (`fallbackModels`), header peringkat (`siteUrl`, `siteName`), serta penemuan model gratis live via `OpenRouterProvider.fetchFreeModels()`.
6. **Generasi Model Google Gemini 2.5 & 3.x (`GEMINI_MODELS`)**: Integrasi katalog model resmi Google AI ([ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models?hl=id)) mencakup `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, dan `gemini-3.8-flash`. Dilengkapi konfigurasi extended thinking (`thinkingBudget`), ekstraksi token penalaran (`reasoning_content`), pengaturan keamanan (`safetySettings`), reduksi dimensi MRL embeddings (`dimensions` / `outputDimensionality`), adaptasi header rate-limit, dan penemuan model live via `GeminiProvider.fetchAvailableModels()`.
7. **Dukungan Native Mistral AI (`MistralProvider`)**: Eksekusi chat, tools, JSON mode, dan embeddings (`mistral-embed`) dengan penanganan rate-limit otomatis.
8. **Google Gemini Embeddings (`GeminiProvider.generateEmbedding`)**: Mendukung model `text-embedding-004` baik untuk string tunggal (`embedContent`) maupun batch array (`batchEmbedContents`).
9. **Inspeksi & Pemulihan Circuit Breaker (`getCircuitBreakerStatus`, `resetCircuitBreaker`)**: Pemantauan status sirkuit (`CLOSED`, `OPEN`, `HALF_OPEN`), jumlah kegagalan/sukses per provider, serta kemampuan reset manual programatik.
10. **Pembersihan Cache In-Process (`clearCache`)**: Mengosongkan memori cache respon prompt dan embeddings secara instan saat dibutuhkan.
11. **Dual-Token Pricing (`promptCostPer1k`, `completionCostPer1k`)**: Perhitungan biaya dinamis dan perutean `lowest-cost` otomatis berdasarkan rasio panjang prompt dan token keluaran.
12. **Adaptive Rate-Limiting & Proactive Throttling**: Ekstraksi header kuota rate-limit (`x-ratelimit-*`, `retry-after`) secara otomatis guna mencegah HTTP 429.

## Keamanan & Kualitas
- **100% Lokal:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Overhead:** Desain lokal menjamin tambahan latensi < 10ms.
- **Pengujian Komprehensif:** 169/169 unit & integration tests lulus di 17 test suites dengan cakupan lengkap seluruh provider, fallback, semantic cache, dan batch engine.
- **100% Biome Clean:** Kode sumber sepenuhnya sesuai dengan standar ketat linter Biome tanpa peringatan maupun error.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [MIT License](./LICENSE). Anda bebas menyalin, memodifikasi, mendistribusikan, dan menggunakan proyek ini untuk keperluan apa pun (termasuk komersial) dengan menyertakan pemberitahuan hak cipta asli.

