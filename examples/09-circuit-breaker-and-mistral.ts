/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 09: Mistral AI Provider, Gemini Embeddings & Circuit Breaker Control
 *
 * Demonstrates:
 * 1. Native MistralProvider usage (Chat + Embeddings).
 * 2. Multi-provider embeddings failover with GeminiProvider & OpenAiProvider.
 * 3. In-process Circuit Breaker status inspection (`client.getCircuitBreakerStatus()`).
 * 4. Manual circuit breaker reset (`client.resetCircuitBreaker()`).
 * 5. In-process cache clearing (`client.clearCache()`).
 */

import {
  GeminiProvider,
  MistralProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('--- SinapsAI v1.6.0 Enterprise Control Plane ---\n');

  const mistral = new MistralProvider({
    apiKey: process.env.MISTRAL_API_KEY || 'mistral-api-key',
    defaultModel: 'mistral-large-latest',
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.006,
  });

  const gemini = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY || 'gemini-api-key',
    defaultModel: 'text-embedding-004',
  });

  const openai = new OpenAiProvider({
    apiKey: process.env.OPENAI_API_KEY || 'openai-api-key',
  });

  const client = new SinapsClient({
    strategy: 'failover',
    providers: [mistral, gemini, openai],
    cache: { enabled: true, ttlSeconds: 120 },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeoutMs: 15000,
    },
  });

  // 1. Inspect initial Circuit Breaker Status
  console.log('1. Checking Circuit Breaker status across all providers:');
  const initialStatus = await client.getCircuitBreakerStatus();
  console.log(JSON.stringify(initialStatus, null, 2));

  // 2. Clear cache example
  console.log('\n2. Purging in-process prompt/embedding cache:');
  await client.clearCache();
  console.log('Cache successfully cleared.');

  // 3. Reset circuit breaker example
  console.log('\n3. Resetting circuit breaker state for Mistral:');
  await client.resetCircuitBreaker(mistral.id);
  console.log('Circuit breaker state reset.');

  console.log('\n--- Setup Complete ---');
}

main().catch(console.error);
