# 💡 SinapsAI Examples

This folder contains plug-and-play runnable code examples.

## Running Examples Locally

You can run any example directly with `tsx` (TypeScript Execute) without building:

```bash
# 1. Multi-provider failover simulation
npx tsx examples/01-failover-quickstart.ts

# 2. Real-time streaming (SSE)
OPENAI_API_KEY="your-key" npx tsx examples/02-streaming-sse.ts

# 3. Round-Robin load balancing across multiple keys
npx tsx examples/03-load-balancing.ts

# 4. Custom local provider (Ollama)
npx tsx examples/04-custom-provider-ollama.ts

# 5. Cloudflare Workers / Edge Runtime
# See examples/05-edge-cloudflare-worker.ts

# 6. DeepSeek & Reasoning models (deepseek-reasoner / R1)
DEEPSEEK_API_KEY="your-key" npx tsx examples/06-deepseek-reasoner.ts

# 7. Unified Embeddings with Automatic Failover & Caching
npx tsx examples/07-embeddings-failover.ts

# 8. Dual-Pricing, Proactive Throttling & In-Process Metrics
npx tsx examples/08-metrics-and-rate-limiting.ts

# 9. Mistral AI, Gemini Embeddings & Circuit Breaker Control
npx tsx examples/09-circuit-breaker-and-mistral.ts

# 10. OpenRouter Free Tier & Zero-Cost Routing (variant=free)
OPENROUTER_API_KEY="your-key" npx tsx examples/10-openrouter-free-tier.ts

# 11. Google Gemini 2.5 / 3.x Models, Extended Thinking & MRL Embeddings
GEMINI_API_KEY="your-key" npx tsx examples/11-gemini-models-and-thinking.ts

# 12. Groq LPU Ultra-Fast Inference, Reasoning Models & Duration Rate Limits
GROQ_API_KEY="your-key" npx tsx examples/12-groq-lightning-fast-reasoning.ts

# 13. Superintelligence Edition: Latency-Based Routing, Extended Thinking & KV-Cache
OPENAI_API_KEY="your-key" ANTHROPIC_API_KEY="your-key" npx tsx examples/13-superintelligence-latency-and-reasoning.ts

# 14. Semantic In-Process Response Caching & Hierarchical Fallbacks
npx tsx examples/14-semantic-caching-and-fallbacks.ts

# 15. Concurrent In-Process Batch Processing (client.batch)
npx tsx examples/15-concurrent-batch-processing.ts

# 16. Vercel AI SDK Official Adapter (sinapsai/ai-sdk)
npx tsx examples/16-vercel-ai-sdk-adapter.ts

# 17. Distributed Storage Adapters & In-Process PII Guardrails
npx tsx examples/17-distributed-storage-and-pii-guardrails.ts

# 18. Adaptive & Smart-Hybrid Routing Strategy
npx tsx examples/18-adaptive-smart-hybrid-routing.ts

# 19. Reversible PII Vault & Response De-anonymization
npx tsx examples/19-reversible-pii-vault.ts

# 20. Streaming Tool Call Accumulation & Resilient JSON Extraction
npx tsx examples/20-streaming-tool-accumulator-and-json.ts

# 21. Model Aliases & Gateway Health Probes
npx tsx examples/21-model-aliases-and-health-checks.ts

# 22. Security Guardrails & Prompt Injection Defense
npx tsx examples/22-security-prompt-injection-defense.ts

# 23. Context Compression & FinOps Budget Guardrails
npx tsx examples/23-context-compression-and-budget.ts

# 24. xAI (Grok) & Cohere v2 Providers Integration
npx tsx examples/24-xai-and-cohere-providers.ts

# 25. Hedged Speculative Requests for Tail-Latency (P99) Reduction
npx tsx examples/25-hedged-requests-tail-latency.ts
```


