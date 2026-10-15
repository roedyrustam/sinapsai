# Blueprint

## Architecture
SinapsAI is a universal in-process AI gateway and control plane NPM package (zero runtime dependencies). It consists of:

1. **Providers Layer**: Native integrations for top LLMs via unified `Provider` interface:
   - OpenAI (`OpenAiProvider`)
   - Anthropic Claude (`AnthropicProvider`)
   - Google Gemini (`GeminiProvider`)
   - DeepSeek (`DeepSeekProvider`)
   - Groq LPU (`GroqProvider`)
   - OpenRouter (`OpenRouterProvider`)
   - Mistral AI (`MistralProvider`)
   - Ollama Local (`OllamaProvider`)

2. **Core Layer**: 
   - `Router`: Strategizes failover, load balancing, lowest-latency, and lowest-cost configurations with hierarchical model-level fallbacks and prompt caching analytics.
   - `CircuitBreaker`: Hardened reliability against provider failures, mid-stream connection drops, and cascading outages.
   - `BatchExecutor`: High-throughput concurrent worker pool for parallel chat completions and embeddings with live progress callbacks.
   - `Storage`: Key-value state storage interface (`StateStorage`) with:
     - `InMemoryStorage` (pure in-memory with TTL)
     - `CloudflareKVStorage` (Cloudflare Workers KV binding)
     - `RedisStorage` (Redis / Upstash / Valkey via standard client contract or raw fetch)
     - `D1Storage` (Cloudflare D1 SQL storage with auto-migration and TTL cleanup)
   - `PIIGuardrails`: Zero-dependency in-process PII detection and redaction (email, phone, credit card with Luhn validation, SSN, IP, IBAN, passport, JWT, URL) before outgoing payloads leave process boundaries.

3. **Adapters & Ecosystem Layer**:
   - `sinapsai/ai-sdk`: Official adapter for the Vercel AI SDK (`ai`), implementing `LanguageModelV1` and `EmbeddingModelV1` with full streaming, tool calls, and structured outputs.

4. **Client Layer**:
   - `SinapsClient`: OpenAI-compatible ergonomic client with `.chat.completions.create()`, `.embeddings.create()`, `.batch()`, `.getMetrics()`, and `.getCircuitBreakerStatus()`.
