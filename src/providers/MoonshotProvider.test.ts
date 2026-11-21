/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  UnifiedApiRequest,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { MOONSHOT_MODELS, MoonshotProvider } from './MoonshotProvider.js';

describe('MoonshotProvider (Kimi K2)', () => {
  const provider = new MoonshotProvider({ apiKey: 'test-moonshot-key' });

  it('formats requests with developer role normalization and $web_search injection', () => {
    const request: UnifiedApiRequest = {
      model: MOONSHOT_MODELS.KIMI_K2_THINKING,
      messages: [
        { role: 'developer', content: 'Be concise.' },
        { role: 'user', content: 'Latest benchmark scores?' },
      ],
      webSearch: true,
      maxTokens: 2048,
    };

    const payload = provider.formatRequest(request);
    expect(payload.model).toBe('kimi-k2-thinking');
    expect(payload.messages[0].role).toBe('system');
    expect(payload.max_tokens).toBe(2048);
    expect(payload.tools).toEqual([
      { type: 'builtin_function', function: { name: '$web_search' } },
    ]);
  });

  it('parses response with reasoning_content and cached_tokens', () => {
    const res = provider.formatResponse({
      id: 'chatcmpl-kimi-1',
      model: 'kimi-k2-thinking',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Final answer.',
            reasoning_content: 'Step-by-step thinking...',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 60,
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    });

    expect(res.choices[0].message.reasoning_content).toBe(
      'Step-by-step thinking...',
    );
    expect(res.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedPromptTokens: 60,
      reasoningTokens: 30,
    });
  });

  it('executes non-streaming chat completion against api.moonshot.ai', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'x-ratelimit-remaining-requests': '42' }),
      json: async () => ({
        id: 'kimi-resp-1',
        model: 'kimi-k2-0905-preview',
        choices: [
          {
            message: { role: 'assistant', content: 'Hello from Kimi K2!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      }),
    });

    try {
      const res = await provider.generateContent({
        model: MOONSHOT_MODELS.KIMI_K2_0905_PREVIEW,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect('choices' in res).toBe(true);
      if ('choices' in res) {
        expect(res.choices[0].message.content).toBe('Hello from Kimi K2!');
        expect(res.rateLimit?.remainingRequests).toBe(42);
      }
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.moonshot.ai/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('streams SSE chunks with reasoning_content deltas', async () => {
    const sse = [
      'data: {"id":"kimi-s1","model":"kimi-k2-thinking","choices":[{"delta":{"role":"assistant","reasoning_content":"Analyzing..."},"finish_reason":null}]}\n\n',
      'data: {"id":"kimi-s1","model":"kimi-k2-thinking","choices":[{"delta":{"content":"Done!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
      'data: [DONE]\n\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of sse) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    });

    try {
      const result = await provider.generateContent({
        model: MOONSHOT_MODELS.KIMI_K2_THINKING,
        messages: [{ role: 'user', content: 'Think' }],
        stream: true,
      });

      const chunks: UnifiedApiStreamChunk[] = [];
      if (Symbol.asyncIterator in result) {
        for await (const c of result) chunks.push(c);
      }
      expect(chunks[0].choices[0].delta.reasoning_content).toBe('Analyzing...');
      expect(chunks[1].choices[0].delta.content).toBe('Done!');
      expect(chunks[1].usage?.totalTokens).toBe(30);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
