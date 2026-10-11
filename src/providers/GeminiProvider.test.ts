import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { GeminiProvider } from './GeminiProvider.js';

describe('GeminiProvider', () => {
  const provider = new GeminiProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request without system instruction', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });
    });

    it('should correctly format request with system instruction and parameters', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'system', content: 'You are an AI assistant.' },
          { role: 'user', content: 'Who are you?' },
          { role: 'assistant', content: 'I am an AI.' },
          { role: 'user', content: 'Nice.' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        systemInstruction: {
          parts: [{ text: 'You are an AI assistant.' }],
        },
        contents: [
          { role: 'user', parts: [{ text: 'Who are you?' }] },
          { role: 'model', parts: [{ text: 'I am an AI.' }] },
          { role: 'user', parts: [{ text: 'Nice.' }] },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      });
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the gemini response', () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello from Gemini!' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = provider.formatResponse(
        geminiResponse,
        'gemini-1.5-flash',
      );

      expect(result.model).toBe('gemini-1.5-flash');
      expect(result.id).toMatch(/^gemini-\d+$/);
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from Gemini!');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should handle response without usage metadata gracefully', () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Short answer.' }],
              role: 'model',
            },
          },
        ],
      };

      const result = provider.formatResponse(
        geminiResponse,
        'gemini-1.5-flash',
      );
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });

    it('should map finish reasons correctly', () => {
      const getResult = (reason: string) =>
        provider.formatResponse(
          { candidates: [{ finishReason: reason }] },
          'gemini-1.5-flash',
        ).choices[0].finishReason;

      expect(getResult('STOP')).toBe('stop');
      expect(getResult('MAX_TOKENS')).toBe('length');
      expect(getResult('SAFETY')).toBe('content_filter');
      expect(getResult('RECITATION')).toBe('content_filter');
      expect(getResult('OTHER')).toBe('other');
    });
  });

  describe('edge cases in formatRequest', () => {
    it('should combine multiple system messages', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'system', content: 'You are an AI.' },
          { role: 'system', content: 'Be concise.' },
        ],
      };

      const result = provider.formatRequest(request);
      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'You are an AI.' }, { text: 'Be concise.' }],
      });
      expect(result.contents).toEqual([]);
    });

    it('should combine adjacent messages of the same role', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'user', content: 'World' },
          { role: 'assistant', content: 'Hi' },
          { role: 'assistant', content: 'There' },
          { role: 'user', content: 'Again' },
        ],
      };

      const result = provider.formatRequest(request);
      expect(result.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }, { text: 'World' }] },
        { role: 'model', parts: [{ text: 'Hi' }, { text: 'There' }] },
        { role: 'user', parts: [{ text: 'Again' }] },
      ]);
    });

    it('should format tools and responseFormat correctly', () => {
      const result = provider.formatRequest({
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'user', content: 'What is the price of BTC?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: 'get_price',
                  arguments: JSON.stringify({ symbol: 'BTC' }),
                },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_price',
            content: '$68000',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_price',
              description: 'Get price of crypto',
              parameters: {
                type: 'object',
                properties: { symbol: { type: 'string' } },
              },
            },
          },
        ],
        responseFormat: { type: 'json_object' },
      });

      expect(result.generationConfig.responseMimeType).toBe('application/json');
      expect(result.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: 'get_price',
              description: 'Get price of crypto',
              parameters: {
                type: 'object',
                properties: { symbol: { type: 'string' } },
              },
            },
          ],
        },
      ]);
      expect(result.contents[1].role).toBe('model');
      expect(result.contents[1].parts[0]).toEqual({
        functionCall: {
          name: 'get_price',
          args: { symbol: 'BTC' },
        },
      });
      expect(result.contents[2].role).toBe('user');
      expect(result.contents[2].parts[0]).toEqual({
        functionResponse: {
          name: 'get_price',
          response: { content: '$68000' },
        },
      });
    });

    it('should parse functionCall response into tool_calls', () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_price',
                    args: { symbol: 'ETH' },
                  },
                },
              ],
            },
          },
        ],
      };

      const result = provider.formatResponse(
        geminiResponse,
        'gemini-1.5-flash',
      );
      expect(result.choices[0].finishReason).toBe('tool_calls');
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls?.[0].function).toEqual({
        name: 'get_price',
        arguments: JSON.stringify({ symbol: 'ETH' }),
      });
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings for single string input', async () => {
      const mockValues = [0.12, 0.34, -0.56];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockValues },
          usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 },
        }),
      });

      const response = await provider.generateEmbedding({
        model: 'text-embedding-004',
        input: 'Hello semantic search',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/models/text-embedding-004:embedContent?key=test-key',
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            content: { parts: [{ text: 'Hello semantic search' }] },
          }),
        }),
      );

      expect(response.object).toBe('list');
      expect(response.model).toBe('text-embedding-004');
      expect(response.data).toHaveLength(1);
      expect(response.data[0].embedding).toEqual(mockValues);
      expect(response.usage?.promptTokens).toBe(5);
    });

    it('should generate embeddings for batch input array', async () => {
      const mockBatch = [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: mockBatch,
          usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 },
        }),
      });

      const response = await provider.generateEmbedding({
        model: 'text-embedding-004',
        input: ['Hello', 'World'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/models/text-embedding-004:batchEmbedContents?key=test-key',
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            requests: [
              {
                model: 'models/text-embedding-004',
                content: { parts: [{ text: 'Hello' }] },
              },
              {
                model: 'models/text-embedding-004',
                content: { parts: [{ text: 'World' }] },
              },
            ],
          }),
        }),
      );

      expect(response.data).toHaveLength(2);
      expect(response.data[0].embedding).toEqual([0.1, 0.2]);
      expect(response.data[1].embedding).toEqual([0.3, 0.4]);
    });
  });
});
