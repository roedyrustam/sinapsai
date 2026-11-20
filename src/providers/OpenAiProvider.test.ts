/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { OPENAI_MODELS, OpenAiProvider } from './OpenAiProvider.js';

describe('OpenAiProvider', () => {
  const provider = new OpenAiProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request', () => {
      const request: UnifiedApiRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
    });

    it('should format tools, toolChoice, and responseFormat correctly', () => {
      const request: UnifiedApiRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Check weather' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"Jakarta"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_weather',
            tool_call_id: 'call_1',
            content: 'Sunny, 30C',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for city',
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
      expect(result.messages[1].tool_calls).toHaveLength(1);
      expect(result.messages[2].tool_call_id).toBe('call_1');
    });

    it('should format reasoningEffort and use max_completion_tokens without temperature for reasoning models', () => {
      const request: UnifiedApiRequest = {
        model: 'o3-mini',
        messages: [{ role: 'user', content: 'Prove Fermat theorem' }],
        reasoningEffort: 'high',
        temperature: 0.7, // should be omitted for o1/o3/o4
        maxTokens: 4000, // should map to max_completion_tokens
      };

      const result = provider.formatRequest(request);

      expect(result.reasoning_effort).toBe('high');
      expect(result.max_completion_tokens).toBe(4000);
      expect(result.max_tokens).toBeUndefined();
      expect(result.temperature).toBeUndefined();
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the openai response', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from OpenAI!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = provider.formatResponse(openaiResponse);

      expect(result.id).toBe('chatcmpl-123');
      expect(result.model).toBe('gpt-4o');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from OpenAI!');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should handle response without usage metadata gracefully', () => {
      const openaiResponse = {
        id: 'chatcmpl-456',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Short answer.',
            },
          },
        ],
      };

      const result = provider.formatResponse(openaiResponse);
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });

    it('should extract reasoning_content and record cachedPromptTokens from prompt_tokens_details', () => {
      const reasoningResponse = {
        id: 'chatcmpl-o3-789',
        model: 'o3-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Final theorem proof verified.',
              reasoning_content:
                'Step 1: Check lemma A. Step 2: Invert matrix...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 450,
          total_tokens: 2450,
          prompt_tokens_details: {
            cached_tokens: 1536,
          },
        },
      };

      const result = provider.formatResponse(reasoningResponse);
      expect(result.choices[0].message.content).toBe(
        'Final theorem proof verified.',
      );
      expect(result.choices[0].message.reasoning_content).toBe(
        'Step 1: Check lemma A. Step 2: Invert matrix...',
      );
      expect(result.usage?.cachedPromptTokens).toBe(1536);
      expect(result.usage?.promptTokens).toBe(2000);
    });
  });

  describe('generateEmbedding', () => {
    it('should call fetch and parse embedding payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            {
              object: 'embedding',
              index: 0,
              embedding: [0.1, 0.2, 0.3],
            },
          ],
          model: 'text-embedding-3-small',
          usage: {
            prompt_tokens: 4,
            total_tokens: 4,
          },
        }),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const response = await provider.generateEmbedding({
          model: 'text-embedding-3-small',
          input: 'Embed me',
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(response.object).toBe('list');
        expect(response.model).toBe('text-embedding-3-small');
        expect(response.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
        expect(response.usage?.promptTokens).toBe(4);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('passes optional dimensions parameter to OpenAI embeddings API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: [0.5, 0.6] }],
          model: 'text-embedding-3-large',
          usage: { prompt_tokens: 3, total_tokens: 3 },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        await provider.generateEmbedding({
          model: 'text-embedding-3-large',
          input: 'Short dim vector',
          dimensions: 512,
        });
        const body = JSON.parse(
          (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string,
        );
        expect(body.dimensions).toBe(512);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('GPT-5 / Frontier & Responses API (/v1/responses)', () => {
    it('uses max_completion_tokens, developer role, xhigh effort, and omits temperature on GPT-5 models', () => {
      const devProvider = new OpenAiProvider({
        apiKey: 'test-key',
        useDeveloperRole: true,
      });

      const payload = devProvider.formatRequest({
        model: OPENAI_MODELS.GPT_5_6_SOL,
        messages: [
          { role: 'system', content: 'Strict contracts only.' },
          { role: 'user', content: 'Audit lock protocol.' },
        ],
        maxTokens: 2048,
        temperature: 0.7,
        reasoningEffort: 'max',
        verbosity: 'high',
        serviceTier: 'priority',
      });

      expect(payload.messages[0]).toEqual({
        role: 'developer',
        content: 'Strict contracts only.',
      });
      expect(payload.max_completion_tokens).toBe(2048);
      expect(payload.max_tokens).toBeUndefined();
      expect(payload.temperature).toBeUndefined();
      expect(payload.reasoning_effort).toBe('xhigh');
      expect(payload.verbosity).toBe('high');
      expect(payload.service_tier).toBe('priority');
    });

    it('formats and executes OpenAI Responses API (/v1/responses) for non-streaming and SSE streaming', async () => {
      const respProvider = new OpenAiProvider({
        apiKey: 'sk-resp',
        apiMode: 'responses',
      });

      const reqPayload = respProvider.formatResponsesRequest({
        model: OPENAI_MODELS.GPT_5_6_SOL,
        messages: [
          { role: 'system', content: 'System guide' },
          { role: 'user', content: 'Summarize diff' },
        ],
        maxTokens: 1024,
        reasoningEffort: 'xhigh',
        webSearch: true,
        previousResponseId: 'resp_prev_1',
      });

      expect(reqPayload.instructions).toBe('System guide');
      expect(reqPayload.max_output_tokens).toBe(1024);
      expect(reqPayload.reasoning).toEqual({ effort: 'xhigh' });
      expect(reqPayload.previous_response_id).toBe('resp_prev_1');
      expect(reqPayload.tools).toContainEqual({ type: 'web_search_preview' });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: async () => ({
            id: 'resp_123',
            model: 'gpt-5.6-sol-medium',
            status: 'completed',
            output: [
              {
                type: 'reasoning',
                summary: [
                  { type: 'summary_text', text: 'Checking invariants.' },
                ],
              },
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Diff verified.' }],
              },
              {
                type: 'function_call',
                call_id: 'call_resp_1',
                name: 'get_diff',
                arguments: '{"id":1}',
              },
            ],
            usage: {
              input_tokens: 120,
              output_tokens: 80,
              total_tokens: 200,
              input_tokens_details: { cached_tokens: 60 },
              output_tokens_details: { reasoning_tokens: 45 },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          body: new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(
                enc.encode(
                  'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"Thinking... "}\n\n',
                ),
              );
              controller.enqueue(
                enc.encode(
                  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
                ),
              );
              controller.enqueue(
                enc.encode(
                  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_stream_1","model":"gpt-5.6-sol-medium","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15,"output_tokens_details":{"reasoning_tokens":3}}}}\n\n',
                ),
              );
              controller.close();
            },
          }),
        });

      try {
        const res = (await respProvider.generateContent({
          model: OPENAI_MODELS.GPT_5_6_SOL,
          messages: [{ role: 'user', content: 'Go' }],
        })) as import('../types/index.js').UnifiedApiResponse;

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
          1,
          'https://api.openai.com/v1/responses',
          expect.objectContaining({ method: 'POST' }),
        );
        expect(res.choices[0].message.content).toBe('Diff verified.');
        expect(res.choices[0].message.reasoning_content).toBe(
          'Checking invariants.',
        );
        expect(res.choices[0].message.tool_calls?.[0].function.name).toBe(
          'get_diff',
        );
        expect(res.usage?.reasoningTokens).toBe(45);
        expect(res.usage?.cachedPromptTokens).toBe(60);

        const stream = (await respProvider.generateContent({
          model: OPENAI_MODELS.GPT_5_6_SOL,
          messages: [{ role: 'user', content: 'Go stream' }],
          stream: true,
        })) as AsyncIterable<import('../types/index.js').UnifiedApiStreamChunk>;

        const chunks = [];
        for await (const c of stream) {
          chunks.push(c);
        }
        expect(
          chunks.some(
            (c) => c.choices[0]?.delta?.reasoning_content === 'Thinking... ',
          ),
        ).toBe(true);
        expect(
          chunks.some((c) => c.choices[0]?.delta?.content === 'Hello'),
        ).toBe(true);
        expect(chunks.find((c) => c.usage)?.usage?.reasoningTokens).toBe(3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
