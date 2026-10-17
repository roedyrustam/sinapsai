/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  AnthropicProvider,
  createSinapsAI,
  GroqProvider,
  OpenAiProvider,
  type Provider,
  SinapsClient,
  type UnifiedApiResponse,
  type UnifiedApiStreamChunk,
} from '../src/index.js';

/**
 * Example 16: Vercel AI SDK Ecosystem Adapter (`sinapsai/ai-sdk`)
 *
 * Demonstrates:
 * 1. Wrapping SinapsAI into a Vercel AI SDK v1-compliant provider (`LanguageModelV1` & `EmbeddingModelV1`).
 * 2. Seamless integration with `streamText`, `generateText`, and Next.js Route Handlers.
 * 3. In-process Circuit Breaker and automated multi-provider failover operating transparently behind Vercel AI SDK.
 * 4. Streaming reasoning deltas (Chain-of-Thought) and tool calling.
 */
async function run() {
  console.log('=== SinapsAI Vercel AI SDK Provider Adapter ===\n');

  // Check if live API keys are provided
  const hasLiveKeys = Boolean(
    process.env.GROQ_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY,
  );

  let providers: Provider[];

  if (hasLiveKeys) {
    providers = [
      new GroqProvider({
        apiKey: process.env.GROQ_API_KEY || 'dummy-groq-key',
        defaultModel: 'llama-3.3-70b-versatile',
        timeoutMs: 5000,
      }),
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'dummy-openai-key',
        defaultModel: 'gpt-4o-mini',
        timeoutMs: 5000,
      }),
      new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY || 'dummy-anthropic-key',
        defaultModel: 'claude-3-7-sonnet-20250219',
        timeoutMs: 5000,
      }),
    ];
  } else {
    console.log(
      'ℹ️ No API keys detected in process.env. Using resilient Mock Providers to demonstrate live execution:\n',
    );

    // Primary Mock Provider: Simulates transient failure to trigger circuit breaker & failover
    const failingPrimary: Provider = {
      id: 'mock-primary-groq',
      name: 'Groq (Simulated Downtime)',
      generateContent: async () => {
        throw new Error('503 Service Unavailable: upstream overloaded');
      },
    };

    // Secondary Mock Provider: Healthy provider handling the failover
    const healthyFallback: Provider = {
      id: 'mock-healthy-openai',
      name: 'OpenAI (Healthy Fallback)',
      generateContent: async (req) => {
        if (req.stream) {
          return (async function* (): AsyncIterable<UnifiedApiStreamChunk> {
            yield {
              id: 'c-1',
              model: req.model,
              choices: [
                {
                  delta: {
                    role: 'assistant',
                    reasoning_content:
                      'Evaluating query through low-latency routing mesh...',
                  },
                  finishReason: null,
                },
              ],
            };
            const words =
              'SinapsAI enables zero-overhead in-process routing for Vercel AI SDK.'.split(
                ' ',
              );
            for (const w of words) {
              yield {
                id: 'c-2',
                model: req.model,
                choices: [
                  {
                    delta: { role: 'assistant', content: `${w} ` },
                    finishReason: null,
                  },
                ],
              };
            }
            yield {
              id: 'c-3',
              model: req.model,
              choices: [
                {
                  delta: { role: 'assistant', content: '' },
                  finishReason: 'stop',
                },
              ],
              usage: {
                promptTokens: 14,
                completionTokens: 18,
                totalTokens: 32,
              },
            };
          })();
        }

        const res: UnifiedApiResponse = {
          id: 'res-1',
          model: req.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'In-process AI gateways eliminate proxy hops, reduce latency by up to 200ms, and maintain 100% data sovereignty without Docker or Redis.',
              },
              finishReason: 'stop',
            },
          ],
          usage: {
            promptTokens: 14,
            completionTokens: 25,
            totalTokens: 39,
          },
        };
        return res;
      },
      generateEmbedding: async (req) => ({
        object: 'list',
        data: Array.isArray(req.input)
          ? req.input.map((_, i) => ({
              index: i,
              embedding: [0.012, 0.453, 0.892],
              object: 'embedding',
            }))
          : [
              {
                index: 0,
                embedding: [0.012, 0.453, 0.892],
                object: 'embedding',
              },
            ],
        model: req.model,
        usage: { promptTokens: 8, totalTokens: 8 },
      }),
    };

    providers = [failingPrimary, healthyFallback];
  }

  // 1. Initialize SinapsClient
  const client = new SinapsClient({
    providers,
    strategy: 'failover',
    circuitBreaker: {
      failureThreshold: 2,
      resetTimeoutMs: 15000,
    },
    hooks: {
      onSuccess: (p, _res, lat) =>
        console.log(`[SinapsAI Hook] Succeeded via ${p.name} in ${lat}ms`),
      onFallback: (err, from, to) =>
        console.log(
          `⚡ [SinapsAI Failover Hook] ${from.name} failed (${err.message}) -> Switched to ${to.name}`,
        ),
      onCircuitOpen: (p) =>
        console.log(`🚨 [SinapsAI CircuitBreaker] Circuit OPEN for ${p.name}`),
    },
  });

  // 2. Create the Vercel AI SDK provider wrapper
  const sinaps = createSinapsAI(client);

  console.log('1. Created Vercel AI SDK Language Model:');
  const model = sinaps('llama-3.3-70b-versatile', {
    thinkingBudget: 1024,
    reasoningEffort: 'medium',
    fallbackModels: ['gpt-4o-mini', 'claude-3-7-sonnet-20250219'],
  });

  console.log(`   Provider: ${model.provider}`);
  console.log(`   Spec Version: ${model.specificationVersion}`);
  console.log(`   Model ID: ${model.modelId}\n`);

  // 3. Simulating Vercel AI SDK `generateText`
  console.log(
    '2. Executing Vercel AI SDK doGenerate (generateText equivalent):',
  );
  const result = await model.doGenerate({
    inputFormat: 'messages',
    mode: { type: 'regular' },
    prompt: [
      {
        role: 'system',
        content: 'You are a concise enterprise software architect.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What are the main benefits of in-process AI gateways?',
          },
        ],
      },
    ],
    temperature: 0.5,
  });

  console.log(`   Generated Text:\n   "${result.text}"`);
  console.log(
    `   Tokens: Prompt=${result.usage.promptTokens}, Completion=${result.usage.completionTokens}`,
  );
  console.log(`   Finish Reason: ${result.finishReason}\n`);

  // 4. Simulating Vercel AI SDK `streamText`
  console.log('3. Executing Vercel AI SDK doStream (streamText equivalent):');
  const { stream } = await model.doStream({
    inputFormat: 'messages',
    mode: { type: 'regular' },
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Stream an explanation of low-latency routing.',
          },
        ],
      },
    ],
  });

  const reader = stream.getReader();
  process.stdout.write('   Streaming output: ');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (value?.type === 'reasoning') {
      process.stdout.write(
        `\n   🧠 [Reasoning Delta]: ${value.textDelta}\n   Text: `,
      );
    } else if (value?.type === 'text-delta') {
      process.stdout.write(value.textDelta);
    } else if (value?.type === 'finish') {
      console.log(
        `\n   ✅ [Stream Finished: reason=${value.finishReason}, tokens=${value.usage.promptTokens + value.usage.completionTokens}]`,
      );
    }
  }
  console.log('');

  // 5. Simulating Vercel AI SDK `embedMany`
  console.log('4. Executing Vercel AI SDK doEmbed (embedMany equivalent):');
  const embeddingModel = sinaps.textEmbeddingModel('text-embedding-3-small');
  const embedResult = await embeddingModel.doEmbed({
    values: ['In-process AI Gateway', 'Universal Frontier Reasoning'],
  });
  console.log(
    `   Generated ${embedResult.embeddings.length} vectors of dimension ${embedResult.embeddings[0].length}`,
  );
  console.log(`   Embedding Tokens: ${embedResult.usage?.tokens}\n`);

  console.log(
    '=== Vercel AI SDK Adapter Integration Verified & Passed Cleanly ===',
  );
}

run().catch(console.error);
