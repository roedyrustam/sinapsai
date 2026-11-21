/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  CreateEmbeddingRequest,
  UnifiedApiRequest,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { QWEN_MODELS, QwenProvider } from './QwenProvider.js';

describe('QwenProvider', () => {
  const provider = new QwenProvider({ apiKey: 'test-qwen-key' });

  describe('formatRequest', () => {
    it('should correctly format request with reasoning_content and standard fields', () => {
      const request: UnifiedApiRequest = {
        model: QWEN_MODELS.QWQ_PLUS,
        messages: [
          { role: 'system', content: 'You are an expert mathematician.' },
          { role: 'user', content: 'Prove 1+1=2' },
          {
            role: 'assistant',
            content: 'Here is the proof...',
            reasoning_content: 'Let us define the Peano axioms...',
          },
        ],
        temperature: 0.6,
        maxTokens: 2048,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'qwq-plus',
        messages: [
          { role: 'system', content: 'You are an expert mathematician.' },
          { role: 'user', content: 'Prove 1+1=2' },
          {
            role: 'assistant',
            content: 'Here is the proof...',
            reasoning_content: 'Let us define the Peano axioms...',
          },
        ],
        temperature: 0.6,
        max_tokens: 2048,
      });
    });

    it('should format multimodal messages with image_url correctly', () => {
      const request: UnifiedApiRequest = {
        model: QWEN_MODELS.QWEN_VL_MAX,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this chart:' },
              {
                type: 'image_url',
                image_url: {
                  url: 'https://example.com/chart.png',
                  detail: 'high',
                },
              },
            ],
          },
        ],
      };

      const result = provider.formatRequest(request);

      expect(result.model).toBe('qwen-vl-max');
      expect(result.messages[0].content).toEqual([
        { type: 'text', text: 'Analyze this chart:' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/chart.png', detail: 'high' },
        },
      ]);
    });

    it('should format tools, toolChoice, and responseFormat correctly', () => {
      const request: UnifiedApiRequest = {
        model: QWEN_MODELS.QWEN_3_MAX,
        messages: [{ role: 'user', content: 'Execute query' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'query_db',
              description: 'Run SQL query',
              parameters: { type: 'object' },
            },
          },
        ],
        toolChoice: 'auto',
        responseFormat: { type: 'json_object' },
      };

      const result = provider.formatRequest(request);

      expect(result.tools).toHaveLength(1);
      expect(result.tool_choice).toBe('auto');
      expect(result.response_format).toEqual({ type: 'json_object' });
    });

    it('should resolve model from modelMap or fallback to defaultModel', () => {
      const customProvider = new QwenProvider({
        apiKey: 'test-key',
        defaultModel: QWEN_MODELS.QWEN_3_MAX,
        modelMap: {
          'gpt-4o': QWEN_MODELS.QWEN_3_MAX,
        },
      });

      expect(customProvider.resolveModel('gpt-4o')).toBe('qwen3-max');
      expect(customProvider.resolveModel('unknown-model')).toBe('qwen3-max');
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse response with reasoning_content and usage details', () => {
      const qwenResponse = {
        id: 'qwen-msg-123',
        model: 'qwq-plus',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let us compute step by step...',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'calc', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 60,
          total_tokens: 90,
          prompt_cache_hit_tokens: 15,
          completion_tokens_details: {
            reasoning_tokens: 45,
          },
        },
      };

      const result = provider.formatResponse(qwenResponse);

      expect(result.id).toBe('qwen-msg-123');
      expect(result.model).toBe('qwq-plus');
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('The answer is 42.');
      expect(result.choices[0].message.reasoning_content).toBe(
        'Let us compute step by step...',
      );
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 30,
        completionTokens: 60,
        totalTokens: 90,
        cachedPromptTokens: 15,
        reasoningTokens: 45,
      });
    });
  });

  describe('generateContent', () => {
    it('should execute non-streaming request successfully', async () => {
      const mockResponse = {
        id: 'chatcmpl-qwen-abc',
        model: 'qwen3-max',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from Qwen 3 Max!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 12,
          total_tokens: 22,
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
        headers: new Headers({
          'x-ratelimit-remaining-requests': '99',
        }),
      });

      try {
        const response = await provider.generateContent({
          model: 'qwen3-max',
          messages: [{ role: 'user', content: 'Hi' }],
        });

        expect('choices' in response).toBe(true);
        if ('choices' in response) {
          expect(response.choices[0].message.content).toBe(
            'Hello from Qwen 3 Max!',
          );
          expect(response.rateLimit?.remainingRequests).toBe(99);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should use custom baseUrl and handle API errors', async () => {
      const chinaProvider = new QwenProvider({
        apiKey: 'china-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid API-key provided',
      });

      try {
        await expect(
          chinaProvider.generateContent({
            model: 'qwen-plus',
            messages: [{ role: 'user', content: 'Test error' }],
          }),
        ).rejects.toThrow('Qwen API Error (401): Invalid API-key provided');

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: 'Bearer china-key',
            }),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should stream chunks via parseSSE correctly', async () => {
      const sseChunks = [
        'data: {"id":"qwen-stream-1","model":"qwq-plus","choices":[{"delta":{"role":"assistant","reasoning_content":"Thinking..."},"finish_reason":null}]}\n\n',
        'data: {"id":"qwen-stream-1","model":"qwq-plus","choices":[{"delta":{"content":"Hello!"},"finish_reason":null}]}\n\n',
        'data: {"id":"qwen-stream-1","model":"qwq-plus","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"completion_tokens_details":{"reasoning_tokens":15}}}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
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
        const streamResult = await provider.generateContent({
          model: 'qwq-plus',
          messages: [{ role: 'user', content: 'Stream test' }],
          stream: true,
        });

        expect(Symbol.asyncIterator in streamResult).toBe(true);

        const chunks: UnifiedApiStreamChunk[] = [];
        if (Symbol.asyncIterator in streamResult) {
          for await (const chunk of streamResult) {
            chunks.push(chunk);
          }
        }

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks[0].choices[0].delta.reasoning_content).toBe(
          'Thinking...',
        );
        expect(chunks[1].choices[0].delta.content).toBe('Hello!');
        const lastChunk = chunks[chunks.length - 1];
        expect(lastChunk.usage?.reasoningTokens).toBe(15);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('generateEmbedding', () => {
    it('should execute generateEmbedding with proper endpoint and dimensions', async () => {
      const mockEmbeddingResponse = {
        object: 'list',
        model: 'text-embedding-v3',
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: [0.123, -0.456, 0.789],
          },
        ],
        usage: {
          prompt_tokens: 5,
          total_tokens: 5,
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockEmbeddingResponse,
      });

      try {
        const request: CreateEmbeddingRequest = {
          model: 'text-embedding-v3',
          input: 'Embed this text',
          dimensions: 1024,
        };

        const res = await provider.generateEmbedding(request);

        expect(res.object).toBe('list');
        expect(res.model).toBe('text-embedding-v3');
        expect(res.data[0].embedding).toEqual([0.123, -0.456, 0.789]);
        expect(res.usage.totalTokens).toBe(5);

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              model: 'text-embedding-v3',
              input: 'Embed this text',
              dimensions: 1024,
            }),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
