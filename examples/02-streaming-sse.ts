import { OpenAiProvider, SinapsClient } from '../src/index.js';

/**
 * Example 02: Real-time Server-Sent Events (SSE) Streaming
 *
 * Demonstrates consuming token-by-token stream via async iterator.
 */
async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('Set OPENAI_API_KEY environment variable to run this demo live.');
    return;
  }

  const client = new SinapsClient({
    providers: [new OpenAiProvider({ apiKey })],
  });

  console.log('Streaming response from OpenAI...');

  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: 'Explain quantum computing in 3 bullet points.' },
    ],
    stream: true,
  });

  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content || '';
      process.stdout.write(delta);
    }
    console.log('\n\n[Stream Finished]');
  }
}

run();
