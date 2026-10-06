import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  InMemoryStorage,
  OpenAiProvider,
  OpenRouterProvider,
  SinapsClient,
} from '../index.js';
import { parseSSE } from '../utils/stream.js';

describe('Edge Runtime Certification', () => {
  it('should initialize InMemoryStorage without background timers when autoSweep is false', async () => {
    const storage = new InMemoryStorage({ autoSweep: false });
    await storage.set('edge-key', { value: 123 }, 60);

    const result = await storage.get<{ value: number }>('edge-key');
    expect(result).toEqual({ value: 123 });

    const counter = await storage.increment('edge-counter');
    expect(counter).toBe(1);

    await storage.delete('edge-key');
    expect(await storage.get('edge-key')).toBeNull();
    storage.destroy();
  });

  it('should instantiate all providers without relying on Node-specific globals or modules', () => {
    const openai = new OpenAiProvider({ apiKey: 'mock-key' });
    const anthropic = new AnthropicProvider({ apiKey: 'mock-key' });
    const gemini = new GeminiProvider({ apiKey: 'mock-key' });
    const groq = new GroqProvider({ apiKey: 'mock-key' });
    const openrouter = new OpenRouterProvider({ apiKey: 'mock-key' });

    expect(openai.name).toBe('OpenAI');
    expect(anthropic.name).toBe('Anthropic');
    expect(gemini.name).toBe('Gemini');
    expect(groq.name).toBe('Groq');
    expect(openrouter.name).toBe('OpenRouter');
  });

  it('should parse Web Streams SSE correctly in edge runtime environment', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: ping\ndata: {"ok":true}\n\n'),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const mockResponse = new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const messages = [];
    for await (const msg of parseSSE(mockResponse)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe('ping');
    expect(messages[0].data).toBe('{"ok":true}');
  });

  it('should execute SinapsClient end-to-end in edge configuration', async () => {
    const edgeStorage = new InMemoryStorage({ autoSweep: false });
    const mockProvider = {
      id: 'edge-provider-1',
      name: 'EdgeMock',
      generateContent: vi.fn().mockResolvedValue({
        id: 'edge-123',
        model: 'edge-model',
        choices: [
          {
            message: { role: 'assistant' as const, content: 'Edge response' },
            finishReason: 'stop',
          },
        ],
      }),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
      storage: edgeStorage,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 5000 },
    });

    const response = await client.chat.completions.create({
      model: 'edge-model',
      messages: [{ role: 'user', content: 'Ping from Cloudflare Worker' }],
    });

    expect(response.choices[0].message.content).toBe('Edge response');
    expect(mockProvider.generateContent).toHaveBeenCalledTimes(1);
    edgeStorage.destroy();
  });
});
