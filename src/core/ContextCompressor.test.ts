/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/index.js';
import {
  ContextCompressor,
  estimateMessageTokens,
  estimateTotalTokens,
} from './ContextCompressor.js';

describe('ContextCompressor', () => {
  describe('Token Estimation', () => {
    it('should estimate tokens for plain text, multimodal, and tool calls', () => {
      const textMsg: ChatMessage = {
        role: 'user',
        content: 'Hello world, this is a test message.',
      };
      expect(estimateMessageTokens(textMsg)).toBeGreaterThan(5);

      const multiModalMsg: ChatMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this chart' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/chart.png' },
          },
        ],
      };
      // Image adds heuristic weight (1024 chars -> ~256 tokens)
      expect(estimateMessageTokens(multiModalMsg)).toBeGreaterThan(250);

      const toolMsg: ChatMessage = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Makassar"}',
            },
          },
        ],
      };
      expect(estimateMessageTokens(toolMsg)).toBeGreaterThan(10);
    });
  });

  describe('Sliding-Window Compression', () => {
    it('should return messages untouched when under maxPromptTokens', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi!' },
      ];
      const compressor = new ContextCompressor({ maxPromptTokens: 500 });
      const result = compressor.compress(messages);

      expect(result.droppedCount).toBe(0);
      expect(result.messages).toEqual(messages);
      expect(result.compressedTokens).toBe(result.originalTokens);
    });

    it('should drop oldest conversation turns while preserving system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System instruction that must stay.' },
        { role: 'user', content: 'Old message 1 '.repeat(20) },
        { role: 'assistant', content: 'Old reply 1 '.repeat(20) },
        { role: 'user', content: 'Old message 2 '.repeat(20) },
        { role: 'assistant', content: 'Old reply 2 '.repeat(20) },
        { role: 'user', content: 'Latest user question?' },
      ];

      const compressor = new ContextCompressor({
        maxPromptTokens: 60,
        strategy: 'sliding-window',
      });
      const result = compressor.compress(messages);

      expect(result.droppedCount).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe(
        'System instruction that must stay.',
      );
      expect(result.messages[result.messages.length - 1].content).toBe(
        'Latest user question?',
      );
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
    });

    it('should preserve atomic tool_calls and tool response pairs together', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: 'Old turn '.repeat(30) },
        { role: 'assistant', content: 'Old response '.repeat(30) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'fetch_data', arguments: '{"id":1}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_abc',
          content: '{"status":"ok"}',
        },
        { role: 'user', content: 'Summarize the tool result.' },
      ];

      const compressor = new ContextCompressor({
        maxPromptTokens: 90,
        strategy: 'sliding-window',
      });
      const result = compressor.compress(messages);

      // Ensure no orphaned 'tool' message exists without its preceding 'assistant' tool_calls
      const toolIdx = result.messages.findIndex((m) => m.role === 'tool');
      if (toolIdx !== -1) {
        expect(result.messages[toolIdx - 1]?.role).toBe('assistant');
        expect(result.messages[toolIdx - 1]?.tool_calls).toBeDefined();
      }
    });
  });

  describe('Middle-Out Compression', () => {
    it('should keep system message, first user message, and latest messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'Initial project context and goal.' },
        { role: 'assistant', content: 'Middle turn 1 '.repeat(25) },
        { role: 'user', content: 'Middle turn 2 '.repeat(25) },
        { role: 'assistant', content: 'Middle turn 3 '.repeat(25) },
        { role: 'user', content: 'Final question?' },
      ];

      const totalBefore = estimateTotalTokens(messages);
      const compressor = new ContextCompressor({
        maxPromptTokens: Math.floor(totalBefore * 0.45),
        strategy: 'middle-out',
      });

      const result = compressor.compress(messages);

      expect(result.droppedCount).toBeGreaterThan(0);
      expect(result.messages[0].content).toBe('System prompt.');
      expect(result.messages[1].content).toBe(
        'Initial project context and goal.',
      );
      expect(result.messages[result.messages.length - 1].content).toBe(
        'Final question?',
      );
    });
  });
});
