# Blueprint

## Architecture
SinapsAI is a universal in-process AI gateway and control plane NPM package (zero runtime dependencies). It consists of:

1. **Providers Layer**: Native integrations for top LLMs via unified `Provider` interface:
   - OpenAI (`OpenAiProvider`)
   - Anthropic Claude (`AnthropicProvider`)
   - Google Gemini (`GeminiProvider`)
   - AWS Bedrock (`AwsBedrockProvider` with zero-dependency SigV4)
   - Azure OpenAI (`AzureOpenAiProvider` with Entra ID & API key)
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
   - `SecurityGuardrails`: Zero-dependency heuristic scanner protecting against prompt injections, jailbreaks, delimiter hijacking, and system prompt exfiltration, hardened against ReDoS with zero-length regex advancing and injection-safe string replacers, enhanced with Steganography Firewall 2.0 (neutralizing zero-width characters, ASCII tag smuggling, bidi direction overrides, and Unicode NFKC normalization).
   - `GeminiAgentBooster`: Dynamic thinking budget estimation (`thinkingBudget: 'auto'`), deterministic KV-cache tool schema canonicalization with prototype pollution immunity, and metadata citation extraction.
   - `PIIGuardrails`: Zero-dependency in-process PII detection and redaction (email, phone, credit card with Luhn validation, SSN, IP, IBAN, passport, JWT, URL) with two-way Reversible Tokenization Vault in both non-streaming and streaming pipelines.
   - `LlmOptimizer` (LLMO): Universal prompt token minification preserving code blocks, system instruction deduplication, deterministic KV-cache prefix alignment, 3-tier complexity model cascading (`tier1`, `tier2`, `tier3`), confidence-calibrated cascading, and FinOps savings telemetry.
   - `McpToolBridge`: In-process Model Context Protocol (MCP) tool registry, bi-directional schema conversion (OpenAI / Unified `ToolDefinition`), resilient parallel tool execution, and MCP JSON-RPC 2.0 protocol dispatcher (`tools/list`, `tools/call`, `ping`).
   - `McpClientConnector` & `AutonomousDriftHealer`: Universal external MCP server ingestion over Stdio and SSE/HTTP with autonomous API schema drift repair, parameter fuzzy aliasing, and type coercion.
   - `AgentSwarm` & `SwarmContext`: In-process Multi-Agent Swarm orchestrator with dynamic Agent-to-Agent (A2A) handoff protocol, thread-safe shared context memory, automated transfer tool generation (`transfer_to_<agent_id>`), ping-pong recursion protection (`maxHandoffs`), parallel concurrent subagent fan-out with Map-Reduce and atomic context deep-merge (`deepMergeContext`), Actor-Critic self-correcting consensus loop (`runActorCritic`), and Linux Foundation / Open Agentic standard A2A Agent Card export (`exportAgentCards()`).
   - `CognitiveBrain`: Unified in-process tri-memory cognitive architecture synthesizing Episodic Memory (facts), Knowledge Graph (entity triples), and Hybrid RAG (BM25 + Dense Vectors) with LRU memory safeguards.
   - `DurableWorkflowEngine`: Resilient step-by-step checkpointing for autonomous agent loops and multi-agent swarms with atomic step recording, Human-in-the-Loop (HITL) suspension gates (`suspendForApproval`, `resolveApproval`), streaming step subscriptions (`onStep`), permanent checkpoint deletion (`deleteWorkflow`), and resumption API.
   - `Telemetry & Metrics Exporters`: Zero-dependency formatting utilities emitting Prometheus / OpenMetrics text exposition format (`formatPrometheusMetrics`), OpenTelemetry OTLP JSON `ResourceMetrics` (`formatOtelMetrics`), and OpenTelemetry GenAI Semantic Conventions v1.30+ distributed traces (`exportOtelTraces`).
   - `Storage`: Key-value state storage interface (`StateStorage`) with atomic counter increments (`increment(key, ttlSeconds)`) across:
     - `InMemoryStorage` (pure in-memory with TTL and atomic increment)
     - `CloudflareKVStorage` (Cloudflare Workers KV binding with atomic counter emulation)
     - `RedisStorage` (Redis / Upstash / Valkey via native atomic INCR/EXPIRE)
     - `D1Storage` (Cloudflare D1 SQL storage with atomic SQL increment transaction and auto-migration)

3. **Adapters & Ecosystem Layer**:
   - `sinapsai/ai-sdk`: Official adapter for the Vercel AI SDK (`ai`), implementing `LanguageModelV1` and `EmbeddingModelV1` with full streaming, tool calls, and structured outputs.

4. **Client Layer**:
   - `SinapsClient`: OpenAI-compatible ergonomic client with `.chat.completions.create()`, `.embeddings.create()`, `.batch()`, `.runWithTools()`, `.runWithToolsStream()`, `.swarm()`, `.runActorCritic()`, `.brain`, `.workflows`, `.graph`, `.rag`, `.memory`, `.evals`, `.llmo`, `.optimizePrompt()`, `.contextCache` (`create`, `get`, `list`, `delete`, `evaluateEligibility`), `.mcp`, `.checkHealth()`, `.getMetrics()`, `.getCircuitBreakerStatus()`, `.resetCircuitBreaker()`, `.clearCache()`, `.setModelAlias()`, `.getModelAliases()`, `.removeModelAlias()`, `.resolveModel()`, `.exportPrometheusMetrics()`, `.toPrometheusMetrics()`, `.exportOtelMetrics()`, `.toOtelMetrics()`, and `.exportOtelTraces()`.
