/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * Unit tests for McpToolBridge and autonomous agent tool calling loop (SinapsClient.runWithTools)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { ToolCall } from '../types/index.js';
import { coerceToolArguments, McpToolBridge } from './McpBridge.js';
import { SinapsClient } from './SinapsClient.js';

describe('McpToolBridge', () => {
  describe('tool registration and lifecycle', () => {
    it('should register an MCP tool and verify presence', () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'get_weather',
        description: 'Get current weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
        handler: async ({ city }) => ({
          city,
          temp: 24,
          condition: 'Sunny',
        }),
      });

      expect(bridge.hasTool('get_weather')).toBe(true);
      expect(bridge.hasTool('unknown_tool')).toBe(false);
      expect(bridge.getTool('get_weather')?.description).toBe(
        'Get current weather',
      );

      const list = bridge.listTools();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('get_weather');
      expect(list[0].inputSchema.required).toEqual(['city']);
    });

    it('should throw an error when registering a tool without name or handler', () => {
      const bridge = new McpToolBridge();
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid registration
      expect(() => bridge.registerTool({} as any)).toThrow(
        'Tool definition must include a valid non-empty name.',
      );

      expect(() =>
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid handler
        bridge.registerTool({ name: 'calc' } as any),
      ).toThrow("Tool 'calc' must provide an executable handler function.");
    });

    it('should unregister a tool and clear all tools', () => {
      const bridge = new McpToolBridge([
        {
          name: 'tool_a',
          description: 'A',
          inputSchema: { type: 'object' },
          handler: () => 'A',
        },
        {
          name: 'tool_b',
          description: 'B',
          inputSchema: { type: 'object' },
          handler: () => 'B',
        },
      ]);

      expect(bridge.listTools()).toHaveLength(2);
      expect(bridge.unregisterTool('tool_a')).toBe(true);
      expect(bridge.hasTool('tool_a')).toBe(false);
      expect(bridge.hasTool('tool_b')).toBe(true);

      bridge.clear();
      expect(bridge.listTools()).toHaveLength(0);
    });

    it('should register tools in bulk with registerTools() and expose size', () => {
      const bridge = new McpToolBridge();
      expect(bridge.size).toBe(0);

      bridge.registerTools([
        {
          name: 'tool_1',
          inputSchema: { type: 'object' },
          handler: () => '1',
        },
        {
          name: 'tool_2',
          inputSchema: { type: 'object' },
          handler: () => '2',
        },
      ]);

      expect(bridge.size).toBe(2);
      expect(bridge.hasTool('tool_1')).toBe(true);
      expect(bridge.hasTool('tool_2')).toBe(true);
    });
  });

  describe('schema conversion', () => {
    it('should convert MCP tools to OpenAI/Unified format via toUnifiedTools()', () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'calculate_tax',
        description: 'Calculates tax amount',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            rate: { type: 'number' },
          },
          required: ['amount', 'rate'],
        },
        handler: ({ amount, rate }) => amount * rate,
      });

      const unifiedTools = bridge.getTools();
      expect(unifiedTools).toHaveLength(1);
      expect(unifiedTools[0]).toEqual({
        type: 'function',
        function: {
          name: 'calculate_tax',
          description: 'Calculates tax amount',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              rate: { type: 'number' },
            },
            required: ['amount', 'rate'],
          },
        },
      });
    });

    it('should convert back and forth between MCP and Unified tool definitions', () => {
      const mcpTool = {
        name: 'search_db',
        description: 'Query database',
        inputSchema: {
          type: 'object' as const,
          properties: { query: { type: 'string' } },
        },
      };

      const unified = McpToolBridge.toToolDefinition(mcpTool);
      expect(unified.function.name).toBe('search_db');
      expect(unified.function.parameters).toEqual(mcpTool.inputSchema);

      const convertedBack = McpToolBridge.fromToolDefinition(unified);
      expect(convertedBack.name).toBe('search_db');
      expect(convertedBack.description).toBe('Query database');
      expect(convertedBack.inputSchema).toEqual(mcpTool.inputSchema);
    });
  });

  describe('executeToolCall', () => {
    it('should execute tool with valid JSON arguments and format object return', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'multiply',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
        },
        handler: async ({ a, b }: { a: number; b: number }) => ({
          result: a * b,
        }),
      });

      const call: ToolCall = {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'multiply',
          arguments: '{"a": 6, "b": 7}',
        },
      };

      const result = await bridge.executeToolCall(call);
      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('"result": 42');
      expect(result._raw).toEqual({ result: 42 });
    });

    it('should format string and McpContent return values cleanly', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'greet',
        inputSchema: { type: 'object' },
        handler: () => 'Hello, world!',
      });
      bridge.registerTool({
        name: 'custom_content',
        inputSchema: { type: 'object' },
        handler: () => ({
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
        }),
      });

      const res1 = await bridge.executeToolCall({
        id: 'c1',
        type: 'function',
        function: { name: 'greet', arguments: '{}' },
      });
      expect(res1.content).toEqual([{ type: 'text', text: 'Hello, world!' }]);

      const res2 = await bridge.executeToolCall({
        id: 'c2',
        type: 'function',
        function: { name: 'custom_content', arguments: '{}' },
      });
      expect(res2.content).toHaveLength(2);
      expect(res2.content[0].text).toBe('Part 1');
      expect(res2.content[1].text).toBe('Part 2');
    });

    it('should handle unregistered tools gracefully without throwing', async () => {
      const bridge = new McpToolBridge();
      const result = await bridge.executeToolCall({
        id: 'c_missing',
        type: 'function',
        function: { name: 'ghost_tool', arguments: '{}' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Tool 'ghost_tool' is not registered on this MCP bridge.",
      );
    });

    it('should handle invalid JSON arguments without throwing', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'test_tool',
        inputSchema: { type: 'object' },
        handler: () => 'ok',
      });

      const result = await bridge.executeToolCall({
        id: 'c_bad_json',
        type: 'function',
        function: { name: 'test_tool', arguments: '{ broken json: nil ' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Invalid JSON arguments for tool 'test_tool'",
      );
    });

    it('should catch handler runtime exceptions and return error text', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'failing_tool',
        inputSchema: { type: 'object' },
        handler: () => {
          throw new Error('Database connection failed');
        },
      });

      const result = await bridge.executeToolCall({
        id: 'c_fail',
        type: 'function',
        function: { name: 'failing_tool', arguments: '{}' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Error executing tool 'failing_tool': Database connection failed",
      );
    });

    it('should abort tool execution if context.signal is already aborted', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'quick_tool',
        inputSchema: { type: 'object' },
        handler: () => 'done',
      });

      const controller = new AbortController();
      controller.abort();

      const result = await bridge.executeToolCall(
        {
          id: 'c_aborted',
          type: 'function',
          function: { name: 'quick_tool', arguments: '{}' },
        },
        { signal: controller.signal },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Tool 'quick_tool' execution aborted by client signal.",
      );
    });

    it('should timeout tool execution when toolDef.timeoutMs is exceeded', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'slow_tool',
        inputSchema: { type: 'object' },
        timeoutMs: 25,
        handler: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return 'slow result';
        },
      });

      const result = await bridge.executeToolCall({
        id: 'c_slow',
        type: 'function',
        function: { name: 'slow_tool', arguments: '{}' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Tool 'slow_tool' timed out after 25ms.",
      );
    });
  });

  describe('executeToolCalls', () => {
    it('should execute multiple tool calls in parallel and map to role: tool ChatMessage[]', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'add',
        inputSchema: { type: 'object' },
        handler: ({ x, y }: { x: number; y: number }) => x + y,
      });
      bridge.registerTool({
        name: 'echo',
        inputSchema: { type: 'object' },
        handler: ({ msg }: { msg: string }) => `Echo: ${msg}`,
      });

      const calls: ToolCall[] = [
        {
          id: 'call_add',
          type: 'function',
          function: { name: 'add', arguments: '{"x": 10, "y": 5}' },
        },
        {
          id: 'call_echo',
          type: 'function',
          function: { name: 'echo', arguments: '{"msg": "hi"}' },
        },
      ];

      const messages = await bridge.executeToolCalls(calls);
      expect(messages).toHaveLength(2);

      expect(messages[0].role).toBe('tool');
      expect(messages[0].tool_call_id).toBe('call_add');
      expect(messages[0].name).toBe('add');
      expect(messages[0].content).toBe('15');

      expect(messages[1].role).toBe('tool');
      expect(messages[1].tool_call_id).toBe('call_echo');
      expect(messages[1].name).toBe('echo');
      expect(messages[1].content).toBe('Echo: hi');
    });

    it('should return empty array when no calls are passed', async () => {
      const bridge = new McpToolBridge();
      expect(await bridge.executeToolCalls([])).toEqual([]);
    });
  });

  describe('handleJsonRpc', () => {
    const bridge = new McpToolBridge();
    bridge.registerTool({
      name: 'ping_tool',
      description: 'Simple ping',
      inputSchema: { type: 'object' },
      handler: () => 'pong',
    });

    it('should handle JSON-RPC ping method', async () => {
      const res = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      });
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      });
    });

    it('should handle JSON-RPC tools/list method', async () => {
      const res = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'tools/list',
      });
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe('req-2');
      expect(res.result.tools).toHaveLength(1);
      expect(res.result.tools[0].name).toBe('ping_tool');
    });

    it('should handle JSON-RPC tools/call method', async () => {
      const res = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'ping_tool',
          arguments: {},
        },
      });

      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(3);
      expect(res.result.isError).toBe(false);
      expect(res.result.content).toEqual([{ type: 'text', text: 'pong' }]);
    });

    it('should return -32601 error for unknown tool in tools/call', async () => {
      const res = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'non_existent',
        },
      });

      expect(res.error?.code).toBe(-32601);
      expect(res.error?.message).toContain('Method or tool not found');
    });

    it('should handle JSON-RPC initialize and notifications/initialized methods', async () => {
      const initRes = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
        },
      });

      expect(initRes.jsonrpc).toBe('2.0');
      expect(initRes.id).toBe(10);
      expect(initRes.result.protocolVersion).toBe('2024-11-05');
      expect(initRes.result.serverInfo.name).toBe('sinapsai-mcp');
      expect(initRes.result.serverInfo.version).toBe('2.11.0');

      const notifRes = await bridge.handleJsonRpc({
        jsonrpc: '2.0',
        id: null,
        method: 'notifications/initialized',
      });
      expect(notifRes.jsonrpc).toBe('2.0');
      expect(notifRes.result).toEqual({});
    });

    it('should return -32700 for invalid JSON string input', async () => {
      const res = await bridge.handleJsonRpc('invalid json string {');
      expect(res.error?.code).toBe(-32700);
      expect(res.error?.message).toContain('Parse error');
    });

    it('should return -32600 for missing jsonrpc 2.0 or method', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing protocol validation
      const res = await bridge.handleJsonRpc({ id: 5 } as any);
      expect(res.error?.code).toBe(-32600);
    });
  });
});

