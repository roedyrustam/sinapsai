import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { OllamaProvider } from './OllamaProvider.js';

describe('OllamaProvider', () => {
  const provider = new OllamaProvider({
    baseUrl: 'http://localhost:11434',
  });

  describe('configuration & defaults', () => {
    it('should default costPer1kTokens to 0 for local models', () => {
      expect(provider.costPer1kTokens).toBe(0);
    });

    it('should respect custom costPer1kTokens if specified', () => {
      const paidOllama = new OllamaProvider({ costPer1kTokens: 0.001 });
      expect(paidOllama.costPer1kTokens).toBe(0.001);
    });
  });

  describe('formatRequest', () => {
    it('should format request cleanly for Ollama OpenAI-compatible endpoint', () => {
      const request: UnifiedApiRequest = {
        model: 'llama3.2',
        messages: [
          { role: 'system', content: 'You are running locally on Ollama.' },
          { role: 'user', content: 'Hello!' },
        ],
        temperature: 0.8,
        maxTokens: 300,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'llama3.2',
        messages: [
          { role: 'system', content: 'You are running locally on Ollama.' },
          { role: 'user', content: 'Hello!' },
        ],
        temperature: 0.8,
        max_tokens: 300,
      });
    });

    it('should format tools and responseFormat for local function calling', () => {
      const request: UnifiedApiRequest = {
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'Lookup local file' }],
        tools: [
          {
            type: 'function',
            function: { name: 'lookup_file', description: 'Read file' },
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
  });

  describe('formatResponse', () => {
    it('should parse standard Ollama completion with prompt_tokens usage', () => {
      const response = {
        id: 'ollama-msg-1',
        model: 'llama3.2',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Running fast on local hardware!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      };

      const result = provider.formatResponse(response);

      expect(result.id).toBe('ollama-msg-1');
      expect(result.model).toBe('llama3.2');
      expect(result.choices[0].message.content).toBe(
        'Running fast on local hardware!',
      );
      expect(result.choices[0].finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      });
    });

    it('should fallback to Ollama eval count metadata if standard usage is absent', () => {
      const response = {
        model: 'mistral',
        choices: [
          {
            message: { role: 'assistant', content: 'Bonjour!' },
          },
        ],
        prompt_eval_count: 15,
        eval_count: 6,
      };

      const result = provider.formatResponse(response);

      expect(result.choices[0].message.content).toBe('Bonjour!');
      expect(result.usage).toEqual({
        promptTokens: 15,
        completionTokens: 6,
        totalTokens: 21,
      });
    });
  });
});
