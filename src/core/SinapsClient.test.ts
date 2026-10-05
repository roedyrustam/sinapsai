import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiResponse } from '../types/index.js';
import { SinapsClient } from './SinapsClient.js';

describe('SinapsClient', () => {
  it('should initialize and proxy chat.completions.create to the router', async () => {
    const mockResponse: UnifiedApiResponse = {
      id: '1',
      model: 'test',
      choices: [
        { message: { role: 'assistant', content: 'hi' }, finishReason: 'stop' },
      ],
    };

    const mockProvider: Provider = {
      name: 'mock',
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
      strategy: 'failover',
    });

    const request = {
      messages: [{ role: 'user', content: 'hello' } as const],
      temperature: 0.7,
    };

    const response = await client.chat.completions.create(request);

    expect(response).toBe(mockResponse);
    expect(mockProvider.generateContent).toHaveBeenCalledWith({
      model: 'default', // fallback when model is omitted
      messages: request.messages,
      temperature: 0.7,
      maxTokens: undefined,
      stream: undefined,
      signal: undefined,
    });
  });

  it('should forward stream: true and signal to the router', async () => {
    async function* mockStream() {
      yield {
        id: 'chunk-1',
        model: 'test',
        choices: [
          {
            delta: { role: 'assistant' as const, content: 'streaming' },
            finishReason: null,
          },
        ],
      };
    }

    const mockProvider: Provider = {
      name: 'mock',
      id: 'mock-1',
      generateContent: vi.fn().mockResolvedValue(mockStream()),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    const controller = new AbortController();
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello stream' }],
      stream: true,
      signal: controller.signal,
    });

    expect(mockProvider.generateContent).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello stream' }],
      temperature: undefined,
      maxTokens: undefined,
      stream: true,
      signal: controller.signal,
    });

    expect(Symbol.asyncIterator in stream).toBe(true);
  });
});
