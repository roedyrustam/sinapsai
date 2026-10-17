/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
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

    it('should extract cachedPromptTokens from prompt_cache_hit_tokens or prompt_tokens_details', () => {
      const deepseekCachedResponse = {
        id: 'deepseek-msg-cached',
        model: 'deepseek-chat',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Cached reply',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          prompt_cache_hit_tokens: 80,
        },
      };

      const result = provider.formatResponse(deepseekCachedResponse);
      expect(result.usage?.cachedPromptTokens).toBe(80);
      expect(result.usage?.promptTokens).toBe(100);
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

  describe('generateContent (streaming)', () => {
    it('should include stream_options when stream is true in formatRequest', () => {
      const result = provider.formatRequest({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      });

      expect(result.stream).toBe(true);
      expect(result.stream_options).toEqual({ include_usage: true });
    });

    it('should parse streaming SSE chunks and extract usage with cachedPromptTokens', async () => {
      const sseChunks = [
        `data: ${JSON.stringify({
          id: 'chunk-1',
          model: 'deepseek-reasoner',
          choices: [
            {
              delta: {
                role: 'assistant',
                reasoning_content: 'Analyzing problem...',
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'chunk-2',
          model: 'deepseek-reasoner',
          choices: [
            {
              delta: {
                content: 'The answer is 42.',
              },
              finish_reason: 'stop',
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'chunk-3',
          model: 'deepseek-reasoner',
          choices: [],
          usage: {
            prompt_tokens: 30,
            completion_tokens: 15,
            total_tokens: 45,
            prompt_cache_hit_tokens: 24,
          },
        })}\n\n`,
        'data: [DONE]\n\n',
      ];

      const sseStream = new ReadableStream({
        start(controller) {
          for (const c of sseChunks) {
            controller.enqueue(new TextEncoder().encode(c));
          }
          controller.close();
        },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream,
        headers: new Headers(),
      });

      const stream = await provider.generateContent({
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: 'What is 6x7?' }],
        stream: true,
      });

      const collected = [];
      // biome-ignore lint/suspicious/noExplicitAny: stream iteration
      for await (const chunk of stream as AsyncIterable<any>) {
        collected.push(chunk);
      }

      expect(collected).toHaveLength(3);

      // First chunk: reasoning content
      expect(collected[0].choices[0].delta.reasoning_content).toBe(
        'Analyzing problem...',
      );

      // Second chunk: main content
      expect(collected[1].choices[0].delta.content).toBe('The answer is 42.');
      expect(collected[1].choices[0].finishReason).toBe('stop');

      // Third chunk: usage metadata chunk with empty choices
      expect(collected[2].choices).toEqual([]);
      expect(collected[2].usage).toEqual({
        promptTokens: 30,
        completionTokens: 15,
        totalTokens: 45,
        cachedPromptTokens: 24,
      });
    });
  });
});
