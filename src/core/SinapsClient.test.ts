/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

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

  it('should forward tools, toolChoice, and responseFormat to the router', async () => {
    const mockResponse: UnifiedApiResponse = {
      id: 'resp-tools',
      model: 'gpt-4o',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'get_user', arguments: '{"id":1}' },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
    };

    const mockProvider: Provider = {
      name: 'mock',
      id: 'mock-tools',
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    const tools = [
      {
        type: 'function' as const,
        function: { name: 'get_user', description: 'Get user info' },
      },
    ];

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Find user 1' }],
      tools,
      toolChoice: 'auto',
      responseFormat: { type: 'json_object' },
    });

    expect(response).toBe(mockResponse);
    expect(mockProvider.generateContent).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Find user 1' }],
      temperature: undefined,
      maxTokens: undefined,
      stream: undefined,
      signal: undefined,
      tools,
      toolChoice: 'auto',
      responseFormat: { type: 'json_object' },
    });
  });

  it('should expose getCircuitBreakerStatus, resetCircuitBreaker, and clearCache', async () => {
    const mockProvider: Provider = {
      name: 'mock-cb',
      id: 'mock-cb-1',
      generateContent: vi.fn().mockResolvedValue({
        id: '1',
        model: 'test',
        choices: [
          {
            message: { role: 'assistant', content: 'hi' },
            finishReason: 'stop',
          },
        ],
      }),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
      cache: { enabled: true },
    });

    const status = await client.getCircuitBreakerStatus();
    expect(status['mock-cb-1']).toBeDefined();
    expect(status['mock-cb-1'].state).toBe('CLOSED');

    await client.resetCircuitBreaker('mock-cb-1');
    const resetStatus = await client.getCircuitBreakerStatus();
    expect(resetStatus['mock-cb-1'].state).toBe('CLOSED');

    await expect(client.clearCache()).resolves.toBeUndefined();
  });

  it('should support stream accumulation via chat.completions.accumulateStream', async () => {
    const client = new SinapsClient({
      providers: [{ name: 'dummy', generateContent: vi.fn() }],
    });

    async function* testStream() {
      yield {
        id: 'acc-1',
        model: 'model-a',
        choices: [{ delta: { role: 'assistant' as const, content: 'Part 1' } }],
      };
      yield {
        id: 'acc-1',
        model: 'model-a',
        choices: [{ delta: { content: ' and Part 2' } }],
      };
    }

    const accumulated = await client.chat.completions.accumulateStream(testStream());
    expect(accumulated.choices[0].message.content).toBe('Part 1 and Part 2');
  });

  it('should support extractJson from response objects or strings', () => {
    const client = new SinapsClient({
      providers: [{ name: 'dummy', generateContent: vi.fn() }],
    });

    const parsed = client.extractJson<{ status: string }>('```json\n{"status": "ok"}\n```');
    expect(parsed.status).toBe('ok');

    const res: UnifiedApiResponse = {
      id: '1',
      model: 'm',
      choices: [{ message: { role: 'assistant', content: '{"count": 99}' }, finishReason: 'stop' }],
    };
    expect(client.extractJson<{ count: number }>(res).count).toBe(99);
  });

  it('should support reversible PII tokenization and restoration through client', async () => {
    const mockProvider: Provider = {
      name: 'mock',
      generateContent: vi.fn().mockImplementation(async (req) => {
        // Assert outgoing message received by provider was masked
        expect(req.messages[0].content).toContain('{{PII_EMAIL_1}}');
        expect(req.messages[0].content).not.toContain('secret@company.com');
        return {
          id: '1',
          model: 'test',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Confirmed, response sent to {{PII_EMAIL_1}}.',
              },
              finishReason: 'stop',
            },
          ],
        };
      }),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
      piiGuardrails: {
        categories: ['email'],
        reversible: true,
      },
    });

    const res = await client.chat.completions.create({
      messages: [{ role: 'user', content: 'Please email secret@company.com' }],
    });

    // The returned response should have the original email seamlessly restored!
    expect((res as UnifiedApiResponse).choices[0].message.content).toBe(
      'Confirmed, response sent to secret@company.com.',
    );
  });
});
