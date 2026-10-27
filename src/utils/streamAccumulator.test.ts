/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { UnifiedApiStreamChunk } from '../types/index.js';
import { accumulateStream } from './streamAccumulator.js';

describe('accumulateStream', () => {
  it('accumulates plain text streaming chunks', async () => {
    async function* createChunks(): AsyncIterable<UnifiedApiStreamChunk> {
      yield {
        id: 'chunk-1',
        model: 'gpt-4o',
        choices: [
          {
            delta: { role: 'assistant', content: 'Hello' },
            finishReason: null,
          },
        ],
      };
      yield {
        id: 'chunk-1',
        model: 'gpt-4o',
        choices: [
          {
            delta: { content: ' world' },
            finishReason: null,
          },
        ],
      };
      yield {
        id: 'chunk-1',
        model: 'gpt-4o',
        choices: [
          {
            delta: { content: '!' },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 3,
          totalTokens: 13,
        },
      };
    }

    const res = await accumulateStream(createChunks());
    expect(res.id).toBe('chunk-1');
    expect(res.model).toBe('gpt-4o');
    expect(res.choices[0].message.role).toBe('assistant');
    expect(res.choices[0].message.content).toBe('Hello world!');
    expect(res.choices[0].finishReason).toBe('stop');
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
    });
  });

  it('accumulates reasoning/thinking content', async () => {
    async function* createChunks(): AsyncIterable<UnifiedApiStreamChunk> {
      yield {
        id: 'reason-1',
        model: 'deepseek-reasoner',
        choices: [
          {
            delta: {
              role: 'assistant',
              reasoning_content: 'Let me think step 1. ',
            },
            finishReason: null,
          },
        ],
      };
      yield {
        id: 'reason-1',
        model: 'deepseek-reasoner',
        choices: [
          {
            delta: {
              reasoning_content: 'Step 2 conclusion.',
              content: 'Final Answer',
            },
            finishReason: 'stop',
          },
        ],
      };
    }

    const res = await accumulateStream(createChunks());
    expect(res.choices[0].message.reasoning_content).toBe(
      'Let me think step 1. Step 2 conclusion.',
    );
    expect(res.choices[0].message.content).toBe('Final Answer');
  });

  it('accumulates multi-tool call deltas merged by index', async () => {
    async function* createChunks(): AsyncIterable<UnifiedApiStreamChunk> {
      // First chunk: declares tool call 0
      yield {
        id: 'tool-stream',
        model: 'claude-3-7-sonnet',
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_weather_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      };
      // Second chunk: tool 0 arguments fragment 1
      yield {
        id: 'tool-stream',
        model: 'claude-3-7-sonnet',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"location":' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      };
      // Third chunk: tool 0 arguments fragment 2 AND declares tool 1
      yield {
        id: 'tool-stream',
        model: 'claude-3-7-sonnet',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ' "Tokyo"}' },
                },
                {
                  index: 1,
                  id: 'call_calc_456',
                  type: 'function',
                  function: { name: 'calculate', arguments: '{"expr":"2+2"}' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      };
      // Final chunk
      yield {
        id: 'tool-stream',
        model: 'claude-3-7-sonnet',
        choices: [
          {
            delta: {},
            finishReason: 'tool_calls',
          },
        ],
      };
    }

    const res = await accumulateStream(createChunks());
    expect(res.choices[0].finishReason).toBe('tool_calls');
    const toolCalls = res.choices[0].message.tool_calls;
    expect(toolCalls).toBeDefined();
    expect(toolCalls).toHaveLength(2);

    expect(toolCalls?.[0]).toEqual({
      id: 'call_weather_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"location": "Tokyo"}',
      },
    });

    expect(toolCalls?.[1]).toEqual({
      id: 'call_calc_456',
      type: 'function',
      function: {
        name: 'calculate',
        arguments: '{"expr":"2+2"}',
      },
    });
  });

  it('triggers onChunk callback for every chunk', async () => {
    async function* createChunks(): AsyncIterable<UnifiedApiStreamChunk> {
      yield { id: 'c1', model: 'm', choices: [{ delta: { content: 'a' } }] };
      yield { id: 'c2', model: 'm', choices: [{ delta: { content: 'b' } }] };
    }

    const seen: string[] = [];
    await accumulateStream(createChunks(), {
      onChunk: (chunk) => {
        if (chunk.choices?.[0]?.delta?.content) {
          seen.push(chunk.choices[0].delta.content);
        }
      },
    });

    expect(seen).toEqual(['a', 'b']);
  });

  it('does not duplicate full function names when sent across multiple chunks', async () => {
    async function* createChunks(): AsyncIterable<UnifiedApiStreamChunk> {
      yield {
        id: 'gemini-c1',
        model: 'gemini-4-pro',
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search_database', arguments: '' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      };
      yield {
        id: 'gemini-c2',
        model: 'gemini-4-pro',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'search_database',
                    arguments: '{"query":"test"}',
                  },
                },
              ],
            },
            finishReason: 'tool_calls',
          },
        ],
      };
    }

    const res = await accumulateStream(createChunks());
    expect(res.choices[0].message.tool_calls?.[0].function.name).toBe(
      'search_database',
    );
    expect(res.choices[0].message.tool_calls?.[0].function.arguments).toBe(
      '{"query":"test"}',
    );
  });
});
