import {
  AnthropicProvider,
  GeminiProvider,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 01: Automatic Multi-Provider Failover with Circuit Breaker
 *
 * Simulates a scenario where OpenAI fails (e.g. invalid key or outage),
 * automatically falling back to Anthropic or Gemini without dropping the request!
 */
async function run() {
  const client = new SinapsClient({
    strategy: 'failover',
    providers: [
      // Primary: Intentional bad key to demonstrate instant transparent fallback
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'sk-invalid-test-key',
      }),
      // Fallback 1: Anthropic Claude
      new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key',
      }),
      // Fallback 2: Google Gemini
      new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY || 'gemini-test-key',
      }),
    ],
    circuitBreaker: {
      failureThreshold: 2, // Trip circuit after 2 consecutive failures
      resetTimeoutMs: 15000, // Re-test after 15 seconds
    },
    hooks: {
      onFallback: (error, from, to) => {
        console.log(
          `⚡ [Failover Triggered] ${from.name} failed (${error.message}). Routed to ${to.name}.`,
        );
      },
      onCircuitOpen: (provider) => {
        console.log(`🚨 [Circuit Breaker] Tripped OPEN for ${provider.name}.`);
      },
    },
  });

  console.log('Sending request through SinapsAI Control Plane...');

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: 'Why is in-process AI gateway better than a proxy?',
        },
      ],
    });

    if ('choices' in response) {
      console.log('\nResponse received:');
      console.log(response.choices[0]?.message.content);
    }
  } catch (error) {
    console.error('All providers exhausted:', (error as Error).message);
  }
}

run();