describe('SinapsClient.runWithTools', () => {
  it('should complete in 1 step if model immediately produces final answer without tools', async () => {
    const mockProvider: Provider = {
      id: 'mock-llm',
      name: 'MockLLM',
      generateContent: vi.fn().mockResolvedValue({
        id: 'resp-1',
        model: 'test-model',
        choices: [
          {
            message: { role: 'assistant', content: 'Paris is the capital.' },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    };

    const client = new SinapsClient({ providers: [mockProvider] });
    client.mcp.registerTool({
      name: 'search',
      inputSchema: { type: 'object' },
      handler: () => 'results',
    });

    const result = await client.runWithTools({
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is capital of France?' }],
    });

    expect(result.totalSteps).toBe(0);
    expect(result.response.choices[0].message.content).toBe(
      'Paris is the capital.',
    );
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('Paris is the capital.');
    expect(result.totalTokens).toBe(15);
  });

  it('should execute multi-step tool call loop and return final answer', async () => {
    let callCount = 0;
    const mockProvider: Provider = {
      id: 'mock-llm',
      name: 'MockLLM',
      generateContent: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First turn: model asks to execute tool
          return {
            id: 'resp-step-1',
            model: 'agent-model',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_lookup_1',
                      type: 'function',
                      function: {
                        name: 'lookup_user',
                        arguments: '{"userId": "u123"}',
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          };
        }
        // Second turn: model receives tool answer and provides final text
        return {
          id: 'resp-step-2',
          model: 'agent-model',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'User u123 is Alice, active subscriber.',
              },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 35, completionTokens: 12, totalTokens: 47 },
        };
      }),
    };

    const client = new SinapsClient({ providers: [mockProvider] });
    client.mcp.registerTool({
      name: 'lookup_user',
      inputSchema: { type: 'object' },
      handler: ({ userId }: { userId: string }) => ({
        id: userId,
        name: 'Alice',
        status: 'active',
      }),
    });

    const stepEvents: number[] = [];
    const result = await client.runWithTools({
      model: 'agent-model',
      messages: [{ role: 'user', content: 'Who is user u123?' }],
      onStep: (step) => {
        stepEvents.push(step.stepIndex);
      },
    });

    expect(result.totalSteps).toBe(1);
    expect(stepEvents).toEqual([1]);
    expect(result.steps[0].toolCalls[0].function.name).toBe('lookup_user');
    expect(result.steps[0].toolResults[0].role).toBe('tool');
    expect(result.steps[0].toolResults[0].content).toContain('"name": "Alice"');

    expect(result.response.choices[0].message.content).toBe(
      'User u123 is Alice, active subscriber.',
    );
    expect(result.totalTokens).toBe(77); // 30 + 47
    // Full message history should contain: user, assistant(tool_calls), tool(result), assistant(final)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[2].role).toBe('tool');
    expect(result.messages[3].role).toBe('assistant');
  });

  it('should respect maxSteps limit when model is stuck in continuous tool calling', async () => {
    const mockProvider: Provider = {
      id: 'mock-llm',
      name: 'MockLLM',
      generateContent: vi.fn().mockResolvedValue({
        id: 'resp-loop',
        model: 'loop-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_loop',
                  type: 'function',
                  function: { name: 'keep_going', arguments: '{}' },
                },
              ],
            },
            finishReason: 'tool_calls',
          },
        ],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    };

    const client = new SinapsClient({ providers: [mockProvider] });
    client.mcp.registerTool({
      name: 'keep_going',
      inputSchema: { type: 'object' },
      handler: () => 'ok',
    });

    const result = await client.runWithTools({
      model: 'loop-model',
      messages: [{ role: 'user', content: 'Loop forever' }],
      maxSteps: 3,
    });

    expect(result.totalSteps).toBe(3);
    expect(result.steps).toHaveLength(3);
    expect(mockProvider.generateContent).toHaveBeenCalledTimes(3);
  });

  it('should abort agent loop immediately if signal is aborted', async () => {
    const mockProvider: Provider = {
      id: 'mock-llm',
      name: 'MockLLM',
      generateContent: vi.fn(),
    };

    const client = new SinapsClient({ providers: [mockProvider] });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.runWithTools({
        model: 'any-model',
        messages: [{ role: 'user', content: 'test' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('The user aborted a request.');
    expect(mockProvider.generateContent).not.toHaveBeenCalled();
  });

  it('should compute totalCostUsd and pass toolTimeoutMs to bridge', async () => {
    const mockProvider: Provider = {
      id: 'mock-llm',
      name: 'MockLLM',
      generateContent: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'resp-cost-1',
          model: 'm',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_timed',
                    type: 'function',
                    function: { name: 'timed_action', arguments: '{}' },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        })
        .mockResolvedValueOnce({
          id: 'resp-cost-2',
          model: 'm',
          choices: [
            {
              message: { role: 'assistant', content: 'finished.' },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 15, completionTokens: 5, totalTokens: 20 },
        }),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    client.mcp.registerTool({
      name: 'timed_action',
      inputSchema: { type: 'object' },
      handler: async () => 'action completed',
    });

    const result = await client.runWithTools({
      model: 'm',
      messages: [{ role: 'user', content: 'do action' }],
      toolTimeoutMs: 500,
    });

    expect(result.totalSteps).toBe(1);
    expect(result.response.choices[0].message.content).toBe('finished.');
    expect(result.totalCostUsd).toBeDefined();
    expect(result.totalCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('streams multi-step tool-calling loop via client.runWithToolsStream() with fragmented tool arguments', async () => {
    let callTurn = 0;
    const mockProvider: Provider = {
      id: 'stream-agent-p',
      name: 'StreamAgentProvider',
      promptCostPer1k: 0.001,
      completionCostPer1k: 0.002,
      generateContent: vi.fn().mockImplementation(async function* () {
        callTurn++;
        if (callTurn === 1) {
          yield {
            id: 's1-1',
            model: 'm-stream',
            choices: [
              {
                delta: {
                  role: 'assistant',
                  reasoning_content: 'Thinking about weather...',
                },
                finishReason: null,
              },
            ],
          };
          yield {
            id: 's1-2',
            model: 'm-stream',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_w1',
                      type: 'function',
                      function: {
                        name: 'lookup_weather',
                        arguments: '{"city":"Jak',
                      },
                    },
                  ],
                },
                finishReason: null,
              },
            ],
          };
          yield {
            id: 's1-3',
            model: 'm-stream',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: 'arta"}',
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          };
        } else {
          yield {
            id: 's2-1',
            model: 'm-stream',
            choices: [
              {
                delta: {
                  role: 'assistant',
                  content: 'The weather in Jakarta is ',
                },
                finishReason: null,
              },
            ],
          };
          yield {
            id: 's2-2',
            model: 'm-stream',
            choices: [
              {
                delta: {
                  content: '31°C and sunny.',
                },
                finishReason: 'stop',
              },
            ],
            usage: { promptTokens: 35, completionTokens: 15, totalTokens: 50 },
          };
        }
      }),
    };

    const client = new SinapsClient({
      providers: [mockProvider],
    });

    client.mcp.registerTool({
      name: 'lookup_weather',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      handler: async (args) => ({
        city: args.city,
        tempC: 31,
        condition: 'Sunny',
      }),
    });

    const events: string[] = [];
    const textDeltas: string[] = [];
    const reasoningDeltas: string[] = [];
    let finalDoneResult: unknown;

    for await (const ev of client.runWithToolsStream({
      model: 'm-stream',
      messages: [{ role: 'user', content: 'Weather in Jakarta?' }],
    })) {
      events.push(ev.type);
      if (ev.type === 'text-delta') textDeltas.push(ev.textDelta);
      if (ev.type === 'reasoning-delta')
        reasoningDeltas.push(ev.reasoningDelta);
      if (ev.type === 'done') finalDoneResult = ev.result;
    }

    expect(events).toEqual([
      'step-start',
      'reasoning-delta',
      'tool-call-start',
      'tool-call-result',
      'step-finish',
      'step-start',
      'text-delta',
      'text-delta',
      'done',
    ]);
    expect(reasoningDeltas.join('')).toBe('Thinking about weather...');
    expect(textDeltas.join('')).toBe(
      'The weather in Jakarta is 31°C and sunny.',
    );
    expect(finalDoneResult).toBeDefined();
    const res = finalDoneResult as { totalSteps: number; totalTokens: number };
    expect(res.totalSteps).toBe(1);
    expect(res.totalTokens).toBe(80);
  });

  describe('coerceToolArguments and Self-Healing hints', () => {
    it('coerces string numbers, booleans, and JSON strings into typed values', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' },
          page: { type: 'integer' },
          active: { type: 'boolean' },
          filters: { type: 'object' },
        },
      };

      const raw = {
        limit: '50',
        page: '2',
        active: 'true',
        filters: '{"status":"published"}',
      };

      const coerced = coerceToolArguments(raw, schema);

      expect(coerced.limit).toBe(50);
      expect(coerced.page).toBe(2);
      expect(coerced.active).toBe(true);
      expect(coerced.filters).toEqual({ status: 'published' });
    });

    it('attaches diagnostic selfHealingHint when tool execution throws', async () => {
      const bridge = new McpToolBridge();
      bridge.registerTool({
        name: 'validate_payment',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
          },
        },
        handler: () => {
          throw new Error('Insufficient balance');
        },
      });

      const res = await bridge.executeToolCall({
        id: 'c1',
        type: 'function',
        function: { name: 'validate_payment', arguments: '{"amount": 100}' },
      });

      expect(res.isError).toBe(true);
      expect(res.selfHealingHint).toBeDefined();
      expect(res.selfHealingHint).toContain('validate_payment');
      expect(res.selfHealingHint).toContain('Insufficient balance');
      expect(res.selfHealingHint).toContain('amount');
    });
  });
});
