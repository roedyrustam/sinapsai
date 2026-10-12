import {
  GeminiProvider,
  OpenRouterProvider,
  SinapsClient,
  createOpenRouterFreeProvider,
} from '../src/index.js';

/**
 * Example 10: OpenRouter Free Models & Zero-Cost Routing
 *
 * Implements OpenRouter's Free Tier (https://openrouter.ai/models?variant=free)
 * using `openrouter/free` router, native model fallback chains, and $0 cost tracking.
 */
async function run() {
  console.log('--- 1. Inspecting Live Free Models on OpenRouter ---');
  try {
    const freeModels = await OpenRouterProvider.fetchFreeModels();
    console.log(
      `Found ${freeModels.length} free models on OpenRouter (variant=free):`,
    );
    for (const m of freeModels.slice(0, 5)) {
      console.log(` - [${m.id}] ${m.name} (Context: ${m.contextLength})`);
    }
  } catch (err) {
    console.warn(
      'Note: Could not fetch dynamic models list (offline mode):',
      (err as Error).message,
    );
  }

  console.log('\n--- 2. Initializing Zero-Cost SinapsAI Gateway ---');

  // Provider 1: OpenRouter Free Tier (Prioritized with cost $0)
  const openRouterFree = createOpenRouterFreeProvider({
    apiKey: process.env.OPENROUTER_API_KEY || 'test-openrouter-key',
    siteUrl: 'https://github.com/roedyrustam/sinapsai',
    siteName: 'SinapsAI Free Gateway Demo',
    model: 'openrouter/free', // Meta-router selecting active free models
    fallbackModels: [
      'openrouter/free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3.5-lightning:free',
    ],
  });

  // Provider 2: Backup Paid/Tier provider in case of free tier rate limits (429)
  const geminiBackup = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY || 'test-gemini-key',
    defaultModel: 'gemini-1.5-flash',
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
  });

  const client = new SinapsClient({
    strategy: 'lowest-cost', // Will automatically pick the $0 free provider first!
    providers: [openRouterFree, geminiBackup],
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(
          `✅ [Success] Served by ${provider.name} (${res.model}) in ${latencyMs}ms`,
        );
      },
      onFallback: (error, from, to) => {
        console.log(
          `⚡ [Failover] ${from.name} hit limit (${error.message}). Failing over to ${to.name}.`,
        );
      },
    },
  });

  console.log('Sending chat completion request...');
  try {
    const response = await client.chat.completions.create({
      model: 'openrouter/free',
      messages: [
        {
          role: 'user',
          content: 'Explain in one short sentence why open-source AI is great.',
        },
      ],
      // OpenRouter will also try this fallback list natively if the router model is saturated:
      fallbackModels: [
        'google/gemma-4-31b-it:free',
        'nvidia/nemotron-3.5-lightning:free',
      ],
    });

    if ('choices' in response) {
      console.log('\nResponse Output:');
      console.log(response.choices[0].message.content);
    }
  } catch (err) {
    console.error('Request failed:', (err as Error).message);
  }

  console.log('\n--- 3. Cost & Gateway Metrics ---');
  const metrics = client.getMetrics();
  console.log(
    `Total Requests: ${metrics.totalRequests} | Total Tokens: ${metrics.totalTokens}`,
  );
  console.log(`Estimated Cost: $${metrics.estimatedCostUsd.toFixed(6)} USD`);
}

run().catch(console.error);
