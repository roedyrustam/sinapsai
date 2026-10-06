import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { GroqProvider } from './GroqProvider.js';

describe('GroqProvider', () => {
  const provider = new GroqProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request', () => {
      const request: UnifiedApiRequest = {
        model: 'mixtral-8x7b-32768',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'mixtral-8x7b-32768',
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
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: 'Get stock' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'get_stock', arguments: '{"ticker":"NVDA"}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_stock',
            tool_call_id: 'call_2',
            content: '$130',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_stock',
              description: 'Get stock price',
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
      expect(result.messages[2].tool_call_id).toBe('call_2');
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the groq response', () => {
      const groqResponse = {
        id: 'chatcmpl-123',
        model: 'mixtral-8x7b-32768',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from Groq!',
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

      const result = provider.formatResponse(groqResponse);

      expect(result.id).toBe('chatcmpl-123');
      expect(result.model).toBe('mixtral-8x7b-32768');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from Groq!');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should handle response without usage metadata gracefully', () => {
      const groqResponse = {
        id: 'chatcmpl-456',
        model: 'mixtral-8x7b-32768',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Short answer.',
            },
          },
        ],
      };

      const result = provider.formatResponse(groqResponse);
      expect(result.choices[0].message.content).toBe('Short answer.');
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });
  });
});
