# 🤝 Contributing to SinapsAI

<p align="center">
  <b>English</b> •
  <a href="#-berkontribusi-pada-sinapsai">Bahasa Indonesia</a>
</p>

First off — **thank you** for taking the time to contribute! SinapsAI is an open-source project, and every contribution, no matter how small, makes it better.

This document covers everything you need to know to set up your environment and make high-quality contributions.

---

## 📑 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [Project Architecture](#-project-architecture)
- [Development Setup](#-development-setup)
- [Workflow: Branch, Code, Test, PR](#-workflow-branch-code-test-pr)
- [Adding a New Provider](#-adding-a-new-provider)
- [Writing Tests](#-writing-tests)
- [Code Style & Linting (Biome)](#-code-style--linting-biome)
- [Commit Message Convention](#-commit-message-convention)
- [Reporting Bugs & Feature Requests](#-reporting-bugs--feature-requests)

---

## 🛡️ Code of Conduct

By participating, you agree to uphold a respectful and inclusive environment. Please be kind, constructive, and considerate in all interactions.

---

## 🏛️ Project Architecture

Before writing code, understand the three-layer architecture:

```
sinapsai/
├── src/
│   ├── core/                  # Core engine
│   │   ├── CircuitBreaker.ts  # Fault tolerance state machine
│   │   ├── InMemoryStorage.ts # Default in-process state store
│   │   ├── Router.ts          # Request routing strategies
│   │   ├── SinapsClient.ts    # Public-facing client entrypoint
│   │   └── StateStorage.ts    # StateStorage interface (extensible)
│   │
│   ├── providers/             # LLM integrations
│   │   ├── Provider.ts        # Provider interface (contract)
│   │   ├── OpenAiProvider.ts
│   │   ├── AnthropicProvider.ts
│   │   ├── GeminiProvider.ts
│   │   ├── GroqProvider.ts
│   │   └── OpenRouterProvider.ts
│   │
│   ├── types/                 # Shared TypeScript types
│   │   └── index.ts           # UnifiedApiRequest, UnifiedApiResponse, Hooks
│   │
│   └── utils/
│       └── stream.ts          # SSE (Server-Sent Events) parser
│
├── biome.json                 # Linter & formatter config
├── tsconfig.json              # TypeScript compiler config
└── tsup.config.ts             # Build bundler config (ESM + CJS)
```

**Layered rules:**
- `core/` must not import from `providers/` directly (except via the `Provider` interface).
- All public types must live in `types/index.ts` and be exported via `src/index.ts`.
- No third-party runtime dependencies — use the native `fetch` API only.

---

## 🛠️ Development Setup

**Requirements**: Node.js ≥ 18, npm ≥ 9.

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/sinapsai.git
cd sinapsai

# 2. Install dependencies (no runtime deps, only dev tools)
npm install

# 3. Run tests to verify your environment is healthy
npm test

# 4. Start the build watcher for live compilation
npm run dev
```

The `npm run dev` command uses `tsup --watch` to rebuild `dist/` automatically as you edit source files.

---

## 🔄 Workflow: Branch, Code, Test, PR

```
1. Sync your fork with main
   git fetch origin && git rebase origin/main

2. Create a focused feature branch
   git checkout -b feat/add-cohere-provider
   # or
   git checkout -b fix/circuit-breaker-half-open

3. Write your code + tests

4. Verify everything passes
   npm run lint   # Must show: No fixes applied / no errors
   npm test       # Must show: All tests passed

5. Commit following the convention below
   git commit -m "feat(providers): add CohereProvider with streaming support"

6. Push and open a Pull Request against `main`
   git push origin feat/add-cohere-provider
```

**Pull Request checklist before submitting:**
- [ ] All existing tests pass (`npm test`)
- [ ] New code has corresponding unit tests
- [ ] Linter reports no errors (`npm run lint`)
- [ ] No new runtime dependencies added to `package.json`
- [ ] TypeScript strict mode has no type errors (`npx tsc --noEmit`)
- [ ] PR description explains *why* the change is needed, not just *what* it does

---

## 🔌 Adding a New Provider

This is the most common contribution. Follow this step-by-step process:

### Step 1 — Create the Provider class

Create `src/providers/MyProvider.ts`. It **must** implement the `Provider` interface:

```typescript
// src/providers/MyProvider.ts
import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { Provider } from './Provider.js';

export class MyProvider implements Provider {
  id: string;
  name = 'MyProvider';               // Human-readable display name
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    // Auto-generate a unique ID when none is supplied
    this.id = config.id ?? `myprovider-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const baseUrl = this.config.baseUrl ?? 'https://api.myprovider.com/v1';
    const url = `${baseUrl}/chat/completions`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: request.stream ?? false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`MyProvider API Error (${response.status}): ${text}`) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      const data = await response.json();

      return {
        id: data.id ?? `myprovider-${Date.now()}`,
        model: data.model ?? request.model,
        choices: [
          {
            message: {
              role: 'assistant',
              content: data.choices?.[0]?.message?.content ?? '',
            },
            finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
          },
        ],
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens ?? 0,
              completionTokens: data.usage.completion_tokens ?? 0,
              totalTokens: data.usage.total_tokens ?? 0,
            }
          : undefined,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
```

### Step 2 — Export the provider

Add an export line in `src/providers/index.ts`:

```typescript
// src/providers/index.ts
export * from './MyProvider.js';   // ← add this line
```

### Step 3 — Write tests

Create `src/providers/MyProvider.test.ts` (see the [Writing Tests](#-writing-tests) section below).

### Step 4 — Document

Update the **Supported Providers** table in both `README.md` and `README.id.md`.

---

## 🧪 Writing Tests

SinapsAI uses **Vitest** with `vi.fn()` mocks. Tests must run without any real API calls (no network, no API keys).

### Provider test template

```typescript
// src/providers/MyProvider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MyProvider } from './MyProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: object, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('MyProvider', () => {
  it('should return a UnifiedApiResponse on success', async () => {
    mockFetch.mockReturnValueOnce(
      makeResponse({
        id: 'test-1',
        model: 'my-model-v1',
        choices: [
          { message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const provider = new MyProvider({ apiKey: 'test-key' });
    const result = await provider.generateContent({
      model: 'my-model-v1',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect('choices' in result).toBe(true);
    if ('choices' in result) {
      expect(result.choices[0]?.message.content).toBe('Hello!');
    }
  });

  it('should throw a typed error on HTTP 401', async () => {
    mockFetch.mockReturnValueOnce(
      makeResponse({ error: 'Unauthorized' }, 401),
    );

    const provider = new MyProvider({ apiKey: 'bad-key' });
    await expect(
      provider.generateContent({
        model: 'my-model-v1',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow('401');
  });
});
```

**Test naming rules:**
- File: `src/**/*.test.ts` — Vitest picks these up automatically.
- Group related scenarios under a `describe` block named after the class.
- Each `it` sentence should read as a complete statement: *"should return…"*, *"should throw…"*, *"should call fallback when…"*.

---

## 🎨 Code Style & Linting (Biome)

SinapsAI uses **[Biome](https://biomejs.dev/)** as the single tool for linting and formatting (replaces both ESLint and Prettier).

Configuration lives in [`biome.json`](./biome.json):

| Setting | Value |
| :--- | :--- |
| Indent style | Spaces |
| Indent width | 2 |
| Quote style | Single quotes |
| Trailing commas | All |
| Semicolons | Always |
| Line width | 80 chars |
| Line endings | LF |

```bash
# Auto-fix all lint and format issues
npm run lint

# Check only (no writes) — useful in CI
npx biome check src/
```

**Key rules enforced:**
- No `any` without explicit `// biome-ignore` justification comments.
- No unused variables or imports.
- Explicit return types on all exported functions and class methods.
- `const` preferred over `let` where reassignment never occurs.

---

## 📝 Commit Message Convention

SinapsAI follows the **[Conventional Commits](https://www.conventionalcommits.org/)** specification:

```
<type>(<scope>): <short summary in imperative mood>
```

| Type | When to use |
| :--- | :--- |
| `feat` | New feature or new provider |
| `fix` | Bug fix |
| `test` | Adding or updating tests |
| `refactor` | Code restructuring without changing behavior |
| `docs` | Documentation changes only |
| `chore` | Maintenance tasks (deps, build config) |
| `perf` | Performance improvements |

**Examples:**

```bash
feat(providers): add CohereProvider with streaming support
fix(circuit-breaker): reset failure counter on HALF_OPEN success
test(router): add lowest-cost strategy tie-breaking coverage
docs(readme): update configuration reference table
refactor(core): extract SSE parser to shared utility
```

---

## 🐛 Reporting Bugs & Feature Requests

- **Bug report**: Open an issue and include Node.js version, TypeScript version, a minimal reproducible code snippet, and the observed vs. expected behavior.
- **Feature request**: Describe the use case first. Avoid opening a PR for a large feature without prior discussion in an issue.
- **Security vulnerability**: Do **not** open a public issue. Contact the maintainer directly.

---

---

# 🤝 Berkontribusi pada SinapsAI

<p align="center">
  <a href="#-contributing-to-sinapsai">English</a> •
  <b>Bahasa Indonesia</b>
</p>

Terima kasih telah meluangkan waktu untuk berkontribusi! SinapsAI adalah proyek open-source, dan setiap kontribusi—sekecil apa pun—membuat proyek ini menjadi lebih baik.

Dokumen ini mencakup semua yang perlu Anda ketahui untuk menyiapkan lingkungan pengembangan dan menghasilkan kontribusi berkualitas tinggi.

---

## 📑 Daftar Isi (ID)

- [Kode Etik](#-kode-etik)
- [Arsitektur Proyek](#-arsitektur-proyek)
- [Persiapan Lingkungan Pengembangan](#-persiapan-lingkungan-pengembangan)
- [Alur Kerja: Branch, Kode, Tes, PR](#-alur-kerja-branch-kode-tes-pr)
- [Menambahkan Provider Baru](#-menambahkan-provider-baru)
- [Menulis Pengujian (Tests)](#-menulis-pengujian-tests)
- [Gaya Kode & Linter (Biome)](#-gaya-kode--linter-biome)
- [Konvensi Pesan Commit](#-konvensi-pesan-commit)
- [Melaporkan Bug & Permintaan Fitur](#-melaporkan-bug--permintaan-fitur)

---

## 🛡️ Kode Etik

Dengan berpartisipasi, Anda menyetujui untuk menjaga lingkungan yang saling menghormati dan inklusif. Bersikaplah baik, membangun, dan penuh pertimbangan dalam semua interaksi.

---

## 🏛️ Arsitektur Proyek

Sebelum menulis kode, pahami arsitektur tiga lapisan berikut:

```
sinapsai/
├── src/
│   ├── core/                  # Mesin inti
│   │   ├── CircuitBreaker.ts  # Mesin state toleransi kesalahan
│   │   ├── InMemoryStorage.ts # Penyimpanan state default (in-memory)
│   │   ├── Router.ts          # Strategi perutean request
│   │   ├── SinapsClient.ts    # Titik masuk klien publik
│   │   └── StateStorage.ts    # Interface StateStorage (dapat diperluas)
│   │
│   ├── providers/             # Integrasi LLM
│   │   ├── Provider.ts        # Interface Provider (kontrak)
│   │   ├── OpenAiProvider.ts
│   │   ├── AnthropicProvider.ts
│   │   ├── GeminiProvider.ts
│   │   ├── GroqProvider.ts
│   │   └── OpenRouterProvider.ts
│   │
│   ├── types/                 # Tipe TypeScript bersama
│   │   └── index.ts           # UnifiedApiRequest, UnifiedApiResponse, Hooks
│   │
│   └── utils/
│       └── stream.ts          # Parser SSE (Server-Sent Events)
│
├── biome.json                 # Konfigurasi linter & formatter
├── tsconfig.json              # Konfigurasi kompiler TypeScript
└── tsup.config.ts             # Konfigurasi bundler build (ESM + CJS)
```

**Aturan antar lapisan:**
- `core/` tidak boleh mengimpor dari `providers/` secara langsung (kecuali melalui interface `Provider`).
- Semua tipe publik harus berada di `types/index.ts` dan diekspor melalui `src/index.ts`.
- Tidak ada dependensi runtime pihak ketiga — gunakan native `fetch` API saja.

---

## 🛠️ Persiapan Lingkungan Pengembangan

**Persyaratan**: Node.js ≥ 18, npm ≥ 9.

```bash
# 1. Fork repositori di GitHub, lalu clone fork Anda
git clone https://github.com/<username-anda>/sinapsai.git
cd sinapsai

# 2. Pasang dependensi (hanya dev tools, tidak ada runtime deps)
npm install

# 3. Jalankan pengujian untuk memverifikasi lingkungan berjalan normal
npm test

# 4. Mulai build watcher untuk kompilasi otomatis
npm run dev
```

Perintah `npm run dev` menggunakan `tsup --watch` untuk membangun ulang `dist/` secara otomatis saat Anda mengedit file sumber.

---

## 🔄 Alur Kerja: Branch, Kode, Tes, PR

```
1. Sinkronkan fork dengan main
   git fetch origin && git rebase origin/main

2. Buat branch fitur yang fokus
   git checkout -b feat/tambah-provider-cohere
   # atau
   git checkout -b fix/circuit-breaker-half-open

3. Tulis kode + pengujian Anda

4. Verifikasi semua lulus
   npm run lint   # Harus menampilkan: No fixes applied / tanpa error
   npm test       # Harus menampilkan: All tests passed

5. Commit sesuai konvensi di bawah ini
   git commit -m "feat(providers): add CohereProvider with streaming support"

6. Push dan buka Pull Request ke `main`
   git push origin feat/tambah-provider-cohere
```

**Daftar periksa Pull Request sebelum dikirim:**
- [ ] Semua pengujian yang ada lulus (`npm test`)
- [ ] Kode baru memiliki pengujian unit yang sesuai
- [ ] Linter tidak melaporkan error (`npm run lint`)
- [ ] Tidak ada dependensi runtime baru yang ditambahkan ke `package.json`
- [ ] TypeScript strict mode tidak memiliki error tipe (`npx tsc --noEmit`)
- [ ] Deskripsi PR menjelaskan *mengapa* perubahan diperlukan, bukan hanya *apa* yang diubah

---

## 🔌 Menambahkan Provider Baru

Ini adalah kontribusi yang paling umum. Ikuti proses langkah demi langkah berikut:

### Langkah 1 — Buat kelas Provider

Buat `src/providers/MyProvider.ts`. Provider **wajib** mengimplementasikan interface `Provider`:

```typescript
// src/providers/MyProvider.ts
import type {
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { Provider } from './Provider.js';

export class MyProvider implements Provider {
  id: string;
  name = 'MyProvider';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.id = config.id ?? `myprovider-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    // ... implementasi fetch ke API provider Anda
  }
}
```

### Langkah 2 — Ekspor provider

Tambahkan baris ekspor di `src/providers/index.ts`:

```typescript
export * from './MyProvider.js';  // ← tambahkan baris ini
```

### Langkah 3 — Tulis pengujian

Buat `src/providers/MyProvider.test.ts` (lihat bagian [Menulis Pengujian](#-menulis-pengujian-tests) di bawah).

### Langkah 4 — Dokumentasikan

Perbarui tabel **Provider yang Didukung** di `README.md` dan `README.id.md`.

---

## 🧪 Menulis Pengujian (Tests)

SinapsAI menggunakan **Vitest** dengan mock `vi.fn()`. Pengujian harus berjalan tanpa panggilan API nyata (tanpa jaringan, tanpa API key sungguhan).

```typescript
// src/providers/MyProvider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MyProvider } from './MyProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: object, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('MyProvider', () => {
  it('should return a UnifiedApiResponse on success', async () => {
    mockFetch.mockReturnValueOnce(
      makeResponse({
        id: 'test-1',
        model: 'my-model-v1',
        choices: [
          { message: { role: 'assistant', content: 'Halo!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const provider = new MyProvider({ apiKey: 'test-key' });
    const result = await provider.generateContent({
      model: 'my-model-v1',
      messages: [{ role: 'user', content: 'Hei' }],
    });

    expect('choices' in result).toBe(true);
    if ('choices' in result) {
      expect(result.choices[0]?.message.content).toBe('Halo!');
    }
  });

  it('should throw a typed error on HTTP 401', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ error: 'Unauthorized' }, 401));

    const provider = new MyProvider({ apiKey: 'kunci-salah' });
    await expect(
      provider.generateContent({
        model: 'my-model-v1',
        messages: [{ role: 'user', content: 'Hei' }],
      }),
    ).rejects.toThrow('401');
  });
});
```

**Aturan penamaan pengujian:**
- File: `src/**/*.test.ts` — Vitest mendeteksinya secara otomatis.
- Kelompokkan skenario terkait dalam blok `describe` yang dinamai sesuai nama kelas.
- Setiap kalimat `it` harus terbaca sebagai pernyataan lengkap: *"should return…"*, *"should throw…"*, *"should call fallback when…"*.

---

## 🎨 Gaya Kode & Linter (Biome)

SinapsAI menggunakan **[Biome](https://biomejs.dev/)** sebagai satu-satunya alat untuk linting dan formatting (menggantikan ESLint dan Prettier sekaligus).

| Pengaturan | Nilai |
| :--- | :--- |
| Gaya indentasi | Spasi |
| Lebar indentasi | 2 |
| Gaya kutipan | Tanda kutip tunggal |
| Koma akhir | Selalu |
| Titik koma | Selalu |
| Lebar baris | 80 karakter |
| Akhir baris | LF |

```bash
# Perbaiki otomatis semua masalah lint dan format
npm run lint

# Hanya cek tanpa menulis (berguna di CI)
npx biome check src/
```

---

## 📝 Konvensi Pesan Commit

SinapsAI mengikuti spesifikasi **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<scope>): <ringkasan singkat dalam bentuk imperatif>
```

| Type | Kapan digunakan |
| :--- | :--- |
| `feat` | Fitur baru atau provider baru |
| `fix` | Perbaikan bug |
| `test` | Menambahkan atau memperbarui pengujian |
| `refactor` | Restrukturisasi kode tanpa mengubah perilaku |
| `docs` | Perubahan dokumentasi saja |
| `chore` | Tugas pemeliharaan (dependensi, konfigurasi build) |
| `perf` | Peningkatan performa |

**Contoh:**
```bash
feat(providers): add CohereProvider with streaming support
fix(circuit-breaker): reset failure counter on HALF_OPEN success
test(router): add lowest-cost strategy tie-breaking coverage
docs(readme): update supported providers table
```

---

## 🐛 Melaporkan Bug & Permintaan Fitur

- **Laporan bug**: Buka issue dan sertakan versi Node.js, versi TypeScript, cuplikan kode yang dapat direproduksi secara minimal, serta perilaku yang diamati vs. yang diharapkan.
- **Permintaan fitur**: Deskripsikan kasus penggunaan terlebih dahulu. Hindari membuka PR untuk fitur besar tanpa diskusi awal di issue.
- **Kerentanan keamanan**: **Jangan** buka issue publik. Hubungi maintainer secara langsung.

---

Dibuat dengan dedikasi oleh **Roedy Rustam** & Tim Kontributor SinapsAI.
