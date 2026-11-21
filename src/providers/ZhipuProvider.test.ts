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
import { ZHIPU_MODELS, ZhipuProvider } from './ZhipuProvider.js';

describe('ZhipuProvider (GLM-4.5)', () => {
  const provider = new ZhipuProvider({ apiKey: 'test-zhipu-key' });

  it('formats hybrid thinking, web_search tool, and developer role', () => {
    const request: UnifiedApiRequest = {
      model: ZHIPU_MODELS.GLM_4_5,
      messages: [
        { role: 'developer', content: 'Respond in JSON.' },
        { role: 'user', content: 'Audit this contract.' },
      ],
      thinkingBudget: 'auto',
      webSearch: true,
    };

    const payload = provider.formatRequest(request);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.thinking).toEqual({ type: 'enabled' });
    expect(payload.tools).toEqual([
      { type: 'web_search', web_search: { enable: true } },
    ]);

    const disabled = provider.formatRequest({
      model: ZHIPU_MODELS.GLM_4_5_FLASH,
      messages: [{ role: 'user', content: 'Hi' }],
      reasoningEffort: 'none',
    });
    expect(disabled.thinking).toEqual({ type: 'disabled' });
  });

  it('executes chat completion and extracts reasoning_content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        id: 'glm-1',
        model: 'glm-4.5',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Approved.',
              reasoning_content: 'Checking clauses...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 40,
          total_tokens: 60,
          prompt_tokens_details: { cached_tokens: 10 },
        },
      }),
    });

    try {
      const res = await provider.generateContent({
        model: ZHIPU_MODELS.GLM_4_5,
        messages: [{ role: 'user', content: 'Check' }],
      });
      expect('choices' in res).toBe(true);
      if ('choices' in res) {
        expect(res.choices[0].message.reasoning_content).toBe(
          'Checking clauses...',
        );
        expect(res.usage?.cachedPromptTokens).toBe(10);
      }
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.z.ai/api/paas/v4/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('streams SSE chunks with reasoning_content', async () => {
    const sse = [
      'data: {"id":"glm-s1","model":"glm-4.5","choices":[{"delta":{"role":"assistant","reasoning_content":"Thinking..."},"finish_reason":null}]}\n\n',
      'data: {"id":"glm-s1","model":"glm-4.5","choices":[{"delta":{"content":"Result"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":12,"total_tokens":20}}\n\n',
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
        model: ZHIPU_MODELS.GLM_4_5,
        messages: [{ role: 'user', content: 'Stream' }],
        stream: true,
      });

      const chunks: UnifiedApiStreamChunk[] = [];
      if (Symbol.asyncIterator in result) {
        for await (const c of result) chunks.push(c);
      }
      expect(chunks[0].choices[0].delta.reasoning_content).toBe('Thinking...');
      expect(chunks[1].choices[0].delta.content).toBe('Result');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('generates embeddings via embedding-3 with custom dimensions', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: 'list',
        model: 'embedding-3',
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }),
    });

    try {
      const res = await provider.generateEmbedding({
        model: ZHIPU_MODELS.EMBEDDING_3,
        input: 'Hello Zhipu',
        dimensions: 1024,
      });
      expect(res.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.z.ai/api/paas/v4/embeddings',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'embedding-3',
            input: 'Hello Zhipu',
            dimensions: 1024,
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
