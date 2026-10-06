# Changelog

## [1.2.0] - 2026-10-06
### Added
- **Edge Runtime Certification**: 100% universal Web Standards execution certified for Cloudflare Workers, Bun, Deno, and Vercel Edge.
- Added `workerd` and `edge-light` export conditions in `package.json`.
- Added `autoSweep` configuration to `InMemoryStorage` for serverless and edge environments.
- Added Edge Runtime test suite (`EdgeRuntime.test.ts`) and Cloudflare Workers example (`examples/05-edge-cloudflare-worker.ts`).
- Added comprehensive unit tests for `tools`, `toolChoice`, and `responseFormat` across OpenAI, Groq, OpenRouter, and `SinapsClient`.

### Fixed
- Replaced Node-specific `NodeJS.Timeout` signatures with universal `ReturnType<typeof setTimeout>`.
- Safeguarded `unref()` handling in `InMemoryStorage` to avoid failures in non-Node runtimes.

## [1.0.0] - 2026-09-29
### Added
- Complete AI Gateway package with Providers (OpenAI, Anthropic, Gemini, Groq, OpenRouter).
- Advanced Circuit Breaker and Router functionality for fallback and load balancing.
- Extensible state storage architecture with `InMemoryStorage`.
- SSE Streaming capabilities for chunked AI generation.

### Fixed
- Fixed minor formatting warnings (Biome).
- Resolved unused imports and missing implicit type annotations.
- Eradicated all blocking tech debt from previous iteratives (Strict `any` type removal across all core and provider files).
- Fixed `useYield` and strict `NodeJS.Timeout` usage for intervals across core components.
