# Dokumentasi SinapsAI

## Ikhtisar
SinapsAI adalah paket NPM Node.js/TypeScript lokal yang berfungsi sebagai *Control Plane / AI Gateway*. Paket ini menghubungkan aplikasi Anda ke berbagai penyedia LLM (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Ollama, Groq, OpenRouter) melalui antarmuka API yang bersatu (*Unified API*).

## Instalasi
```bash
npm install sinapsai
```

## Penggunaan Dasar
```typescript
import { 
  SinapsClient, 
  OpenAiProvider, 
  AnthropicProvider 
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ 
      apiKey: process.env.OPENAI_API_KEY! 
    }),
    new AnthropicProvider({ 
      apiKey: process.env.ANTHROPIC_API_KEY!,
      defaultModel: 'claude-3-5-sonnet-20241022',
      modelMap: {
        'gpt-4o': 'claude-3-5-sonnet-20241022',
      },
    }),
  ],
});

async function run() {
  // Chat Completions
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Halo, AI!' }],
  });
  console.log(response.choices[0].message.content);

  // Unified Embeddings (dengan failover & cache)
  const embedding = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: 'Teks pencarian semantik',
  });
  console.log('Embedding dimensions:', embedding.data[0].embedding.length);

  // Real-Time In-Process Telemetry
  const metrics = client.getMetrics();
  console.log('Total Requests:', metrics.totalRequests);
  console.log('Estimated USD Spend:', metrics.estimatedCostUsd);
}
run();
```

## Fitur Utama v1.5.0
1. **Dual-Token Pricing (`promptCostPer1k`, `completionCostPer1k`)**: Perhitungan biaya dinamis dan perutean `lowest-cost` otomatis berdasarkan rasio panjang prompt dan token keluaran.
2. **Adaptive Rate-Limiting & Proactive Throttling**: Ekstraksi header kuota rate-limit (`x-ratelimit-*`, `retry-after`) secara otomatis. Mencegah error HTTP 429 dengan melewati provider yang kuotanya habis sebelum panggilan jaringan dikirim.
3. **Telemetri Tanpa Database (`client.getMetrics()`)**: Rekapitulasi waktu-nyata untuk token prompt, token completion, estimasi pengeluaran USD, rasio cache hit, dan latensi per provider.

## Keamanan & Performa
- **100% Lokal:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Overhead:** Desain lokal menjamin tambahan latensi < 10ms.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE). Anda bebas menyalin, memodifikasi, dan mendistribusikan proyek ini untuk tujuan apa pun (termasuk komersial) dengan mencantumkan atribusi yang sesuai.

