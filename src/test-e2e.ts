import { AnthropicProvider } from './providers/AnthropicProvider.js';

async function run() {
  const p = new AnthropicProvider({ apiKey: 'invalid-key' });
  try {
    await p.generateContent({
      model: 'claude-3-haiku-20240307',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'user', content: 'world' },
      ],
    });
  } catch (err) {
    if (err instanceof Error) {
      console.error('Anthropic Error:', err.message);
    } else {
      console.error('Anthropic Error:', err);
    }
  }
}
run();
