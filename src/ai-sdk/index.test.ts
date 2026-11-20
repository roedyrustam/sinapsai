/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Adapter Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { SinapsClient } from '../core/SinapsClient.js';
import type { Provider } from '../providers/Provider.js';
import type {
  ContentPart,
  CreateEmbeddingResponse,
  ImageUrlContentPart,
  TextContentPart,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import {
  convertPromptToSinapsMessages,
  convertToolsAndMode,
  createSinapsAI,
  createSinapsAIV2,
  createSinapsAIV3,
  mapFinishReason,
  SinapsEmbeddingModel,
  SinapsLanguageModel,
  SinapsLanguageModelV2,
  SinapsLanguageModelV3,
  sinapsai,
} from './index.js';
import type {
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
  LanguageModelV2StreamPart,
  LanguageModelV3StreamPart,
} from './types.js';

describe('Vercel AI SDK Adapter', () => {
  describe('Provider Factory & Metadata', () => {
    it('should create provider from SinapsClient instance', () => {
      const mockProvider: Provider = {
        name: 'mock',
        generateContent: vi.fn(),
      };
      const client = new SinapsClient({ providers: [mockProvider] });
      const sinaps = createSinapsAI(client);

      expect(sinaps.client).toBe(client);

      const model = sinaps('gpt-4o');
      expect(model).toBeInstanceOf(SinapsLanguageModel);
      expect(model.specificationVersion).toBe('v1');
      expect(model.provider).toBe('sinapsai');
      expect(model.modelId).toBe('gpt-4o');
      expect(model.defaultObjectGenerationMode).toBe('json');
      expect(model.supportsImageUrls).toBe(true);

      const aliasModel = sinaps.chat('claude-3-7-sonnet');
      expect(aliasModel.modelId).toBe('claude-3-7-sonnet');

      const embeddingModel = sinaps.textEmbeddingModel(
        'text-embedding-3-small',
      );
      expect(embeddingModel).toBeInstanceOf(SinapsEmbeddingModel);
      expect(embeddingModel.modelId).toBe('text-embedding-3-small');
      expect(embeddingModel.specificationVersion).toBe('v1');
      expect(embeddingModel.provider).toBe('sinapsai');
    });

    it('should create provider from SinapsClientOptions', () => {
      const mockProvider: Provider = {
        name: 'mock',
        generateContent: vi.fn(),
      };
      const sinaps = createSinapsAI({
        providers: [mockProvider],
        strategy: 'lowest-latency',
      });

      expect(sinaps.client).toBeInstanceOf(SinapsClient);
      const model = sinaps.languageModel('groq-llama-3.3');
      expect(model.modelId).toBe('groq-llama-3.3');
    });

    it('should expose sinapsai as an alias for createSinapsAI', () => {
      expect(sinapsai).toBeDefined();
      expect(typeof sinapsai).toBe('function');
      const mockProvider: Provider = {
        name: 'mock',
        generateContent: vi.fn(),
      };
      const provider = sinapsai({ providers: [mockProvider] });
      const model = provider('default-model');
      expect(model.modelId).toBe('default-model');
    });
  });

  describe('Prompt & Tools Converters', () => {
    it('should convert standard and multimodal messages', () => {
      const prompt: LanguageModelV1Prompt = [
        { role: 'system', content: 'You are a helpful assistant.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this chart' },
            {
              type: 'image',
              image: new URL('https://example.com/chart.png'),
            },
            {
              type: 'image',
              image: new Uint8Array([1, 2, 3]),
              mimeType: 'image/png',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking into it.' },
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'fetchData',
              args: { id: 42 },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'fetchData',
              result: { temperature: 28 },
            },
          ],
        },
      ];

      const messages = convertPromptToSinapsMessages(prompt);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });

      expect(messages[1].role).toBe('user');
      expect(Array.isArray(messages[1].content)).toBe(true);
      const userParts = messages[1].content as ContentPart[];
      expect((userParts[0] as TextContentPart).text).toBe('Analyze this chart');
      expect((userParts[1] as ImageUrlContentPart).image_url.url).toBe(
        'https://example.com/chart.png',
      );
      expect(userParts[2].type).toBe('image_url');
      expect((userParts[2] as ImageUrlContentPart).image_url.url).toContain(
        'data:image/png;base64,',
      );

      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Looking into it.');
      expect(messages[2].tool_calls).toEqual([
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'fetchData',
            arguments: '{"id":42}',
          },
        },
      ]);

      expect(messages[3].role).toBe('tool');
      expect(messages[3].tool_call_id).toBe('call_1');
      expect(messages[3].name).toBe('fetchData');
      expect(messages[3].content).toBe('{"temperature":28}');
    });

    it('should map tools and modes correctly', () => {
      // 1. Regular mode with tools and toolChoice
      const regularMode = convertToolsAndMode({
        type: 'regular',
        tools: [
          {
            type: 'function',
            name: 'calculator',
            description: 'Computes arithmetic',
            parameters: { type: 'object' },
          },
        ],
        toolChoice: { type: 'tool', toolName: 'calculator' },
      });
      expect(regularMode.tools).toHaveLength(1);
      expect(regularMode.tools?.[0].function.name).toBe('calculator');
      expect(regularMode.toolChoice).toEqual({
        type: 'function',
        function: { name: 'calculator' },
      });

      // 2. Object JSON mode
      const jsonMode = convertToolsAndMode({
        type: 'object-json',
        name: 'Report',
        schema: { type: 'object' },
      });
      expect(jsonMode.responseFormat).toEqual({
        type: 'json_object',
        json_schema: {
          name: 'Report',
          description: undefined,
          schema: { type: 'object' },
        },
      });

      // 3. Object Tool mode
      const toolMode = convertToolsAndMode({
        type: 'object-tool',
        tool: {
          type: 'function',
          name: 'extractInfo',
          parameters: { type: 'object' },
        },
      });
      expect(toolMode.tools).toHaveLength(1);
      expect(toolMode.toolChoice).toEqual({
        type: 'function',
        function: { name: 'extractInfo' },
      });
    });

    it('should map finish reasons accurately', () => {
      expect(mapFinishReason('stop')).toBe('stop');
      expect(mapFinishReason('end_turn')).toBe('stop');
      expect(mapFinishReason('length')).toBe('length');
      expect(mapFinishReason('max_tokens')).toBe('length');
      expect(mapFinishReason('tool_calls')).toBe('tool-calls');
      expect(mapFinishReason('content_filter')).toBe('content-filter');
      expect(mapFinishReason('error')).toBe('error');
      expect(mapFinishReason('unknown_reason')).toBe('other');
      expect(mapFinishReason(null)).toBe('stop');
    });
  });

  describe('LanguageModelV1.doGenerate', () => {
    it('should execute non-streaming chat completion and return LanguageModelV1Result', async () => {
      const mockResponse: UnifiedApiResponse = {
        id: 'sinaps-gen-1',
        model: 'gemini-2.5-flash',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Quantum computing uses qubits.',
              tool_calls: undefined,
            },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
      };

      const mockProvider: Provider = {
        name: 'mock-gemini',
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      };

      const sinaps = createSinapsAI({
        providers: [mockProvider],
      });

      const model = sinaps('gemini-2.5-flash', {
        thinkingBudget: 1024,
        reasoningEffort: 'medium',
        fallbackModels: ['claude-3-7-sonnet'],
      });

      const result = await model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Explain quantum computing' }],
          },
        ],
        temperature: 0.7,
        maxTokens: 500,
      });

      expect(result.text).toBe('Quantum computing uses qubits.');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 12,
        completionTokens: 8,
      });
      expect(result.rawCall.rawSettings).toEqual({
        temperature: 0.7,
        maxTokens: 500,
        mode: { type: 'regular' },
      });

      // Verify that extended settings were passed to SinapsAI
      expect(mockProvider.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-flash',
          thinkingBudget: 1024,
          reasoningEffort: 'medium',
          fallbackModels: ['claude-3-7-sonnet'],
        }),
      );
    });

    it('should return mapped tool calls in doGenerate', async () => {
      const mockResponse: UnifiedApiResponse = {
        id: 'sinaps-gen-2',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_weather_1',
                  type: 'function',
                  function: {
                    name: 'getWeather',
                    arguments: '{"location":"Tokyo"}',
                  },
                },
              ],
            },
            finishReason: 'tool_calls',
          },
        ],
        usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
      };

      const mockProvider: Provider = {
        name: 'mock-openai',
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      };

      const sinaps = createSinapsAI({ providers: [mockProvider] });
      const model = sinaps('gpt-4o');

      const result = await model.doGenerate({
        inputFormat: 'messages',
        mode: {
          type: 'regular',
          tools: [
            {
              type: 'function',
              name: 'getWeather',
              description: 'Get weather for city',
              parameters: { type: 'object' },
            },
          ],
        },
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Weather in Tokyo?' }],
          },
        ],
      });

      expect(result.text).toBeUndefined();
      expect(result.finishReason).toBe('tool-calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0]).toEqual({
        toolCallType: 'function',
        toolCallId: 'call_weather_1',
        toolName: 'getWeather',
        args: '{"location":"Tokyo"}',
      });
    });
  });

  describe('LanguageModelV1.doStream', () => {
    it('should stream text deltas, reasoning chunks, and finish event', async () => {
      async function* mockStreamGenerator(): AsyncIterable<UnifiedApiStreamChunk> {
        // 1. Thinking / reasoning delta
        yield {
          id: 'chunk-1',
          model: 'claude-3-7-sonnet',
          choices: [
            {
              delta: {
                role: 'assistant',
                reasoning_content: 'Let me think step-by-step...',
              },
              finishReason: null,
            },
          ],
        };
        // 2. Text delta 1
        yield {
          id: 'chunk-2',
          model: 'claude-3-7-sonnet',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'Hello, ',
              },
              finishReason: null,
            },
          ],
        };
        // 3. Text delta 2 with usage and finishReason
        yield {
          id: 'chunk-3',
          model: 'claude-3-7-sonnet',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'world!',
              },
              finishReason: 'stop',
            },
          ],
          usage: {
            promptTokens: 8,
            completionTokens: 6,
            totalTokens: 14,
          },
        };
      }

      const mockProvider: Provider = {
        name: 'mock-claude',
        generateContent: vi.fn().mockResolvedValue(mockStreamGenerator()),
      };

      const sinaps = createSinapsAI({ providers: [mockProvider] });
      const model = sinaps('claude-3-7-sonnet');

      const { stream } = await model.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
        ],
      });

      const reader = stream.getReader();
      const parts: LanguageModelV1StreamPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      expect(parts).toHaveLength(4);
      expect(parts[0]).toEqual({
        type: 'reasoning',
        textDelta: 'Let me think step-by-step...',
      });
      expect(parts[1]).toEqual({
        type: 'text-delta',
        textDelta: 'Hello, ',
      });
      expect(parts[2]).toEqual({
        type: 'text-delta',
        textDelta: 'world!',
      });
      expect(parts[3]).toEqual({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          promptTokens: 8,
          completionTokens: 6,
        },
      });
    });

    it('should stream tool calls and tool call deltas correctly', async () => {
      async function* mockStreamGenerator(): AsyncIterable<UnifiedApiStreamChunk> {
        // Initial tool call announcement
        yield {
          id: 'chunk-tc-1',
          model: 'gpt-4o',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_search_1',
                    type: 'function',
                    function: {
                      name: 'search',
                      arguments: '{"q":',
                    },
                  },
                ],
              },
              finishReason: null,
            },
          ],
        };
        // Incremental argument delta
        yield {
          id: 'chunk-tc-2',
          model: 'gpt-4o',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '"sinapsai"}',
                    },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
          usage: {
            promptTokens: 10,
            completionTokens: 12,
            totalTokens: 22,
          },
        };
      }

      const mockProvider: Provider = {
        name: 'mock-openai',
        generateContent: vi.fn().mockResolvedValue(mockStreamGenerator()),
      };

      const sinaps = createSinapsAI({ providers: [mockProvider] });
      const model = sinaps('gpt-4o');

      const { stream } = await model.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Search for sinapsai' }],
          },
        ],
      });

      const reader = stream.getReader();
      const parts: LanguageModelV1StreamPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      expect(parts).toHaveLength(3);
      expect(parts[0]).toEqual({
        type: 'tool-call',
        toolCallType: 'function',
        toolCallId: 'call_search_1',
        toolName: 'search',
        args: '{"q":',
      });
      expect(parts[1]).toEqual({
        type: 'tool-call-delta',
        toolCallType: 'function',
        toolCallId: 'call_search_1',
        toolName: 'search',
        argsTextDelta: '"sinapsai"}',
      });
      expect(parts[2]).toEqual({
        type: 'finish',
        finishReason: 'tool-calls',
        usage: {
          promptTokens: 10,
          completionTokens: 12,
        },
      });
    });

    it('should catch stream errors and enqueue error part', async () => {
      const mockProvider: Provider = {
        name: 'failing-provider',
        generateContent: vi
          .fn()
          .mockRejectedValue(new Error('Network connection dropped')),
      };

      const sinaps = createSinapsAI({ providers: [mockProvider] });
      const model = sinaps('failing-model');

      const { stream } = await model.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Test error' }] },
        ],
      });

      const reader = stream.getReader();
      const parts: LanguageModelV1StreamPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('error');
      const errorPart = parts[0] as { type: 'error'; error: Error };
      expect(
        errorPart.error.message.includes('All providers failed') ||
          errorPart.error.message.includes('Network connection dropped'),
      ).toBe(true);
    });
  });

  describe('EmbeddingModelV1.doEmbed', () => {
    it('should generate embeddings for single and multiple inputs with usage', async () => {
      const mockEmbeddingResponse: CreateEmbeddingResponse = {
        object: 'list',
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3], object: 'embedding' },
          { index: 1, embedding: [0.4, 0.5, 0.6], object: 'embedding' },
        ],
        model: 'text-embedding-3-small',
        usage: {
          promptTokens: 15,
          totalTokens: 15,
        },
      };

      const mockProvider: Provider = {
        name: 'mock-embeddings',
        generateContent: vi.fn(),
        generateEmbedding: vi.fn().mockResolvedValue(mockEmbeddingResponse),
      };

      const sinaps = createSinapsAI({ providers: [mockProvider] });
      const embeddingModel = sinaps.embedding('text-embedding-3-small', {
        dimensions: 512,
      });

      const result = await embeddingModel.doEmbed({
        values: ['first document', 'second document'],
      });

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(result.usage).toEqual({ tokens: 15 });

      expect(mockProvider.generateEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'text-embedding-3-small',
          input: ['first document', 'second document'],
          dimensions: 512,
        }),
      );
    });
  });

  describe('Gateway Reliability in Action via AI SDK Adapter', () => {
    it('should automatically failover to secondary provider transparently', async () => {
      const failingProvider: Provider = {
        id: 'primary-fail',
        name: 'primary',
        generateContent: vi
          .fn()
          .mockRejectedValue(new Error('503 Service Unavailable')),
      };

      const healthyResponse: UnifiedApiResponse = {
        id: 'healthy-1',
        model: 'fallback-model',
        choices: [
          {
            message: { role: 'assistant', content: 'Recovered via failover!' },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      };

      const fallbackProvider: Provider = {
        id: 'secondary-healthy',
        name: 'secondary',
        generateContent: vi.fn().mockResolvedValue(healthyResponse),
      };

      const sinaps = createSinapsAI({
        providers: [failingProvider, fallbackProvider],
        strategy: 'failover',
      });

      const model = sinaps('primary-model');
      const result = await model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      });

      expect(result.text).toBe('Recovered via failover!');
      expect(failingProvider.generateContent).toHaveBeenCalled();
      expect(fallbackProvider.generateContent).toHaveBeenCalled();
    });
  });

  describe('Vercel AI SDK v5 (LanguageModelV2) & v6 (LanguageModelV3)', () => {
    it('supports LanguageModelV2 doGenerate and doStream with reasoning, text, and tool calls', async () => {
      const mockProvider: Provider = {
        name: 'frontier-v2',
        generateContent: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'res-v2-1',
            model: 'claude-sonnet-5-5',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Final Answer',
                  reasoning_content: 'Internal Chain',
                  tool_calls: [
                    {
                      id: 'tc_1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{"k":"v"}' },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              reasoningTokens: 20,
              cachedPromptTokens: 60,
            },
          })
          .mockResolvedValueOnce(
            (async function* () {
              yield {
                id: 'stream-v2-1',
                model: 'gemini-4-carbon',
                choices: [
                  {
                    delta: { reasoning_content: 'Think ' },
                    finishReason: null,
                  },
                ],
              } satisfies UnifiedApiStreamChunk;
              yield {
                id: 'stream-v2-1',
                model: 'gemini-4-carbon',
                choices: [
                  {
                    delta: { content: 'Done' },
                    finishReason: 'stop',
                  },
                ],
                usage: {
                  promptTokens: 20,
                  completionTokens: 10,
                  totalTokens: 30,
                  reasoningTokens: 4,
                  cachedPromptTokens: 8,
                },
              } satisfies UnifiedApiStreamChunk;
            })(),
          ),
      };

      const sinapsV2 = createSinapsAIV2({ providers: [mockProvider] });
      const modelV2 = sinapsV2('claude-sonnet-5-5', {
        thinkingLevel: 'high',
        includeThoughts: true,
      });
      expect(modelV2).toBeInstanceOf(SinapsLanguageModelV2);
      expect(modelV2.specificationVersion).toBe('v2');

      const genRes = await modelV2.doGenerate({
        prompt: [
          { role: 'system', content: 'Be precise.' },
          { role: 'user', content: [{ type: 'text', text: 'Inspect' }] },
        ],
        maxOutputTokens: 512,
        responseFormat: {
          type: 'json',
          name: 'out',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
        providerOptions: { sinapsai: { reasoningEffort: 'high' } },
      });

      expect(genRes.content).toEqual([
        { type: 'reasoning', text: 'Internal Chain' },
        { type: 'text', text: 'Final Answer' },
        {
          type: 'tool-call',
          toolCallId: 'tc_1',
          toolName: 'lookup',
          input: '{"k":"v"}',
        },
      ]);
      expect(genRes.finishReason).toBe('tool-calls');
      expect(genRes.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        reasoningTokens: 20,
        cachedInputTokens: 60,
      });

      const streamRes = await modelV2.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      });
      const reader = streamRes.stream.getReader();
      const parts: LanguageModelV2StreamPart[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts.some((p) => p.type === 'reasoning-start')).toBe(true);
      expect(
        parts.some((p) => p.type === 'reasoning-delta' && p.delta === 'Think '),
      ).toBe(true);
      expect(
        parts.some((p) => p.type === 'text-delta' && p.delta === 'Done'),
      ).toBe(true);
      const finishPart = parts.find((p) => p.type === 'finish');
      expect(finishPart).toMatchObject({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          reasoningTokens: 4,
          cachedInputTokens: 8,
        },
      });
    });

    it('supports LanguageModelV3 (AI SDK v6) unified finishReason and nested token accounting', async () => {
      const mockProvider: Provider = {
        name: 'frontier-v3',
        generateContent: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'res-v3-1',
            model: 'gpt-5.6-sol-medium',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'V3 Output',
                  reasoning_content: 'V3 Thought',
                },
                finishReason: 'stop',
              },
            ],
            usage: {
              promptTokens: 100,
              completionTokens: 40,
              totalTokens: 140,
              reasoningTokens: 15,
              cachedPromptTokens: 70,
            },
          })
          .mockResolvedValueOnce(
            (async function* () {
              yield {
                id: 'stream-v3-1',
                model: 'gpt-5.6-sol-medium',
                choices: [
                  { delta: { content: 'Stream V3' }, finishReason: 'stop' },
                ],
                usage: {
                  promptTokens: 30,
                  completionTokens: 12,
                  totalTokens: 42,
                  reasoningTokens: 4,
                  cachedPromptTokens: 10,
                },
              } satisfies UnifiedApiStreamChunk;
            })(),
          ),
      };

      const sinapsV1Root = createSinapsAI({ providers: [mockProvider] });
      expect(sinapsV1Root.languageModelV3('gpt-5.6-sol-medium')).toBeInstanceOf(
        SinapsLanguageModelV3,
      );

      const sinapsV3 = createSinapsAIV3(sinapsV1Root.client);
      const modelV3 = sinapsV3('gpt-5.6-sol-medium');
      expect(modelV3.specificationVersion).toBe('v3');

      const genRes = await modelV3.doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Ping V3' }] },
        ],
      });
      expect(genRes.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
      expect(genRes.usage).toEqual({
        inputTokens: { total: 100, noCache: 30, cacheRead: 70 },
        outputTokens: { total: 40, text: 25, reasoning: 15 },
      });

      const streamRes = await modelV3.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Stream' }] }],
      });
      const reader = streamRes.stream.getReader();
      const parts: LanguageModelV3StreamPart[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      const finish = parts.find((p) => p.type === 'finish');
      expect(finish).toEqual({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 30, noCache: 20, cacheRead: 10 },
          outputTokens: { total: 12, text: 8, reasoning: 4 },
        },
      });
    });
  });
});
