/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  GroqProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 12: Groq LPU Ultra-Fast Inference & Reasoning Integration
 *
 * Implements Groq Cloud API specifications (https://console.groq.com/docs/overview):
 * - Sub-second inference (~500+ tokens/sec) on LPUs
 * - Production models (llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b)
 * - Reasoning extraction (message.reasoning / reasoning_content)
 * - Structured outputs & JSON schema validation
 * - Automatic rate limit duration header parsing (x-ratelimit-reset-tokens: 7.66s)
 * - Sanitization of unsupported OpenAI parameters (messages[].name) & temperature clamping
 */
async function run() {
  const groqApiKey = process.env.GROQ_API_KEY || 'test-groq-key';

  console.log('--- 1. Initializing Groq Provider with SinapsAI Gateway ---');
  const groqProvider = new GroqProvider({
    apiKey: groqApiKey,
    defaultModel: 'llama-3.3-70b-versatile',
    modelMap: {
      'fast-chat': 'llama-3.1-8b-instant',
      'deep-reasoning': 'openai/gpt-oss-120b',
      'fast-reasoning': 'openai/gpt-oss-20b',
    },
  });

  const client = new SinapsClient({
    strategy: 'failover',
    providers: [
      groqProvider,
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'backup-openai-key',
        defaultModel: 'gpt-4o-mini',
      }),
    ],
    hooks: {
      onSuccess: (provider, res, latencyMs) => {
        console.log(
          `[Gateway] Response from ${provider.name} in ${latencyMs}ms (Tokens: ${res.usage?.totalTokens ?? 'N/A'})`,
        );
        if (res.rateLimit) {
          console.log(
            `[RateLimit] Remaining tokens: ${res.rateLimit.remainingTokens}, Reset in: ${res.rateLimit.resetMs}ms`,
          );
        }
      },
      onRateLimitWarning: (provider, info) => {
        console.warn(
          `[Warning] ${provider.name} approaching rate limit. Reset in ${info.resetMs}ms`,
        );
      },
      onFallback: (err, from, to) => {
        console.warn(`[Failover] ${from.name} failed (${err.message}). Switched to ${to.name}.`);
      },
    },
  });

  console.log('\n--- 2. Ultra-Fast Text Generation (Llama 3.3 70B) ---');
  try {
    const res = await client.chat.completions.create({
      model: 'fast-chat', // maps to llama-3.1-8b-instant
      messages: [
        { role: 'system', content: 'You are a concise AI assistant.' },
        { role: 'user', content: 'Explain what makes LPUs faster than GPUs in 2 sentences.' },
      ],
      temperature: 0.7,
      maxTokens: 100,
    });
    console.log('Assistant:', res.choices[0].message.content);
  } catch (err) {
    console.warn('Skipped execution (dummy API key):', (err as Error).message);
  }

  console.log('\n--- 3. Reasoning with Thought Process Extraction ---');
  try {
    const reasoningRes = await client.chat.completions.create({
      model: 'fast-reasoning', // maps to openai/gpt-oss-20b
      messages: [
        { role: 'user', content: 'How many letters "r" are in strawberry?' },
      ],
      thinkingBudget: 1024, // triggers reasoning_format: parsed
      maxTokens: 300,
    });

    if (reasoningRes.choices[0].message.reasoning_content) {
      console.log('Reasoning Chain:', reasoningRes.choices[0].message.reasoning_content);
    }
    console.log('Final Answer:', reasoningRes.choices[0].message.content);
  } catch (err) {
    console.warn('Skipped execution (dummy API key):', (err as Error).message);
  }

  console.log('\n--- 4. Structured Output with JSON Schema ---');
  try {
    const structuredRes = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: 'Extract entities: "Groq was founded by Jonathan Ross in Mountain View."' },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'company_entities',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              founder: { type: 'string' },
              location: { type: 'string' },
            },
            required: ['company', 'founder', 'location'],
          },
        },
      },
    });
    console.log('Structured JSON:', structuredRes.choices[0].message.content);
  } catch (err) {
    console.warn('Skipped execution (dummy API key):', (err as Error).message);
  }

  console.log('\nDemo completed successfully.');
}

run().catch(console.error);
