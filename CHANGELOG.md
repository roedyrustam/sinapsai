# Changelog

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
