/**
 * Example 08: In-Process Metrics, Dual-Token Pricing & Adaptive Rate Limiting
 *
 * Demonstrates:
 * 1. Setting up providers with dual pricing (promptCostPer1k vs completionCostPer1k).
 * 2. Automatic weighted cost routing selecting the cheapest provider for prompt vs completion balance.
 * 3. Event hooks for rate limit warning (`onRateLimitWarning`) and proactive throttling.
 * 4. Querying cumulative runtime telemetry with `client.getMetrics()`.
 */

import {
  DeepSeekProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  const client = new SinapsClient({
    strategy: 'lowest-cost',
    providers: [
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'sk-demo',
        promptCostPer1k: 0.0025,    // $2.50 / 1M prompt
        completionCostPer1k: 0.010, // $10.00 / 1M completion
      }),
      new DeepSeekProvider({
        apiKey: process.env.DEEPSEEK_API_KEY || 'sk-demo',
        promptCostPer1k: 0.00027,   // $0.27 / 1M prompt (cache miss)
        completionCostPer1k: 0.0011,// $1.10 / 1M completion
      }),
    ],
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(`[Success] Provider: ${provider.name} in ${latencyMs}ms`);
      },
      onRateLimitWarning: (provider, rl) => {
        console.warn(
          `[Warning] Provider ${provider.name} is running low on capacity! Remaining requests: ${rl.remainingRequests}`,
        );
      },
      onFallback: (err, from, to) => {
        console.warn(`[Fallback] ${from.name} -> ${to.name} due to: ${err.message}`);
      },
    },
    cache: {
      enabled: true,
      ttlSeconds: 60,
    },
  });

  console.log('Sending chat completion requests...');

  try {
    const res = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Explain quantum computing in 2 sentences.' }],
      maxTokens: 100,
    });

    console.log('\nResponse received:');
    console.log(res.choices[0]?.message?.content);
  } catch (error) {
    console.error('Request failed:', (error as Error).message);
  }

  // Inspect in-process metrics
  const metrics = client.getMetrics();
  console.log('\n--- Real-Time Gateway Telemetry ---');
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Successful: ${metrics.successfulRequests}`);
  console.log(`Failed: ${metrics.failedRequests}`);
  console.log(`Cached: ${metrics.cachedRequests}`);
  console.log(`Total Tokens: ${metrics.totalTokens} (Prompt: ${metrics.totalPromptTokens}, Completion: ${metrics.totalCompletionTokens})`);
  console.log(`Estimated Spend: $${metrics.estimatedCostUsd.toFixed(6)} USD`);
  console.log('\nProvider breakdown:');
  console.table(metrics.providerMetrics);
}

main().catch(console.error);
