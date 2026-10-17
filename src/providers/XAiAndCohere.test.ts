/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { COHERE_MODELS, CohereProvider } from './CohereProvider.js';
import { XAI_MODELS, XAiProvider } from './XAiProvider.js';

describe('XAiProvider & CohereProvider', () => {
  describe('XAiProvider', () => {
    const xai = new XAiProvider({ apiKey: 'xai-test-key' });

    it('should resolve default model to grok-3-beta and map reasoningEffort', () => {
      const formatted = xai.formatRequest({
        model: 'default',
        messages: [{ role: 'user', content: 'Solve quantum gravity' }],
        thinkingBudget: 4096,
        stream: true,
      });

      expect(formatted.model).toBe(XAI_MODELS.GROK_3);
      expect(formatted.reasoning_effort).toBe('high');
      expect(formatted.stream_options).toEqual({ include_usage: true });
    });

    it('should parse xAI response with reasoning_content and cached tokens', () => {
      const res = xai.formatResponse({
        id: 'xai-123',
        model: 'grok-3-mini-beta',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '42',
              reasoning_content: 'Evaluating step by step...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 60 },
        },
      });

      expect(res.choices[0].message.content).toBe('42');
      expect(res.choices[0].message.reasoning_content).toBe(
        'Evaluating step by step...',
      );
      expect(res.usage?.cachedPromptTokens).toBe(60);
    });
  });

  describe('CohereProvider', () => {
    const cohere = new CohereProvider({ apiKey: 'cohere-test-key' });

    it('should format Cohere v2 chat request with JSON schema and tools', () => {
      const formatted = cohere.formatRequest({
        model: 'default',
        messages: [{ role: 'user', content: 'Extract profile' }],
        toolChoice: 'required',
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'profile',
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      });

      expect(formatted.model).toBe(COHERE_MODELS.COMMAND_A);
      expect(formatted.tool_choice).toBe('REQUIRED');
      expect(formatted.response_format).toEqual({
        type: 'json_object',
        json_schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      });
    });

    it('should parse Cohere v2 response with thinking blocks and tool calls', () => {
      const res = cohere.formatResponse(
        {
          id: 'coh-999',
          finish_reason: 'TOOL_CALL',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Checking weather tool...' },
              { type: 'text', text: 'Calling weather API.' },
            ],
            tool_calls: [
              {
                id: 'tc_1',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"Makassar"}',
                },
              },
            ],
          },
          usage: {
            tokens: { input_tokens: 40, output_tokens: 15 },
          },
        },
        'command-a-03-2025',
      );

      expect(res.choices[0].finishReason).toBe('tool_calls');
      expect(res.choices[0].message.reasoning_content).toBe(
        'Checking weather tool...',
      );
      expect(res.choices[0].message.content).toBe('Calling weather API.');
      expect(res.choices[0].message.tool_calls?.[0].function.name).toBe(
        'get_weather',
      );
      expect(res.usage?.totalTokens).toBe(55);
    });

    it('should generate embeddings via Cohere v2 /embed endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: { float: [[0.11, 0.22, 0.33]] },
          meta: { billed_units: { input_tokens: 4 } },
        }),
      });

      const emb = await cohere.generateEmbedding({
        model: COHERE_MODELS.EMBED_V4,
        input: 'Kopi Arabika Spesialti',
        dimensions: 256,
      });

      expect(emb.data).toHaveLength(1);
      expect(emb.data[0].embedding).toEqual([0.11, 0.22, 0.33]);
      expect(emb.usage?.promptTokens).toBe(4);
    });
  });
});
