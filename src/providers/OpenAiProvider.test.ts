import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { OpenAiProvider } from './OpenAiProvider.js';

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
  });
});
