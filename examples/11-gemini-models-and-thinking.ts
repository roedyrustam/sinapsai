/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  GEMINI_MODELS,
  GeminiProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 11: Official Google Gemini Models & Extended Thinking
 *
 * Implements Google Gemini API catalog (https://ai.google.dev/gemini-api/docs/models?hl=id)
 * featuring Gemini 2.5 Pro reasoning (thinkingBudget), MRL embeddings, and model discovery.
 */
async function run() {
  const geminiApiKey = process.env.GEMINI_API_KEY || 'test-gemini-key';

  console.log('--- 1. Canonical Google Gemini Models Catalog ---');
  console.log('Available Model Constants:');
  console.log(` - Fast & Multimodal: ${GEMINI_MODELS.FLASH_2_5}`);
  console.log(` - Ultra-Low Latency Lite: ${GEMINI_MODELS.FLASH_LITE_2_5}`);
  console.log(` - Deep Reasoning & Complex Code: ${GEMINI_MODELS.PRO_2_5}`);
  console.log(` - Next-Gen 3.x Flash: ${GEMINI_MODELS.FLASH_3_8}`);
  console.log(` - Managed Latest Alias: ${GEMINI_MODELS.FLASH_LATEST}`);
  console.log(` - Next-Gen Embeddings: ${GEMINI_MODELS.EMBEDDING_001}`);

  console.log('\n--- 2. Live Gemini Model Discovery ---');
  try {
    const models = await GeminiProvider.fetchAvailableModels({
      apiKey: geminiApiKey,
    });
    console.log(`Discovered ${models.length} active models in Gemini API:`);
    for (const m of models.slice(0, 5)) {
      console.log(
        ` - [${m.id}] ${m.displayName} (Input Limit: ${m.inputTokenLimit})`,
      );
    }
  } catch (err) {
    console.warn(
      'Note: Live discovery skipped (offline/dummy key mode):',
      (err as Error).message,
    );
  }

  console.log('\n--- 3. Client Setup with Extended Thinking Budget ---');
  const geminiProvider = new GeminiProvider({
    apiKey: geminiApiKey,
    defaultModel: GEMINI_MODELS.PRO_2_5, // Gemini 2.5 Pro
    safetySettings: [
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_LOW_AND_ABOVE',
      },
    ],
  });

  const client = new SinapsClient({
    strategy: 'failover',
    providers: [
      geminiProvider,
      new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY || 'backup-key' }),
    ],
  });

  console.log('Requesting reasoning completion with thinkingBudget: 2048...');
  try {
    const response = await client.chat.completions.create({
      model: GEMINI_MODELS.PRO_2_5,
      messages: [
        {
          role: 'user',
          content: 'Solve step-by-step: How many r are in strawberry?',
        },
      ],
      thinkingBudget: 2048, // Controls the reasoning budget token allowance
    });

    if ('choices' in response) {
      const message = response.choices[0].message;
      if (message.reasoning_content) {
        console.log('\n🧠 [Gemini Internal Reasoning / Thoughts]:');
        console.log(message.reasoning_content);
      }
      console.log('\n💬 [Final Answer]:');
      console.log(message.content);
    }
  } catch (err) {
    console.log('Chat completion simulated failover:', (err as Error).message);
  }

  console.log('\n--- 4. MRL Embeddings with Output Dimensionality ---');
  try {
    const embedding = await client.embeddings.create({
      model: GEMINI_MODELS.EMBEDDING_001,
      input: 'SinapsAI: High performance in-process LLM control plane',
      dimensions: 512, // Matryoshka Representation Learning (MRL) reduction
    });

    console.log(`Generated embedding vector length: ${embedding.data[0].embedding.length}`);
  } catch (err) {
    console.log('Embeddings call simulated:', (err as Error).message);
  }
}

run().catch(console.error);
