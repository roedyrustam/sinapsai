/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import {
  createOpenRouterFreeProvider,
  isOpenRouterFreeModel,
  OPENROUTER_FREE_MODELS,
  OpenRouterProvider,
} from './OpenRouterProvider.js';

describe('OpenRouterProvider', () => {
  const provider = new OpenRouterProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request', () => {
      const request: UnifiedApiRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'anthropic/claude-3.5-sonnet',
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
        model: 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'user', content: 'Calculate math' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_3',
                type: 'function',
                function: { name: 'calculate', arguments: '{"expr":"2+2"}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'calculate',
            tool_call_id: 'call_3',
            content: '4',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'calculate',
              description: 'Evaluate math expr',
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
      expect(result.messages[2].tool_call_id).toBe('call_3');
    });

    it('should include native models fallback array when fallbackModels is specified', () => {
      const freeProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        fallbackModels: [
          'openrouter/free',
          'google/gemma-4-31b-it:free',
          'nvidia/nemotron-3.5-lightning:free',
        ],
      });

      const request: UnifiedApiRequest = {
        model: 'openrouter/free',
        messages: [{ role: 'user', content: 'Hello' }],
        fallbackModels: [
          'google/gemma-4-31b-it:free',
          'nvidia/nemotron-3.5-lightning:free',
        ],
      };

      const result = freeProvider.formatRequest(request);
      expect(result.models).toEqual([
        'openrouter/free',
        'google/gemma-4-31b-it:free',
        'nvidia/nemotron-3.5-lightning:free',
      ]);
    });
  });

  describe('Free Tier & Cost Optimization', () => {
    it('should correctly identify free models', () => {
      expect(isOpenRouterFreeModel('openrouter/free')).toBe(true);
      expect(isOpenRouterFreeModel('google/gemma-4-31b-it:free')).toBe(true);
      expect(isOpenRouterFreeModel('nvidia/nemotron-3.5-lightning:free')).toBe(
        true,
      );
      expect(isOpenRouterFreeModel('anthropic/claude-3.5-sonnet')).toBe(false);
      expect(isOpenRouterFreeModel('openai/gpt-4o')).toBe(false);
      expect(OPENROUTER_FREE_MODELS).toContain('openrouter/free');
    });

    it('should default token costs to 0 for free models', () => {
      const freeModelProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        defaultModel: 'google/gemma-4-31b-it:free',
      });

      expect(freeModelProvider.costPer1kTokens).toBe(0);
      expect(freeModelProvider.promptCostPer1k).toBe(0);
      expect(freeModelProvider.completionCostPer1k).toBe(0);
    });

    it('should default costs to 0 and name to OpenRouter (Free) when isFreeTier is true', () => {
      const freeTierProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        isFreeTier: true,
      });

      expect(freeTierProvider.name).toBe('OpenRouter (Free)');
      expect(freeTierProvider.costPer1kTokens).toBe(0);
      expect(freeTierProvider.promptCostPer1k).toBe(0);
      expect(freeTierProvider.completionCostPer1k).toBe(0);
      expect(freeTierProvider.resolveModel('default')).toBe('openrouter/free');
    });

    it('should preserve explicit custom costs if provided', () => {
      const customCostProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        isFreeTier: true,
        costPer1kTokens: 0.005,
      });

      expect(customCostProvider.costPer1kTokens).toBe(0.005);
    });

    it('should create pre-configured free provider using factory', () => {
      const provider = createOpenRouterFreeProvider({
        apiKey: 'free-key',
        siteUrl: 'https://myapp.com',
        siteName: 'My App',
      });

      expect(provider.name).toBe('OpenRouter (Free)');
      expect(provider.costPer1kTokens).toBe(0);
      expect(provider.resolveModel('anything')).toBe('openrouter/free');
    });
  });

  describe('Headers and Rankings', () => {
    it('should include HTTP-Referer and X-Title headers in requests', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'gen-test',
          model: 'openrouter/free',
          choices: [
            { message: { role: 'assistant', content: 'Free response' } },
          ],
        }),
        headers: new Headers(),
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock;

      try {
        const rankedProvider = new OpenRouterProvider({
          apiKey: 'test-api-key',
          siteUrl: 'https://github.com/roedyrustam/sinapsai',
          siteName: 'SinapsAI Gateway',
        });

        await rankedProvider.generateContent({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const callArgs = fetchMock.mock.calls[0];
        const headers = callArgs[1].headers;
        expect(headers['HTTP-Referer']).toBe(
          'https://github.com/roedyrustam/sinapsai',
        );
        expect(headers['X-Title']).toBe('SinapsAI Gateway');
        expect(headers.Authorization).toBe('Bearer test-api-key');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('fetchFreeModels', () => {
    it('should fetch and filter free models from OpenRouter API', async () => {
      const mockApiResponse = {
        data: [
          {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            pricing: { prompt: '0.000005', completion: '0.000015' },
          },
          {
            id: 'openrouter/free',
            name: 'Free Models Router',
            pricing: { prompt: '0', completion: '0' },
          },
          {
            id: 'google/gemma-4-31b-it:free',
            name: 'Google Gemma 4 31B (free)',
            pricing: { prompt: '0', completion: '0' },
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock;

      try {
        const freeModels = await OpenRouterProvider.fetchFreeModels();
        expect(freeModels).toHaveLength(2);
        expect(freeModels.map((m) => m.id)).toEqual([
          'openrouter/free',
          'google/gemma-4-31b-it:free',
        ]);
        expect(freeModels[0].isFree).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the openrouter response', () => {
      const openrouterResponse = {
        id: 'gen-123',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from OpenRouter!',
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

      const result = provider.formatResponse(openrouterResponse);

      expect(result.id).toBe('gen-123');
      expect(result.model).toBe('anthropic/claude-3.5-sonnet');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from OpenRouter!');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should extract reasoning_content and cachedPromptTokens from prompt_tokens_details or cache_discount', () => {
      const openrouterReasoningResponse = {
        id: 'gen-r1',
        model: 'deepseek/deepseek-r1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Final synthesized response',
              reasoning: 'Detailed Chain-of-Thought thinking...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 150,
          total_tokens: 650,
          prompt_tokens_details: {
            cached_tokens: 300,
          },
        },
      };

      const result = provider.formatResponse(openrouterReasoningResponse);
      expect(result.choices[0].message.content).toBe(
        'Final synthesized response',
      );
      expect(result.choices[0].message.reasoning_content).toBe(
        'Detailed Chain-of-Thought thinking...',
      );
      expect(result.usage?.cachedPromptTokens).toBe(300);

      // Also test with cache_discount
      const discountResponse = {
        id: 'gen-disc',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Discount reply',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          total_tokens: 1100,
          cache_discount: 0.5,
        },
      };
      const discResult = provider.formatResponse(discountResponse);
      expect(discResult.usage?.cachedPromptTokens).toBe(500);
    });

    it('should handle response without usage metadata gracefully', () => {
      const openrouterResponse = {
        id: 'gen-456',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Short answer.',
            },
          },
        ],
      };

      const result = provider.formatResponse(openrouterResponse);
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });
  });
});
