/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 50: Alibaba Qwen Provider with QwQ Reasoning & Multimodal VL
 *
 * Demonstrates:
 * 1. Native QwenProvider integration with DashScope OpenAI-compatible endpoints.
 * 2. Deep reasoning with QwQ (qwq-plus / qwq-32b) capturing reasoning_content.
 * 3. Flagship synthesis with Qwen 3 Max (qwen3-max) and availability fallbacks.
 * 4. Embedding generation using text-embedding-v3.
 */

import { QWEN_MODELS, QwenProvider, SinapsClient } from 'sinapsai';

const qwen = new QwenProvider({
  apiKey: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || 'sk-qwen-...',
  defaultModel: QWEN_MODELS.QWEN_3_MAX,
});

const client = new SinapsClient({
  providers: [qwen],
});

async function main() {
  console.log('=== SinapsAI: Alibaba Qwen Provider & Reasoning Demo ===\n');

  // 1. Deep System-2 Reasoning with QwQ Plus
  console.log('1. Querying QwQ Plus with complex mathematical reasoning...');
  try {
    const stream = await client.chat.completions.create({
      model: QWEN_MODELS.QWQ_PLUS,
      messages: [
        {
          role: 'user',
          content:
            'A box contains 5 red balls and 7 blue balls. Two balls are drawn without replacement. What is the probability that both are red? Explain with full reasoning steps.',
        },
      ],
      stream: true,
    });

    let thoughtBuffer = '';
    let answerBuffer = '';

    if (Symbol.asyncIterator in stream) {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.reasoning_content) {
          thoughtBuffer += delta.reasoning_content;
          process.stdout.write(delta.reasoning_content);
        }
        if (delta?.content) {
          answerBuffer += delta.content;
          process.stdout.write(delta.content);
        }
      }
    }

    console.log('\n\n--- Done Streaming QwQ Reasoning ---');
  } catch (error) {
    console.warn('QwQ stream skipped or offline:', (error as Error).message);
  }

  // 2. High-Performance Text Embeddings with text-embedding-v3
  console.log('\n2. Generating dense embeddings with text-embedding-v3...');
  try {
    const embeddingRes = await client.embeddings.create({
      model: QWEN_MODELS.TEXT_EMBEDDING_V3,
      input: [
        'SinapsAI delivers zero-runtime-dependency AI gateway control plane.',
        'Qwen provides frontier multi-tier LLMs with deep reasoning capabilities.',
      ],
      dimensions: 1024,
    });

    console.log(`Model: ${embeddingRes.model}`);
    console.log(`Generated embeddings count: ${embeddingRes.data.length}`);
    console.log(`Vector 0 dimensions: ${embeddingRes.data[0].embedding.length}`);
    console.log(`Total tokens used: ${embeddingRes.usage?.totalTokens ?? 0}`);
  } catch (error) {
    console.warn('Embedding skipped or offline:', (error as Error).message);
  }

  console.log('\n=== Qwen Provider Demo Complete ===');
}

main().catch(console.error);
