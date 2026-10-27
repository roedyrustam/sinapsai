import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type {
  CreateChatCompletionRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { AgentSwarm, SwarmContext } from './AgentSwarm.js';
import { McpToolBridge } from './McpBridge.js';
import { SinapsClient } from './SinapsClient.js';

describe('SwarmContext', () => {
  it('manages key-value state correctly', () => {
    const ctx = new SwarmContext({ initial: 'test' });
    expect(ctx.get('initial')).toBe('test');
    expect(ctx.has('initial')).toBe(true);

    ctx.set('user_id', 12345);
    expect(ctx.get<number>('user_id')).toBe(12345);

    expect(ctx.getAll()).toEqual({ initial: 'test', user_id: 12345 });
    expect(ctx.toPromptSection()).toContain('[SHARED SWARM CONTEXT]:');
    expect(ctx.toPromptSection()).toContain('"user_id": 12345');

    ctx.delete('initial');
    expect(ctx.has('initial')).toBe(false);

    ctx.clear();
    expect(ctx.getAll()).toEqual({});
    expect(ctx.toPromptSection()).toBe('');
  });
});

describe('AgentSwarm', () => {
  const createMockProvider = (
    responses: (UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>)[],
  ): Provider => {
    let callIdx = 0;
    return {
      id: 'mock-provider',
      name: 'Mock Provider',
      generateContent: vi.fn(async (_req: CreateChatCompletionRequest) => {
        const res = responses[callIdx] || responses[responses.length - 1];
        callIdx++;
        return res as UnifiedApiResponse;
      }),
      generateEmbedding: vi.fn(),
    };
  };

  it('validates agent configurations on initialization', () => {
    const client = new SinapsClient({
      providers: [createMockProvider([])],
    });

    expect(() => new AgentSwarm(client, { agents: [] })).toThrow(
      'requires at least one specialist agent',
    );

    expect(
      () =>
        new AgentSwarm(client, {
          agents: [
            {
              id: 'a1',
              name: 'Agent 1',
              role: 'Tester',
              instructions: 'Do tests',
            },
          ],
          defaultAgentId: 'non_existent',
        }),
    ).toThrow('not in the registered agents list');
  });

  it('exports A2A Agent Cards compliant with /.well-known/agent.json', () => {
    const client = new SinapsClient({
      providers: [createMockProvider([])],
    });

    const swarm = client.swarm({
      agents: [
        {
          id: 'architect',
          name: 'System Architect',
          role: 'Architectural Designer',
          instructions: 'Design resilient system blueprints',
          handoffs: ['reviewer'],
          skills: [
            {
              id: 'blueprint-gen',
              name: 'Blueprint Generation',
              description: 'Generates Mermaid class diagrams',
              tags: ['architecture', 'design'],
            },
          ],
        },
        {
          id: 'reviewer',
          name: 'Security Reviewer',
          role: 'AppSec Specialist',
          instructions: 'Review blueprints for vulnerabilities',
        },
      ],
    });

    expect(swarm.listAgents()).toHaveLength(2);
    expect(swarm.getAgent('architect')?.name).toBe('System Architect');

    const cards = swarm.exportAgentCards('https://api.sinapsai.internal');
    expect(cards).toHaveLength(2);

    const architectCard = cards.find((c) => c.name === 'System Architect');
    expect(architectCard).toBeDefined();
    expect(architectCard?.url).toBe(
      'https://api.sinapsai.internal/agents/architect',
    );
    expect(architectCard?.capabilities.streaming).toBe(true);
    expect(architectCard?.capabilities.handoffs).toBe(true);
    expect(architectCard?.skills[0].id).toBe('blueprint-gen');

    const reviewerCard = cards.find((c) => c.name === 'Security Reviewer');
    expect(reviewerCard?.capabilities.handoffs).toBe(false);
  });

  it('executes a single-agent task directly to completion (non-streaming)', async () => {
    const mockRes: UnifiedApiResponse = {
      id: 'res-1',
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Here is your direct answer.',
          },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };

    const provider = createMockProvider([mockRes]);
    const client = new SinapsClient({ providers: [provider] });

    const swarm = client.swarm({
      agents: [
        {
          id: 'solver',
          name: 'Problem Solver',
          role: 'General assistant',
          instructions: 'Answer user queries clearly',
        },
      ],
    });

    const result = await swarm.run({ task: 'What is 2+2?' });

    expect(result.content).toBe('Here is your direct answer.');
    expect(result.finalAgentId).toBe('solver');
    expect(result.totalSteps).toBe(1);
    expect(result.totalHandoffs).toBe(0);
    expect(result.agentSteps.solver).toBe(1);
  });

  it('executes an autonomous delegation handoff between specialists (non-streaming)', async () => {
    // 1st call (triage): delegates to coder with context_updates
    const triageRes: UnifiedApiResponse = {
      id: 'res-triage',
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Transferring to the coding specialist...',
            tool_calls: [
              {
                id: 'call_handoff_1',
                type: 'function',
                function: {
                  name: 'transfer_to_coder',
                  arguments: JSON.stringify({
                    reason: 'Task requires TypeScript implementation',
                    context_updates: {
                      language: 'typescript',
                      target: 'Node.js',
                    },
                  }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
    };

    // 2nd call (coder): receives updated context and answers
    const coderRes: UnifiedApiResponse = {
      id: 'res-coder',
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'export function hello(): string { return "world"; }',
          },
          finishReason: 'stop',
        },
      ],
    };

    const provider = createMockProvider([triageRes, coderRes]);
    const client = new SinapsClient({ providers: [provider] });

    const swarm = client.swarm({
      agents: [
        {
          id: 'triage',
          name: 'Triage Agent',
          role: 'Requirement Classifier',
          instructions:
            'Classify tasks and delegate to appropriate specialist.',
          handoffs: ['coder'],
        },
        {
          id: 'coder',
          name: 'Senior Coder',
          role: 'Fullstack Engineer',
          instructions: 'Write production-ready code.',
        },
      ],
    });

    const result = await swarm.run({
      task: 'Write a TypeScript function to say hello.',
    });

    expect(result.content).toBe(
      'export function hello(): string { return "world"; }',
    );
    expect(result.finalAgentId).toBe('coder');
    expect(result.totalSteps).toBe(2);
    expect(result.totalHandoffs).toBe(1);
    expect(result.agentSteps.triage).toBe(1);
    expect(result.agentSteps.coder).toBe(1);
    expect(result.sharedContext.language).toBe('typescript');
    expect(result.sharedContext.target).toBe('Node.js');

    // Verify history contains handoff tool message
    const toolMsg = result.history.find(
      (m) => m.role === 'tool' && m.name === 'transfer_to_coder',
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('transferred');
  });

  it('safely breaks if maxHandoffs threshold is reached (loop protection)', async () => {
    // Both agents keep handing off to each other endlessly
    const makeHandoff = (target: string): UnifiedApiResponse => ({
      id: `res-${target}`,
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: `Sending to ${target}`,
            tool_calls: [
              {
                id: `call_${Date.now()}`,
                type: 'function',
                function: {
                  name: `transfer_to_${target}`,
                  arguments: JSON.stringify({ reason: 'Loop testing' }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
    });

    const responses = [
      makeHandoff('agent_b'),
      makeHandoff('agent_a'),
      makeHandoff('agent_b'),
      makeHandoff('agent_a'),
    ];

    const provider = createMockProvider(responses);
    const client = new SinapsClient({ providers: [provider] });

    const swarm = client.swarm({
      maxHandoffs: 2,
      agents: [
        {
          id: 'agent_a',
          name: 'Agent A',
          role: 'Ping',
          instructions: 'Ping agent b',
          handoffs: ['agent_b'],
        },
        {
          id: 'agent_b',
          name: 'Agent B',
          role: 'Pong',
          instructions: 'Pong agent a',
          handoffs: ['agent_a'],
        },
      ],
    });

    const result = await swarm.run({ task: 'Ping pong loop test' });
    expect(result.totalHandoffs).toBeGreaterThanOrEqual(2);
  });

  it('runs streaming swarm emitting agent-start, text-delta, handoff, and done events', async () => {
    // Create async stream generators for streaming turns
    async function* makeTriageStream(): AsyncIterable<UnifiedApiStreamChunk> {
      yield {
        id: 'chunk-triage-1',
        model: 'default',
        choices: [
          {
            delta: {
              content: 'Delegating to developer...',
              tool_calls: [
                {
                  index: 0,
                  id: 'tc_stream_1',
                  function: {
                    name: 'transfer_to_dev',
                    arguments: JSON.stringify({
                      reason: 'Development request',
                      context_updates: { sprint: 'v2.11.0' },
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
    }

    async function* makeDevStream(): AsyncIterable<UnifiedApiStreamChunk> {
      yield {
        id: 'chunk-dev-1',
        model: 'default',
        choices: [
          {
            delta: {
              content: 'Code delivered successfully.',
            },
            finishReason: 'stop',
          },
        ],
      };
    }

    let streamTurn = 0;
    const provider: Provider = {
      id: 'stream-mock',
      name: 'Stream Mock Provider',
      generateContent: vi.fn(async () => {
        streamTurn++;
        if (streamTurn === 1) return makeTriageStream();
        return makeDevStream();
      }),
      generateEmbedding: vi.fn(),
    };

    const client = new SinapsClient({ providers: [provider] });
    const swarm = client.swarm({
      agents: [
        {
          id: 'coordinator',
          name: 'Coordinator',
          role: 'Project Coordinator',
          instructions: 'Triage work',
          handoffs: ['dev'],
        },
        {
          id: 'dev',
          name: 'Core Developer',
          role: 'Implementer',
          instructions: 'Build features',
        },
      ],
    });

    const events: string[] = [];
    let finalResultText = '';

    for await (const event of swarm.runStream({
      task: 'Build new feature in sprint v2.11.0',
    })) {
      events.push(event.type);
      if (event.type === 'text-delta') {
        finalResultText += event.textDelta;
      }
    }

    expect(events).toContain('agent-start');
    expect(events).toContain('tool-call-start');
    expect(events).toContain('handoff');
    expect(events).toContain('text-delta');
    expect(events).toContain('done');
    expect(finalResultText).toContain('Code delivered successfully.');
  });

  it('integrates with client.mcp for regular tool execution prior to handoff', async () => {
    const mcpBridge = new McpToolBridge();
    mcpBridge.registerTool({
      name: 'calculate_discount',
      description: 'Calculates subscription discount',
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      handler: async (args: { amount: number }) => {
        return { discount: args.amount * 0.2 };
      },
    });

    // 1st call: uses calculate_discount
    const toolCallRes: UnifiedApiResponse = {
      id: 'res-calc',
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_calc_1',
                type: 'function',
                function: {
                  name: 'calculate_discount',
                  arguments: JSON.stringify({ amount: 100 }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
    };

    // 2nd call: provides final discount answer
    const finalRes: UnifiedApiResponse = {
      id: 'res-final',
      model: 'default',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'The 20% discount on $100 is $20.',
          },
          finishReason: 'stop',
        },
      ],
    };

    const provider = createMockProvider([toolCallRes, finalRes]);
    const client = new SinapsClient({
      providers: [provider],
      mcpBridge,
    });

    const swarm = client.swarm({
      agents: [
        {
          id: 'billing_specialist',
          name: 'Billing Specialist',
          role: 'FinOps & Pricing Agent',
          instructions: 'Use pricing tools to calculate discount rates.',
        },
      ],
    });

    const result = await swarm.run({ task: 'Calculate discount on $100' });
    expect(result.content).toBe('The 20% discount on $100 is $20.');
    expect(result.totalSteps).toBe(2);
    expect(result.finalAgentId).toBe('billing_specialist');
  });
});
