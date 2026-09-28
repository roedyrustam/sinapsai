# Roadmap & Progress (SinapsAI)

## Phase 1: MVP (v1.0.0) - *Current*
- [ ] Inisialisasi proyek TypeScript & konfigurasi (Biome linter).
- [ ] Definisi skema Unified API (mengikuti standar format OpenAI).
- [ ] Implementasi routing core dan HTTP client native (`fetch`).
- [ ] Integrasi provider utama: OpenAI, Anthropic, Gemini.
- [ ] Implementasi `In-Memory Circuit Breaker` & Automated Fallback.
- [ ] Rilis versi alpha lokal.

## Phase 2: Advanced Features (v1.x)
- [ ] Dukungan Server-Sent Events (SSE) Streaming untuk semua provider.
- [ ] Load balancing requests ke multiple API keys (algoritma Round-Robin).
- [ ] Event Hooks (`onFallback`, `onRateLimit`) untuk integrasi telemetri aplikasi klien.

## Phase 3: Optimizations (v2.0+)
- [ ] *Cost-Based Routing* (secara dinamis merutekan ke model termurah yang mumpuni).
- [ ] Dukungan eksekusi di Edge Runtime (Cloudflare Workers, Bun, Deno).
