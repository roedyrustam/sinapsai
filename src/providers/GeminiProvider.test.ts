import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { GEMINI_MODELS, GeminiProvider } from './GeminiProvider.js';

describe('GeminiProvider', () => {
  const provider = new GeminiProvider({ apiKey: 'test-key' });

  describe('resolveModel & GEMINI_MODELS', () => {
    it('should expose canonical GEMINI_MODELS constants', () => {
      expect(GEMINI_MODELS.FLASH_2_5).toBe('gemini-2.5-flash');
      expect(GEMINI_MODELS.FLASH_LITE_2_5).toBe('gemini-2.5-flash-lite');
      expect(GEMINI_MODELS.PRO_2_5).toBe('gemini-2.5-pro');
      expect(GEMINI_MODELS.FLASH_3_8).toBe('gemini-3.8-flash');
      expect(GEMINI_MODELS.FLASH_LATEST).toBe('gemini-flash-latest');
      expect(GEMINI_MODELS.EMBEDDING_001).toBe('gemini-embedding-001');
      expect(GEMINI_MODELS.EMBEDDING_2).toBe('gemini-embedding-2');
    });

    it('should default to gemini-2.5-flash when model is default or empty', () => {
      expect(provider.resolveModel('default')).toBe('gemini-2.5-flash');
      expect(provider.resolveModel('')).toBe('gemini-2.5-flash');
    });

    it('should respect custom defaultModel and modelMap', () => {
      const customProvider = new GeminiProvider({
        apiKey: 'test-key',
        defaultModel: 'gemini-2.5-pro',
        modelMap: { 'smart-model': 'gemini-3.8-flash' },
      });

      expect(customProvider.resolveModel('default')).toBe('gemini-2.5-pro');
      expect(customProvider.resolveModel('smart-model')).toBe(
        'gemini-3.8-flash',
      );
    });
  });

  describe('formatRequest', () => {
    it('should correctly format request without system instruction', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });
    });

    it('should correctly format request with system instruction and parameters', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-2.5-pro',
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

    it('should support thinkingConfig when thinkingBudget is provided', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Solve this riddle' }],
        thinkingBudget: 2048,
      };

      const result = provider.formatRequest(request);
      expect(result.generationConfig.thinkingConfig).toEqual({
        thinkingBudget: 2048,
      });
    });

    it('should support safetySettings configured in provider', () => {
      const safetyProvider = new GeminiProvider({
        apiKey: 'test-key',
        safetySettings: [
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_LOW_AND_ABOVE',
          },
        ],
      });

      const request: UnifiedApiRequest = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Safe check' }],
      };

      const result = safetyProvider.formatRequest(request);
      expect(result.safetySettings).toEqual([
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_LOW_AND_ABOVE',
        },
      ]);
    });

    it('should correctly format multimodal ContentPart[] (text, image, audio)', () => {
      const request: UnifiedApiRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe image and audio' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                },
              },
              {
                type: 'image_url',
                image_url: {
                  url: 'https://example.com/photo.jpg',
                },
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: 'UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==',
                  format: 'wav',
                },
              },
            ],
          },
        ],
      };

      const result = provider.formatRequest(request);

      expect(result.contents).toEqual([
        {
          role: 'user',
          parts: [
            { text: 'Describe image and audio' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              },
            },
            {
              fileData: {
                mimeType: 'image/jpeg',
                fileUri: 'https://example.com/photo.jpg',
              },
            },
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: 'UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==',
              },
            },
          ],
        },
      ]);
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
        'gemini-2.5-flash',
      );

      expect(result.model).toBe('gemini-2.5-flash');
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

    it('should extract reasoning thoughts into reasoning_content', () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Let me think step by step...',
                },
                {
                  text: '42 is the answer.',
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      };

      const result = provider.formatResponse(geminiResponse, 'gemini-2.5-pro');
      expect(result.choices[0].message.content).toBe('42 is the answer.');
      expect(result.choices[0].message.reasoning_content).toBe(
        'Let me think step by step...',
      );
    });

    it('should extract cachedPromptTokens from cachedContentTokenCount', () => {
      const geminiCachedResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Response with context cache' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 2048,
          candidatesTokenCount: 120,
          totalTokenCount: 2168,
          cachedContentTokenCount: 1800,
        },
      };

      const result = provider.formatResponse(
        geminiCachedResponse,
        'gemini-2.5-flash',
      );
      expect(result.usage?.cachedPromptTokens).toBe(1800);
      expect(result.usage?.promptTokens).toBe(2048);
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
        'gemini-2.5-flash',
      );
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });

    it('should handle tool calls correctly', () => {
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
              role: 'model',
            },
          },
        ],
      };

      const result = provider.formatResponse(
        geminiResponse,
        'gemini-2.5-flash',
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
    it('should generate embeddings for single string input and support outputDimensionality', async () => {
      const mockValues = [0.12, 0.34, -0.56];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embedding: { values: mockValues },
          usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 },
        }),
      });

      const response = await provider.generateEmbedding({
        model: 'gemini-embedding-001',
        input: 'Hello semantic search',
        dimensions: 512,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/models/gemini-embedding-001:embedContent?key=test-key',
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            content: { parts: [{ text: 'Hello semantic search' }] },
            outputDimensionality: 512,
          }),
        }),
      );

      expect(response.object).toBe('list');
      expect(response.model).toBe('gemini-embedding-001');
      expect(response.data).toHaveLength(1);
      expect(response.data[0].embedding).toEqual(mockValues);
      expect(response.usage?.promptTokens).toBe(5);
    });

    it('should generate embeddings for batch input array with outputDimensionality', async () => {
      const mockBatch = [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: mockBatch,
          usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 },
        }),
      });

      const response = await provider.generateEmbedding({
        model: 'gemini-embedding-2',
        input: ['Hello', 'World'],
        dimensions: 256,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/models/gemini-embedding-2:batchEmbedContents?key=test-key',
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            requests: [
              {
                model: 'models/gemini-embedding-2',
                content: { parts: [{ text: 'Hello' }] },
                outputDimensionality: 256,
              },
              {
                model: 'models/gemini-embedding-2',
                content: { parts: [{ text: 'World' }] },
                outputDimensionality: 256,
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

  describe('fetchAvailableModels', () => {
    it('should fetch and format Gemini models from Google AI API', async () => {
      const mockApiResponse = {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            description: 'Fast multimodal model',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Deep reasoning model',
            inputTokenLimit: 2097152,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      const models = await GeminiProvider.fetchAvailableModels({
        apiKey: 'test-key',
      });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gemini-2.5-flash');
      expect(models[0].displayName).toBe('Gemini 2.5 Flash');
      expect(models[0].inputTokenLimit).toBe(1048576);
      expect(models[1].id).toBe('gemini-2.5-pro');
      expect(models[1].inputTokenLimit).toBe(2097152);
    });
  });
});
