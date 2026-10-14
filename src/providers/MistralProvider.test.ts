import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { MistralProvider } from './MistralProvider.js';

describe('MistralProvider', () => {
  const provider = new MistralProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request for Mistral', () => {
      const request: UnifiedApiRequest = {
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: 'You are Mistral.' },
          { role: 'user', content: 'Bonjour' },
        ],
        temperature: 0.5,
        maxTokens: 1000,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: 'You are Mistral.' },
          { role: 'user', content: 'Bonjour' },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      });
    });

    it('should format tools, toolChoice, and responseFormat correctly', () => {
      const request: UnifiedApiRequest = {
        model: 'codestral-latest',
        messages: [
          { role: 'user', content: 'Execute' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_m1',
                type: 'function',
                function: { name: 'run_test', arguments: '{"suite":"e2e"}' },
              },
            ],
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'run_test',
              description: 'Run test suite',
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
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the mistral response', () => {
      const mistralResponse = {
        id: 'cmpl-mistral-999',
        model: 'mistral-large-latest',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Bonjour! Je suis Mistral.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 8,
          total_tokens: 23,
        },
      };

      const result = provider.formatResponse(mistralResponse);

      expect(result.id).toBe('cmpl-mistral-999');
      expect(result.model).toBe('mistral-large-latest');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe(
        'Bonjour! Je suis Mistral.',
      );
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 15,
        completionTokens: 8,
        totalTokens: 23,
      });
    });

    it('should extract cachedPromptTokens from prompt_tokens_details', () => {
      const cachedResponse = {
        id: 'cmpl-mistral-cached',
        model: 'mistral-large-latest',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Cached response',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: {
            cached_tokens: 90,
          },
        },
      };

      const result = provider.formatResponse(cachedResponse);
      expect(result.usage?.cachedPromptTokens).toBe(90);
      expect(result.usage?.promptTokens).toBe(120);
    });
  });

  describe('generateContent & rate limits', () => {
    it('should make POST request and extract rate limit headers', async () => {
      const headers = new Headers();
      headers.set('x-ratelimit-remaining-requests', '45');
      headers.set('x-ratelimit-remaining-tokens', '89000');
      headers.set('retry-after', '5');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers,
        json: async () => ({
          id: 'cmpl-mistral-1',
          model: 'mistral-small-latest',
          choices: [
            {
              message: { role: 'assistant', content: 'Success' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const response = await provider.generateContent({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: 'Test' }],
      });

      expect('choices' in response).toBe(true);
      if ('choices' in response) {
        expect(response.choices[0].message.content).toBe('Success');
        expect(response.rateLimit?.remainingRequests).toBe(45);
        expect(response.rateLimit?.remainingTokens).toBe(89000);
        expect(response.rateLimit?.resetMs).toBe(5000);
      }
    });
  });

  describe('generateEmbedding', () => {
    it('should call /embeddings and format response', async () => {
      const mockValues = [0.05, -0.12, 0.98];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'mistral-embed',
          data: [
            {
              object: 'embedding',
              index: 0,
              embedding: mockValues,
            },
          ],
          usage: {
            prompt_tokens: 6,
            total_tokens: 6,
          },
        }),
      });

      const response = await provider.generateEmbedding({
        model: 'mistral-embed',
        input: 'Embed this sentence',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mistral.ai/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
          body: JSON.stringify({
            model: 'mistral-embed',
            input: 'Embed this sentence',
          }),
        }),
      );

      expect(response.object).toBe('list');
      expect(response.model).toBe('mistral-embed');
      expect(response.data[0].embedding).toEqual(mockValues);
      expect(response.usage?.promptTokens).toBe(6);
    });
  });
});
