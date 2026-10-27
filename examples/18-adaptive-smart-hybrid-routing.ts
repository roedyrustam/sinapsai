/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 18: Adaptive & Smart-Hybrid Dynamic Routing
 *
 * Demonstrates how SinapsAI dynamically scores providers in real-time
 * using a composite of reliability (Laplace-smoothed success rate),
 * running latency, and cost efficiency to auto-route prompts to the healthiest provider.
 *
 * Run with: npx tsx examples/18-adaptive-smart-hybrid-routing.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  GroqProvider,
  OpenAiProvider,
  OpenRouterProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== SinapsAI: Adaptive & Smart-Hybrid Dynamic Routing ===\n');

  // Initialize client with multiple providers using the 'adaptive' strategy
  const client = new SinapsClient({
    providers: [
      new GroqProvider({
        id: 'groq-fast',
        apiKey: process.env.GROQ_API_KEY || 'dummy-groq-key',
        costPer1kTokens: 0.0005,
      }),
      new OpenRouterProvider({
        id: 'openrouter-free',
        apiKey: process.env.OPENROUTER_API_KEY || 'dummy-or-key',
        isFreeTier: true, // Cost = 0
      }),
      new OpenAiProvider({
        id: 'openai-standard',
        apiKey: process.env.OPENAI_API_KEY || 'dummy-openai-key',
        promptCostPer1k: 0.0025,
        completionCostPer1k: 0.01,
      }),
    ],
    strategy: 'adaptive', // Automatically scores reliability, speed, and cost
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(
          `[OK] Dispatched to ${provider.name} (${provider.id}) - Latency: ${latencyMs}ms`,
        );
      },
      onFallback: (err, from, to) => {
        console.warn(
          `[FALLBACK] ${from.name} degraded (${err.message}) -> Switching to ${to.name}`,
        );
      },
    },
  });

  console.log('Sending requests with adaptive scoring...');
  try {
    const response = await client.chat.completions.create({
      model: 'default',
      messages: [
        {
          role: 'user',
          content: 'Explain quantum computing in one short paragraph.',
        },
      ],
      maxTokens: 100,
    });

    console.log('\nResponse received:');
    console.log(response.choices[0]?.message?.content);

    // View live metrics
    console.log('\n--- Gateway Metrics ---');
    console.log(JSON.stringify(client.getMetrics(), null, 2));
  } catch (error) {
    console.log(
      'Executed in demo mode (ensure valid API keys in env):',
      (error as Error).message,
    );
  }
}

main();
