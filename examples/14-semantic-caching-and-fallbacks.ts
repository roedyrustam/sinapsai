/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  cosineSimilarity,
  extractPromptText,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 14: Semantic In-Process Response Caching & Hierarchical Fallbacks
 *
 * Demonstrates:
 * 1. Zero-dependency in-process Semantic Caching using cosine similarity.
 * 2. Semantic cache hit observation via `onSemanticCacheHit` hook.
 * 3. Hierarchical model fallbacks: attempting candidate models on the same provider
 *    before escalating to provider failover.
 * 4. Multi-modal ContentPart[] request handling.
 */
async function run() {
  console.log('=== SinapsAI Semantic Caching & Hierarchical Fallbacks ===\n');

  // Vector embedding lookup mock or provider
  const openai = new OpenAiProvider({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
    defaultModel: 'gpt-4o',
    fallbackModels: ['gpt-4o-mini'],
  });

  // Client configured with semantic caching and hierarchical fallback models
  const client = new SinapsClient({
    providers: [openai],
    cache: {
      enabled: true,
      ttlSeconds: 300,
      semantic: {
        enabled: true,
        similarityThreshold: 0.9,
        // Demonstrating customEmbed for zero-latency local embedding vectors:
        customEmbed: async (text: string) => {
          if (text.toLowerCase().includes('capital of france')) {
            return [0.99, 0.05, 0.01];
          }
          if (text.toLowerCase().includes('weather')) {
            return [0.01, 0.99, 0.02];
          }
          return [0.5, 0.5, 0.5];
        },
      },
    },
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(
          `[Success] ${provider.name} (${res.model}) replied in ${latencyMs}ms`,
        );
      },
      onModelFallback: (err, provider, fromM, toM) => {
        console.warn(
          `[Model Fallback] ${provider.name} failed on ${fromM} (${err.message}). Trying fallback model ${toM}...`,
        );
      },
      onSemanticCacheHit: (req, cachedRes, similarity) => {
        console.log(
          `[Semantic Cache HIT!] Similarity score: ${(similarity * 100).toFixed(1)}%`,
        );
        console.log(
          `[Semantic Cache HIT!] Cached Answer: "${cachedRes.choices[0].message.content}"`,
        );
      },
    },
  });

  console.log('1. First Query: "What is the capital of France?"');
  console.log('(Simulating initial query to populate the semantic cache)\n');

  // Multi-modal message format supported
  await client.chat.completions.create({
    model: 'gpt-4o',
    fallbackModels: ['gpt-4o-mini'],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'What is the capital of France?' }],
      },
    ],
  });

  console.log('\n2. Second Query: "Can you tell me the capital of France?"');
  console.log(
    '(Different wording, but semantically equivalent -> triggers Semantic Cache Hit!)\n',
  );

  const cachedRes = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'Can you tell me the capital of France?',
      },
    ],
  });

  console.log(`Result model: ${cachedRes.model}`);

  // Test vector math directly
  const vecA = [1, 0, 0];
  const vecB = [0.98, 0.1, 0];
  console.log(
    `\nCosine similarity between collinear vectors: ${cosineSimilarity(vecA, vecB).toFixed(4)}`,
  );
}

run().catch(console.error);
