import { describe, expect, it } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { parseDurationMs, parseRateLimitHeaders } from '../utils/rateLimit.js';
import { GroqProvider } from './GroqProvider.js';

describe('GroqProvider', () => {
  const provider = new GroqProvider({ apiKey: 'test-key' });

  describe('resolveModel', () => {
    it('should resolve default model to llama-3.3-70b-versatile when no defaultModel is configured', () => {
      expect(provider.resolveModel('default')).toBe('llama-3.3-70b-versatile');
      expect(provider.resolveModel('')).toBe('llama-3.3-70b-versatile');
      expect(provider.resolveModel('custom-model')).toBe('custom-model');
    });

    it('should resolve configured default model and modelMap', () => {
      const customProvider = new GroqProvider({
        apiKey: 'test-key',
        defaultModel: 'llama-3.1-8b-instant',
        modelMap: {
          'fast-llm': 'openai/gpt-oss-20b',
        },
      });
      expect(customProvider.resolveModel('default')).toBe(
        'llama-3.1-8b-instant',
      );
      expect(customProvider.resolveModel('fast-llm')).toBe(
        'openai/gpt-oss-20b',
      );
      expect(customProvider.resolveModel('unknown-model')).toBe(
        'llama-3.1-8b-instant',
      );
    });
  });

  describe('formatRequest', () => {
    it('should correctly format request with temperature and max_tokens', () => {
      const request: UnifiedApiRequest = {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 500,
      };

      const result = provider.formatRequest(request);

      expect(result).toEqual({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        max_tokens: 500,
        max_completion_tokens: 500,
      });
    });

    it('should clamp temperature 0 to 1e-8 according to Groq documentation specifications', () => {
      const request: UnifiedApiRequest = {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
      };

      const result = provider.formatRequest(request);
      expect(result.temperature).toBe(1e-8);
    });

    it('should strip messages[].name to prevent Groq 400 error as per official docs', () => {
      const request: UnifiedApiRequest = {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', name: 'JohnDoe', content: 'Hello' },
          { role: 'assistant', name: 'Bot', content: 'Hi John' },
        ],
      };

      const result = provider.formatRequest(request);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hi John',
      });
      expect(result.messages[0].name).toBeUndefined();
      expect(result.messages[1].name).toBeUndefined();
    });

    it('should set reasoning_format to parsed when thinkingBudget is provided', () => {
      const request: UnifiedApiRequest = {
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Solve 2+2' }],
        thinkingBudget: 1024,
      };

      const result = provider.formatRequest(request);
      expect(result.reasoning_format).toBe('parsed');
    });

    it('should format tools, toolChoice, and json_schema structured outputs', () => {
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
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'stock_result',
            schema: {
              type: 'object',
              properties: { price: { type: 'number' } },
            },
            strict: true,
          },
        },
      };

      const result = provider.formatRequest(request);

      expect(result.tools).toHaveLength(1);
      expect(result.tool_choice).toBe('auto');
      expect(result.response_format.type).toBe('json_schema');
      expect(result.messages[1].tool_calls).toHaveLength(1);
      expect(result.messages[2].tool_call_id).toBe('call_2');
      // name must be omitted for tool role message as well
      expect(result.messages[2].name).toBeUndefined();
    });
  });

  describe('formatResponse', () => {
    it('should correctly parse the groq response', () => {
      const groqResponse = {
        id: 'chatcmpl-123',
        model: 'llama-3.3-70b-versatile',
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
      expect(result.model).toBe('llama-3.3-70b-versatile');
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

    it('should parse reasoning field into reasoning_content for Groq reasoning models', () => {
      const groqResponse = {
        id: 'chatcmpl-reasoning',
        model: 'openai/gpt-oss-20b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 4.',
              reasoning: 'First I calculate 2 + 2 = 4.',
            },
            finish_reason: 'stop',
          },
        ],
      };

      const result = provider.formatResponse(groqResponse);
      expect(result.choices[0].message.content).toBe('The answer is 4.');
      expect(result.choices[0].message.reasoning_content).toBe(
        'First I calculate 2 + 2 = 4.',
      );
    });

    it('should parse raw <think>...</think> tags into reasoning_content', () => {
      const groqResponse = {
        id: 'chatcmpl-raw-think',
        model: 'qwen/qwen3.8-27b',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                '<think>Let me analyze strawberry.</think>There are 3 rs.',
            },
            finish_reason: 'stop',
          },
        ],
      };

      const result = provider.formatResponse(groqResponse);
      expect(result.choices[0].message.content).toBe('There are 3 rs.');
      expect(result.choices[0].message.reasoning_content).toBe(
        'Let me analyze strawberry.',
      );
    });

    it('should extract cachedPromptTokens from prompt_tokens_details', () => {
      const groqResponse = {
        id: 'chatcmpl-cached',
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Fast Groq reply',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 30,
          total_tokens: 230,
          prompt_tokens_details: {
            cached_tokens: 150,
          },
        },
      };

      const result = provider.formatResponse(groqResponse);
      expect(result.usage?.cachedPromptTokens).toBe(150);
      expect(result.usage?.promptTokens).toBe(200);
    });

    it('should handle response without usage metadata gracefully', () => {
      const groqResponse = {
        id: 'chatcmpl-456',
        model: 'llama-3.3-70b-versatile',
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

  describe('Groq rate limits parsing', () => {
    it('should parse Groq duration format headers correctly (7.66s, 2m59.56s, 120ms)', () => {
      expect(parseDurationMs('7.66s')).toBe(7660);
      expect(parseDurationMs('2m59.56s')).toBe(179560);
      expect(parseDurationMs('120ms')).toBe(120);
      expect(parseDurationMs('1h')).toBe(3600000);
      expect(parseDurationMs('5')).toBe(5000);

      const headers = new Headers({
        'x-ratelimit-remaining-requests': '14370',
        'x-ratelimit-remaining-tokens': '17997',
        'x-ratelimit-reset-tokens': '7.66s',
        'x-ratelimit-reset-requests': '2m59.56s',
      });

      const parsed = parseRateLimitHeaders(headers);
      expect(parsed?.remainingRequests).toBe(14370);
      expect(parsed?.remainingTokens).toBe(17997);
      expect(parsed?.resetMs).toBe(7660);
    });
  });
});
