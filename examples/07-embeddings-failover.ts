/**
 * Example 07: Unified Embeddings Control Plane with Automatic Failover & Caching
 *
 * Demonstrates text embeddings generation with automatic fallback from OpenAI to local Ollama.
 */

import {
  InMemoryStorage,
  OllamaProvider,
  OpenAiProvider,
  SinapsClient,
} from 'sinapsai';

const storage = new InMemoryStorage();

const client = new SinapsClient({
  storage,
  strategy: 'failover',
  cache: { enabled: true, ttlSeconds: 300 }, // Cache embeddings in-memory to save cost
  providers: [
    new OpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY || 'sk-...',
      defaultModel: 'text-embedding-3-small',
    }),
    new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      defaultModel: 'nomic-embed-text',
      modelMap: {
        'text-embedding-3-small': 'nomic-embed-text',
      },
    }),
  ],
});

async function run() {
  console.log('Generating text embedding with automatic failover & caching...');

  const query = 'Artificial intelligence control plane with circuit breaker';

  try {
    // 1st call: Computes via provider (or falls back to Ollama if OpenAI is unavailable)
    const startTime = Date.now();
    const result1 = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    console.log(`Generated in ${Date.now() - startTime}ms:`, {
      model: result1.model,
      dimensions: result1.data[0].embedding.length,
      sampleVector: result1.data[0].embedding.slice(0, 3),
      tokensUsed: result1.usage?.totalTokens,
    });

    // 2nd call: Exact same text is served from in-memory cache in <1ms!
    const cacheStartTime = Date.now();
    const result2 = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    console.log(
      `Cached hit in ${Date.now() - cacheStartTime}ms (0 API calls, 0 cost!):`,
      {
        model: result2.model,
        dimensions: result2.data[0].embedding.length,
      },
    );
  } catch (error) {
    console.error('Embedding error:', (error as Error).message);
  }
}

run();
