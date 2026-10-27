/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 13: Superintelligence Edition — Universal Reasoning & Latency-Based Routing
 *
 * Demonstrates SinapsAI v2.0 Superintelligence capabilities:
 * 1. 'lowest-latency' Strategy: Dynamically routes to the fastest provider based on running average latency.
 * 2. Universal Reasoning: Unified control for thinking budgets and reasoning effort across:
 *    - Claude 3.7 Sonnet (`thinkingBudget`)
 *    - OpenAI o1/o3/o4 (`reasoningEffort: 'low' | 'medium' | 'high'`)
 *    - Groq DeepSeek/LPU (`thinkingBudget` / `reasoning_content`)
 *    - Google Gemini 2.0 Flash Thinking
 * 3. KV-Cache & Prompt Caching Analytics: Real-time tracking of `cachedPromptTokens` to reduce cloud LLM bills by 70-90%.
 */
async function run() {
  console.log('=== SinapsAI v2.0 Superintelligence Edition ===\n');

  // Initialize multiple frontier providers
  const groq = new GroqProvider({
    apiKey: process.env.GROQ_API_KEY || 'dummy-groq-key',
    defaultModel: 'llama-3.3-70b-versatile',
  });

  const openai = new OpenAiProvider({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-openai-key',
    defaultModel: 'o3-mini',
  });

  const anthropic = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY || 'dummy-anthropic-key',
    defaultModel: 'claude-3-7-sonnet-20250219',
  });

  const gemini = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY || 'dummy-gemini-key',
    defaultModel: 'gemini-2.0-flash-thinking-exp-01-21',
  });

  // Create client with 'lowest-latency' dynamic routing
  const client = new SinapsClient({
    strategy: 'lowest-latency',
    providers: [groq, openai, anthropic, gemini],
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(
          `[Fastest Route] Served by ${provider.name} in ${latencyMs}ms`,
        );
        if (res.usage?.cachedPromptTokens) {
          console.log(
            `[KV-Cache Hit] Cached prompt tokens: ${res.usage.cachedPromptTokens}`,
          );
        }
      },
      onFallback: (err, from, to) => {
        console.warn(
          `[Failover] ${from.name} failed (${err.message}). Route adjusted to ${to.name}.`,
        );
      },
    },
  });

  console.log('--- 1. Testing Universal Reasoning Request ---');
  console.log(
    'Dispatching complex problem with extended thinking parameters...\n',
  );

  try {
    const res = await client.chat.completions.create({
      model: 'o3-mini',
      messages: [
        {
          role: 'user',
          content:
            'Calculate the probability of drawing 4 aces in a 5-card poker hand and explain the derivation.',
        },
      ],
      // Frontier Reasoning Parameters
      reasoningEffort: 'high',
      thinkingBudget: 4096,
      maxTokens: 5000,
    });

    if ('choices' in res) {
      const choice = res.choices[0];
      if (choice?.message.reasoning_content) {
        console.log('--- Internal Thought Process (Chain of Thought) ---');
        console.log(choice.message.reasoning_content.slice(0, 300) + '...\n');
      }

      console.log('--- Final Synthesized Response ---');
      console.log(choice?.message.content);

      console.log('\n--- Usage & Cache Metrics ---');
      console.log(`- Prompt Tokens: ${res.usage?.promptTokens}`);
      console.log(`- Completion Tokens: ${res.usage?.completionTokens}`);
      console.log(
        `- Cached Tokens (KV-Cache): ${res.usage?.cachedPromptTokens ?? 0}`,
      );
    }
  } catch (err) {
    console.log(
      `(Simulated execution without live API key: ${(err as Error).message})\n`,
    );
  }

  console.log('--- 2. Checking Gateway Global Metrics & Latencies ---');
  const metrics = client.getMetrics();
  console.log('Gateway Telemetry:');
  console.log(`- Total Requests: ${metrics.totalRequests}`);
  console.log(
    `- Total Cached Prompt Tokens: ${metrics.totalCachedPromptTokens ?? 0}`,
  );
  console.log(
    `- Estimated Total Cost: $${metrics.estimatedCostUsd.toFixed(6)}`,
  );

  console.log('\nProvider Latencies (Dynamic Ranking):');
  for (const [providerId, pMetrics] of Object.entries(
    metrics.providerMetrics,
  )) {
    console.log(
      `  • ${providerId}: avg ${pMetrics.averageLatencyMs}ms (${pMetrics.requests} requests, ${pMetrics.successes} ok, ${pMetrics.failures} err)`,
    );
  }

  console.log('\n=== Superintelligence Orchestration Complete ===');
}

run().catch(console.error);
