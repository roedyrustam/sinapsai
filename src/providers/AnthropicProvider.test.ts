import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { AnthropicProvider } from './AnthropicProvider.js';

describe('AnthropicProvider', () => {
  const provider = new AnthropicProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request without maxTokens', () => {
      const request: UnifiedApiRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 4096, // default
      });
    });

    it('should correctly format request with system instruction and parameters', () => {
      const request: UnifiedApiRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          { role: 'system', content: 'You are an AI assistant.' },
          { role: 'user', content: 'Who are you?' },
          { role: 'assistant', content: 'I am Claude.' },
          { role: 'system', content: 'Keep it short.' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'claude-3-sonnet-20240229',
        system: 'You are an AI assistant.\nKeep it short.',
        messages: [
          { role: 'user', content: 'Who are you?' },
          { role: 'assistant', content: 'I am Claude.' },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
    });

    it('should combine adjacent messages of the same role', () => {
      const request: UnifiedApiRequest = {
        model: 'claude-3-haiku-20240307',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'user', content: 'World' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Again' },
        ],
      };

      const result = provider.formatRequest(request);
      expect(result.messages).toEqual([
        { role: 'user', content: 'Hello\n\nWorld' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Again' },
      ]);
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the anthropic response', () => {
      const anthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
        content: [
          {
            type: 'text',
            text: 'Hello from Claude!',
          },
        ],
      };

      const result = provider.formatResponse(anthropicResponse);

      expect(result.id).toBe('msg_123');
      expect(result.model).toBe('claude-3-opus-20240229');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from Claude!');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should map stop reasons correctly', () => {
      const getResult = (reason: string) =>
        provider.formatResponse({
          stop_reason: reason,
          content: [{ text: '' }],
        }).choices[0].finishReason;

      expect(getResult('end_turn')).toBe('stop');
      expect(getResult('max_tokens')).toBe('length');
      expect(getResult('stop_sequence')).toBe('stop');
      expect(getResult('other_reason')).toBe('other_reason');
    });

    it('should handle response without usage metadata gracefully', () => {
      const anthropicResponse = {
        id: 'msg_456',
        model: 'claude-3',
        content: [
          {
            type: 'text',
            text: 'Short answer.',
          },
        ],
      };

      const result = provider.formatResponse(anthropicResponse);
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });
  });
});
