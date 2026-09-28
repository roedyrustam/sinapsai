import {
  type Provider,
  SinapsClient,
  type UnifiedApiRequest,
  type UnifiedApiResponse,
} from '../src/index.js';

/**
 * Example 04: Local Offline Provider (Ollama / vLLM / LM Studio)
 *
 * Demonstrates creating your own zero-dependency local provider in 20 lines.
 */
class LocalOllamaProvider implements Provider {
  id = 'ollama-local';
  name = 'Ollama';

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse> {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'llama3',
        messages: request.messages,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.statusText}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response mapping
    const data: any = await res.json();
    return {
      id: `ollama-${Date.now()}`,
      model: request.model,
      choices: [
        {
          message: { role: 'assistant', content: data.message?.content || '' },
          finishReason: 'stop',
        },
      ],
    };
  }
}

async function run() {
  const client = new SinapsClient({
    providers: [new LocalOllamaProvider()],
  });

  console.log('Sending request to local offline Ollama instance...');
  try {
    const res = await client.chat.completions.create({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Hello local AI!' }],
    });
    if ('choices' in res) {
      console.log(res.choices[0]?.message.content);
    }
  } catch (_e) {
    console.log(
      'Make sure Ollama is running locally on port 11434 (`ollama serve`)',
    );
  }
}

run();
