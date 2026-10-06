import {
  OllamaProvider,
  type Provider,
  SinapsClient,
  type UnifiedApiRequest,
  type UnifiedApiResponse,
} from '../src/index.js';

/**
 * Example 04: Local Offline Provider (Native OllamaProvider & Custom Local Providers)
 *
 * Demonstrates using the built-in OllamaProvider for local LLMs,
 * as well as implementing your own custom local provider (vLLM / LM Studio).
 */

// Approach A: Using native built-in OllamaProvider (Zero Setup, First-Class Support)
const nativeOllama = new OllamaProvider({
  baseUrl: 'http://localhost:11434',
  defaultModel: 'llama3.2',
});

// Approach B: Custom Local Provider in 20 lines (e.g. custom engine or local proxy)
class CustomVllmProvider implements Provider {
  id = 'vllm-local';
  name = 'vLLM';

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse> {
    const res = await fetch('http://localhost:8000/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'meta-llama/Llama-3-8B-Instruct',
        messages: request.messages,
      }),
    });

    if (!res.ok) {
      throw new Error(`vLLM request failed: ${res.statusText}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response mapping
    const data: any = await res.json();
    return {
      id: `vllm-${Date.now()}`,
      model: request.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: data.choices?.[0]?.message?.content || '',
          },
          finishReason: 'stop',
        },
      ],
    };
  }
}

async function run() {
  const client = new SinapsClient({
    // Seamlessly failover from native local Ollama to custom vLLM
    strategy: 'failover',
    providers: [nativeOllama, new CustomVllmProvider()],
  });

  console.log('Sending request to local offline Ollama instance...');
  try {
    const res = await client.chat.completions.create({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hello local AI!' }],
    });
    if ('choices' in res) {
      console.log('Result:', res.choices[0]?.message.content);
    }
  } catch (_e) {
    console.log(
      'Make sure Ollama is running locally on port 11434 (`ollama serve`)',
    );
  }
}

run();
