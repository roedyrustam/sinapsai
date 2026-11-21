/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 51: Moonshot AI (Kimi K2 Thinking) & Zhipu AI (GLM-4.5) Multi-Provider Gateway
 *
 * Demonstrates:
 * 1. Native MoonshotProvider with Kimi K2 Thinking (`reasoning_content`) and `$web_search`.
 * 2. Native ZhipuProvider with GLM-4.5 Hybrid Thinking (`thinking: { type: 'enabled' }`) and `embedding-3`.
 * 3. Automatic failover and adaptive routing across Kimi K2 and GLM-4.5.
 */

import {
  MOONSHOT_MODELS,
  MoonshotProvider,
  SinapsClient,
  ZHIPU_MODELS,
  ZhipuProvider,
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'adaptive',
  providers: [
    new MoonshotProvider({
      apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || 'sk-kimi-...',
      defaultModel: MOONSHOT_MODELS.KIMI_K2_THINKING,
    }),
    new ZhipuProvider({
      apiKey: process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || 'sk-zhipu-...',
      defaultModel: ZHIPU_MODELS.GLM_4_5,
    }),
  ],
});

async function main() {
  console.log('=== SinapsAI v3.7.0: Moonshot Kimi K2 & Zhipu GLM-4.5 Demo ===\n');

  try {
    const response = await client.chat.completions.create({
      model: MOONSHOT_MODELS.KIMI_K2_THINKING,
      messages: [
        { role: 'developer', content: 'Be concise and cite key facts.' },
        {
          role: 'user',
          content: 'Compare MoE routing efficiency in Kimi K2 and GLM-4.5.',
        },
      ],
      thinkingBudget: 'auto',
      webSearch: true,
    });

    if ('choices' in response) {
      if (response.choices[0].message.reasoning_content) {
        console.log('--- Reasoning ---');
        console.log(response.choices[0].message.reasoning_content);
      }
      console.log('--- Answer ---');
      console.log(response.choices[0].message.content);
    }
  } catch (error) {
    console.warn('Chat skipped or offline:', (error as Error).message);
  }

  try {
    const emb = await client.embeddings.create({
      model: ZHIPU_MODELS.EMBEDDING_3,
      input: 'SinapsAI v3.7.0 unified 15-provider control plane.',
      dimensions: 1024,
    });
    console.log(`\nEmbedding model: ${emb.model}, dims: ${emb.data[0].embedding.length}`);
  } catch (error) {
    console.warn('Embedding skipped or offline:', (error as Error).message);
  }
}

main().catch(console.error);
