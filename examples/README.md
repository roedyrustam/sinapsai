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
```
