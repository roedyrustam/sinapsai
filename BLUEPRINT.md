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
   - xAI Grok (`XAiProvider`)
   - Cohere v2 (`CohereProvider`)

2. **Core Layer**: 
   - `Router`: Strategizes failover, load balancing, lowest-latency, lowest-cost, and adaptive smart-hybrid configurations with hierarchical model-level fallbacks, prompt caching analytics, and semantic caching.
   - `CircuitBreaker`: Hardened reliability against provider failures, mid-stream connection drops, and cascading outages with automatic recovery states (`CLOSED`, `OPEN`, `HALF_OPEN`) and strict single-canary probe admission.
   - `GatewayRateLimiter`: High-performance sliding-window counter algorithm enforcing Requests Per Minute (RPM) and Tokens Per Minute (TPM) across global, user, model, and provider tiers with post-response token adjustment for non-streaming and streaming workloads.
   - `BatchExecutor`: High-throughput concurrent worker pool for parallel chat completions and embeddings with live progress callbacks (`onProgress`) and fail-soft settled execution.
   - `HedgedExecutor`: Speculative hedged requests launching backup calls if primary latency exceeds `delayMs` to eliminate P99 tail-latencies.
   - `BudgetGuardrails`: FinOps spend tracking enforcing hard USD caps (`maxCostUsd`) and token limits (`maxTotalTokens`) with blocking or warning callbacks.
   - `ContextCompressor`: Zero-dependency token estimation and dynamic conversation trimming (`sliding-window` and `middle-out`) with atomic tool-call preservation.
   - `SecurityGuardrails`: Zero-dependency heuristic scanner protecting against prompt injections, jailbreaks, delimiter hijacking, and system prompt exfiltration.
   - `PIIGuardrails`: Zero-dependency in-process PII detection and redaction (email, phone, credit card with Luhn validation, SSN, IP, IBAN, passport, JWT, URL) with two-way Reversible Tokenization Vault.
   - `McpToolBridge`: In-process Model Context Protocol (MCP) tool registry, bi-directional schema conversion (OpenAI / Unified `ToolDefinition`), resilient parallel tool execution, and MCP JSON-RPC 2.0 protocol dispatcher (`tools/list`, `tools/call`, `ping`).
   - `Telemetry & Metrics Exporters`: Zero-dependency formatting utilities emitting Prometheus / OpenMetrics text exposition format (`formatPrometheusMetrics`) and OpenTelemetry OTLP JSON `ResourceMetrics` (`formatOtelMetrics`).
   - `Storage`: Key-value state storage interface (`StateStorage`) with:
     - `InMemoryStorage` (pure in-memory with TTL)
     - `CloudflareKVStorage` (Cloudflare Workers KV binding)
     - `RedisStorage` (Redis / Upstash / Valkey via standard client contract or raw fetch)
     - `D1Storage` (Cloudflare D1 SQL storage with auto-migration and TTL cleanup)

3. **Adapters & Ecosystem Layer**:
   - `sinapsai/ai-sdk`: Official adapter for the Vercel AI SDK (`ai`), implementing `LanguageModelV1` and `EmbeddingModelV1` with full streaming, tool calls, and structured outputs.

4. **Client Layer**:
   - `SinapsClient`: OpenAI-compatible ergonomic client with `.chat.completions.create()`, `.embeddings.create()`, `.batch()`, `.runWithTools()`, `.mcp`, `.checkHealth()`, `.getMetrics()`, `.getCircuitBreakerStatus()`, `.resetCircuitBreaker()`, `.clearCache()`, `.setModelAlias()`, `.getModelAliases()`, `.removeModelAlias()`, `.resolveModel()`, `.exportPrometheusMetrics()`, `.toPrometheusMetrics()`, `.exportOtelMetrics()`, and `.toOtelMetrics()`.
