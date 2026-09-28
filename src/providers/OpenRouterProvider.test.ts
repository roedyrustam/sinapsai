import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';

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
