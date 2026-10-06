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
}
run();
```

## Keamanan & Performa
- **100% Lokal:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Overhead:** Desain lokal menjamin tambahan latensi < 10ms.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE). Anda bebas menyalin, memodifikasi, dan mendistribusikan proyek ini untuk tujuan apa pun (termasuk komersial) dengan mencantumkan atribusi yang sesuai.

