# Dokumentasi SinapsAI

## Ikhtisar
SinapsAI adalah paket NPM Node.js/TypeScript lokal yang berfungsi sebagai *Control Plane / AI Gateway*. Paket ini menghubungkan aplikasi Anda ke lebih dari 200 penyedia LLM (OpenAI, Anthropic, Gemini, dll) melalui antarmuka API yang bersatu (*Unified API*).

## Instalasi
```bash
npm install sinapsai
```

## Penggunaan Dasar
```typescript
import { SinapsAI } from 'sinapsai';

const client = new SinapsAI({
  providers: [
    { name: 'openai', apiKey: process.env.OPENAI_API_KEY },
    { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, fallback: true }
  ],
  strategy: 'failover'
});

async function run() {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Halo, AI!' }]
  });
  console.log(response);
}
run();
```

## Keamanan & Performa
- **100% Lokal:** Semua API keys dikelola langsung di dalam memori dan hanya dikirim ke penyedia model akhir (end-provider). Tidak ada transmisi ke gateway cloud pihak ketiga.
- **Zero Overhead:** Desain lokal menjamin tambahan latensi < 10ms.

## Lisensi
Proyek ini dilisensikan di bawah lisensi [Creative Commons Attribution 4.0 International (CC BY 4.0)](./LICENSE). Anda bebas menyalin, memodifikasi, dan mendistribusikan proyek ini untuk tujuan apa pun (termasuk komersial) dengan mencantumkan atribusi yang sesuai.

