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

    it('should resolve model using modelMap or defaultModel', () => {
      const mappedProvider = new AnthropicProvider({
        apiKey: 'test-key',
        defaultModel: 'claude-3-5-sonnet-20241022',
        modelMap: {
          'gpt-4o': 'claude-3-5-sonnet-20241022',
          'gpt-4o-mini': 'claude-3-haiku-20240307',
        },
      });

      // Mapped model
      const req1 = mappedProvider.formatRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(req1.model).toBe('claude-3-5-sonnet-20241022');

      // Unmapped model fallback to defaultModel
      const req2 = mappedProvider.formatRequest({
        model: 'some-unknown-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(req2.model).toBe('claude-3-5-sonnet-20241022');
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

    it('should format tool definitions and tool results correctly', () => {
      const toolReq = provider.formatRequest({
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'user', content: 'What is the weather in Tokyo?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'tool_call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ city: 'Tokyo' }),
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'tool_call_1',
            content: 'Sunny, 22C',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for city',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
              },
            },
          },
        ],
        toolChoice: 'auto',
      });

      expect(toolReq.tools).toEqual([
        {
          name: 'get_weather',
          description: 'Get weather for city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ]);
      expect(toolReq.tool_choice).toEqual({ type: 'auto' });
      expect(toolReq.messages[1].role).toBe('assistant');
      expect(toolReq.messages[1].content).toEqual([
        {
          type: 'tool_use',
          id: 'tool_call_1',
          name: 'get_weather',
          input: { city: 'Tokyo' },
        },
      ]);
      expect(toolReq.messages[2].role).toBe('user');
      expect(toolReq.messages[2].content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'tool_call_1',
          content: 'Sunny, 22C',
        },
      ]);
    });

    it('should parse tool_use response into tool_calls with finishReason tool_calls', () => {
      const anthropicToolResponse = {
        id: 'msg_tool_1',
        model: 'claude-3-opus-20240229',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'call_abc',
            name: 'get_weather',
            input: { city: 'Kyoto' },
          },
        ],
      };

      const result = provider.formatResponse(anthropicToolResponse);
      expect(result.choices[0].finishReason).toBe('tool_calls');
      expect(result.choices[0].message.tool_calls).toEqual([
        {
          id: 'call_abc',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ city: 'Kyoto' }),
          },
        },
      ]);
    });
  });
});
