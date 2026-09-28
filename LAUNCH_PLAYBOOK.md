# 🚀 GitHub Trending & Viral Launch Playbook: SinapsAI

Panduan taktis komprehensif ini dirancang agar repositori **SinapsAI** dapat menembus **GitHub Trending** (#1 di kategori *TypeScript* dan *Overall Daily Trending*), mendapatkan ratusan bintang (*stars*), serta menarik ribuan pengembang secara organik.

---

## 🎯 1. Algoritma GitHub Trending: Cara Kerjanya

GitHub Trending dihitung berdasarkan **Star Velocity** (kecepatan perolehan bintang) dalam rentang waktu tertentu:

| Kategori Trending | Syarat Bintang (Rolling 24 Jam) | Waktu Puncak Aktivitas |
| :--- | :--- | :--- |
| **TypeScript Daily Trending** | ~80 – 150 stars / hari | Selasa – Kamis (14:00 – 21:00 UTC) |
| **Overall Daily Trending** | ~200 – 350 stars / hari | Selasa – Rabu (13:00 – 18:00 UTC) |
| **Weekly Trending** | ~500 – 1,000 stars / minggu | Terakumulasi stabil selama 7 hari |

> 💡 **Kunci Utama**: Anda memerlukan **50 – 100 bintang pertama dalam 6 hingga 12 jam pertama peluncuran**. Bintang ini didorong melalui distribusi di **Hacker News (Show HN)**, **Reddit**, dan **X (Twitter)** secara simultan.

---

## 🏷️ 2. Pengaturan Repositori GitHub (Wajib Disetel Sekarang)

Buka halaman repositori GitHub Anda di `https://github.com/roedyrustam/sinapsai`:

### A. Deskripsi & URL (Bagian "About" di pojok kanan atas)
- **Description**: 
  > `⚡ Blazing-fast in-process AI Gateway & Control Plane with Circuit Breaker, Automatic Failover, and Unified LLM API for Node.js & TypeScript`
- **Website**: `https://github.com/roedyrustam/sinapsai#readme`

### B. Masukkan 20 Tag / Topics GitHub (Krusial untuk SEO GitHub)
Klik ikon gerigi ⚙️ di samping "About" dan tempelkan 20 topics berikut:
```text
ai, llm, ai-gateway, llm-gateway, circuit-breaker, failover, load-balancer, openai, anthropic, gemini, groq, openrouter, typescript, nodejs, fault-tolerance, in-memory, control-plane, developer-tools, resilience, proxy
```

### C. Pasang Social Preview Image (1280 × 640 px)
- Buka **Settings** > **General** > **Social preview** > **Edit**.
- Unggah gambar banner berlatar belakang gelap dengan tipografi mencolok:
  - Teks: **SinapsAI**
  - Subteks: *In-Process AI Gateway & Control Plane for TypeScript*
  - Badge visual: *Zero Infra • <10ms Overhead • Built-in Circuit Breaker*

---

## 📢 3. Saluran Peluncuran & Naskah Siap Pakai

### 🅰️ Hacker News (Show HN) — Penggerak Terbesar Bintang GitHub
- **Waktu Terbaik**: Selasa atau Rabu pukul 08:00 AM Eastern Time (ET) / 19:00 WIB / 12:00 UTC.
- **URL**: Masukkan link repositori GitHub Anda.
- **Title (Pilih salah satu formula teruji)**:
  - *Opsi 1 (Fokus Masalah/Solusi)*:
    > `Show HN: SinapsAI – An in-process AI gateway and circuit breaker for Node.js`
  - *Opsi 2 (Fokus Performa/Arsitektur)*:
    > `Show HN: SinapsAI – 100% in-memory AI control plane without Docker or Redis (<10ms)`

#### Komentar Pertama Anda di Show HN (Kirim segera setelah posting):
```markdown
Hi HN! I built SinapsAI because I was tired of the operational overhead required just to make LLM calls reliable in production.

Existing AI gateways (like LiteLLM, Portkey, or Helicone) are powerful, but they usually require:
1. Running a separate Docker container / Python service,
2. Setting up an external Redis or Postgres instance, or
3. Routing sensitive prompt payloads and API keys through a 3rd-party proxy, adding 50–200ms of network latency.

For most Node.js / TypeScript backends, you don't need a separate network proxy just for retries and fallbacks. 

SinapsAI is a 100% in-process control plane:
- Zero external runtime dependencies (uses native fetch).
- In-memory Circuit Breaker: Automatically trips OPEN when a provider fails, preventing request queue blockages.
- Flexible Routing: Supports automatic failover, round-robin load balancing (to avoid 429 rate limits), and lowest-cost routing.
- Zero data leakage: Everything stays inside your application process memory.
- Under 10ms execution overhead.

Code: https://github.com/roedyrustam/sinapsai
Documentation & examples included.

I'd love your feedback on the architecture and what providers or routing strategies you'd like to see next!
```

---

### 🅱️ Reddit (Komunitas Pengembang)
Posting di subreddit yang relevan (beri jeda 2-3 jam antar subreddit agar tidak terdeteksi spam):

#### 1. `r/typescript` & `r/node`
- **Judul**: `I built a zero-dependency, in-process AI Gateway & Circuit Breaker for TypeScript`
- **Isi**:
  ```markdown
  Hey everyone! Most AI gateway solutions require spinning up Docker containers, Redis, or routing requests through third-party cloud proxies.

  I wanted something that runs purely in-process inside Node.js with TypeScript-first ergonomics:
  - 🔄 Unified API compatible with OpenAI Chat Completions.
  - 🛡️ In-memory Circuit Breaker (CLOSED / OPEN / HALF_OPEN state machine).
  - ⚡ Automatic failover & Round-Robin load balancing across API keys.
  - 🌊 Full SSE streaming support via async iterators (`for await...of`).
  - 📦 Zero runtime dependencies (native `fetch`).

  Repo: https://github.com/roedyrustam/sinapsai
  Examples: https://github.com/roedyrustam/sinapsai/tree/main/examples

  Would love to hear your thoughts and suggestions!
  ```

#### 2. `r/LocalLLaMA`
- **Judul**: `SinapsAI: An in-process TypeScript gateway with instant failover between Cloud & Local LLMs (Ollama/vLLM)`
- **Sorot Fitur**: Kemampuan membuat fallback otomatis dari OpenAI ke Ollama lokal ketika internet terputus atau API down.

---

### 🆎 X / Twitter (Thread Peluncuran)

**Tweet 1 (Hook Utama + Video/GIF Demonstrasi)**:
> Stop deploying heavy Docker containers just to add failover to your LLM calls.
> 
> Introducing SinapsAI ⚡
> 
> A 100% in-process AI Gateway & Circuit Breaker for Node.js and TypeScript.
> 
> • <10ms overhead
> • Zero third-party proxy
> • Native SSE streaming
> • Built-in Circuit Breaker
> 
> 🧵👇

**Tweet 2 (Masalahnya)**:
> Why not existing gateways?
> 
> Most AI proxies (LiteLLM, Portkey) require:
> ❌ A separate Python container
> ❌ Redis / Postgres for state
> ❌ Routing sensitive prompts through an extra network hop (+80ms to +250ms)
> 
> SinapsAI runs entirely in your application's memory space.

**Tweet 3 (Cara Kerja Circuit Breaker)**:
> When OpenAI or Anthropic suffers an outage:
> 1. SinapsAI detects the error burst
> 2. Circuit Breaker trips OPEN
> 3. Instantly routes incoming requests to your fallback provider (e.g. Gemini or Groq)
> 
> Zero dropped requests. Zero downtime for your users.

**Tweet 4 (Contoh Kode Singkat)**:
> Here is how clean the syntax is:
> 
> ```typescript
> const client = new SinapsClient({
>   strategy: 'failover',
>   providers: [
>     new OpenAiProvider({ apiKey }),
>     new AnthropicProvider({ apiKey }),
>   ],
> });
> ```

**Tweet 5 (Call to Action)**:
> SinapsAI is 100% open source under CC BY 4.0.
> 
> ⭐ Star the repo on GitHub:
> https://github.com/roedyrustam/sinapsai
> 
> Feedback and PRs are warmly welcome! 🤝

---

## 📈 4. Checklist Eksekusi Hari Peluncuran (Launch Day Checklist)

| Waktu (UTC) | Aktivitas |
| :--- | :--- |
| **08:00 UTC** | Pastikan CI GitHub Actions hijau, commit terakhir rapi, dan semua link berfungsi. |
| **12:00 UTC** | Pasang 20 Topics di GitHub repo dan update Social Preview Image. |
| **12:15 UTC** | Publikasikan **Show HN** di Hacker News dan langsung tulis first comment. |
| **12:30 UTC** | Publikasikan Thread di **X (Twitter)** dengan tag komunitas (#typescript #ai #webdev). |
| **13:30 UTC** | Bagikan di **Reddit** (`r/typescript`). |
| **15:00 UTC** | Pantau dan balas setiap pertanyaan/komentar di Hacker News & Reddit secara cepat dan ramah. |
| **17:00 UTC** | Bagikan di `r/node` dan Discord developer (misal: komunitas TypeScript, Bun, atau AI engineer). |
| **H+1** | Cek halaman `https://github.com/trending/typescript?since=daily`. |

---

## 🌟 5. Menjaga Momentum Pasca-Trending

1. **Fast PR Review**: Pengembang yang melihat proyek di trending akan mulai membuat issue dan PR. Tanggapi dalam <12 jam.
2. **Tambah Provider Populer Berikutnya**: Buat issue bertag `good first issue` untuk provider seperti `DeepSeekProvider`, `MistralProvider`, dan `CohereProvider`.
3. **Release Tagging**: Gunakan GitHub Releases dengan changelog otomatis setiap ada fitur baru untuk menjaga sinyal aktivitas repositori tetap tinggi.
