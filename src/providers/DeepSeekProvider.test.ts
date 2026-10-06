import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';

describe('DeepSeekProvider', () => {
  const provider = new DeepSeekProvider({ apiKey: 'test-key' });

  describe('formatRequest', () => {
    it('should correctly format request with reasoning_content and standard fields', () => {
      const request: UnifiedApiRequest = {
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: 'You are an expert mathematician.' },
          { role: 'user', content: 'Prove 1+1=2' },
          {
            role: 'assistant',
            content: 'Here is the proof...',
            reasoning_content: 'Let us define the Peano axioms...',
          },
        ],
        temperature: 0.5,
        maxTokens: 1000,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: 'You are an expert mathematician.' },
          { role: 'user', content: 'Prove 1+1=2' },
          {
            role: 'assistant',
            content: 'Here is the proof...',
            reasoning_content: 'Let us define the Peano axioms...',
          },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      });
    });

    it('should format tools, toolChoice, and responseFormat correctly', () => {
      const request: UnifiedApiRequest = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Query user' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'query_user',
              description: 'Fetch user from DB',
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
    });

    it('should resolve model from modelMap or fallback to defaultModel', () => {
      const customProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        defaultModel: 'deepseek-chat',
        modelMap: {
          'gpt-4o': 'deepseek-chat',
        },
      });

      expect(customProvider.resolveModel('gpt-4o')).toBe('deepseek-chat');
      expect(customProvider.resolveModel('unknown-model')).toBe(
        'deepseek-chat',
      );
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse standard response including reasoning_content', () => {
      const deepseekResponse = {
        id: 'deepseek-msg-123',
        model: 'deepseek-reasoner',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Final proof answer.',
              reasoning_content: 'Step 1: Peano successor function...',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 50,
          total_tokens: 70,
        },
      };

      const result = provider.formatResponse(deepseekResponse);

      expect(result.id).toBe('deepseek-msg-123');
      expect(result.model).toBe('deepseek-reasoner');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Final proof answer.');
      expect(result.choices[0].message.reasoning_content).toBe(
        'Step 1: Peano successor function...',
      );
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 20,
        completionTokens: 50,
        totalTokens: 70,
      });
    });

    it('should handle response without usage metadata', () => {
      const response = {
        id: 'msg-456',
        model: 'deepseek-chat',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Simple reply.',
            },
            finish_reason: 'stop',
          },
        ],
      };

      const result = provider.formatResponse(response);
      expect(result.choices[0].message.content).toBe('Simple reply.');
      expect(result.usage).toBeUndefined();
    });
  });
});
