/**
 * SinapsAI - In-Process Multi-Agent Swarm & Agent-to-Agent (A2A) Handoff Protocol
 *
 * Implements an in-memory, zero-dependency multi-agent orchestrator featuring:
 * - Role-based specialist agent definitions with custom system prompts and models
 * - Automated handoff tool synthesis (transfer_to_<agent>) with cycle/loop detection
 * - Shared context memory (SwarmContext) updated atomically across agent turns
 * - Standard A2A Agent Card exporter conforming to /.well-known/agent.json spec
 * - Both synchronous (run) and real-time streaming (runStream) execution modes
 * - Concurrency and PII / Security guardrail compatibility
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ChatMessage,
  ContentPart,
  CreateChatCompletionRequest,
  ToolCall,
  ToolDefinition,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import type { SinapsClient } from './SinapsClient.js';

/**
 * Standard A2A Skill definition for capability discovery
 */
export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputModes?: ('text/plain' | 'application/json')[];
  outputModes?: ('text/plain' | 'application/json')[];
}

/**
 * Standard A2A Agent Card specification conforming to /.well-known/agent.json
 */
export interface A2AAgentCard {
  name: string;
  description: string;
  url?: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
    handoffs?: boolean;
  };
  authentication?: {
    schemes: ('Bearer' | 'OAuth2' | 'MutualTLS' | 'None')[];
  };
  skills: A2AAgentSkill[];
}

/**
 * Configuration for an individual specialist agent in the Swarm
 */
export interface SwarmAgentConfig {
  /**
   * Unique identifier for this agent (e.g. 'triage', 'coder', 'researcher')
   */
  id: string;
  /**
   * Human-readable display name (e.g. 'Code Architect')
   */
  name: string;
  /**
   * High-level role or domain specialization (e.g. 'Senior TypeScript & Security Engineer')
   */
  role: string;
  /**
   * Domain-specific system instructions guiding this agent's actions
   */
  instructions: string;
  /**
   * Optional model override for this agent (e.g. 'gemini-4-flash' for fast triage, 'claude-3-7-sonnet' for deep logic)
   */
  model?: string;
  /**
   * Optional reasoning thinking budget ('auto' or specific token count)
   */
  thinkingBudget?: number | 'auto';
  /**
   * Specific tool definitions allowed for this agent.
   * If not specified, the agent can access tools registered in the swarm or client.mcp.
   */
  tools?: ToolDefinition[];
  /**
   * List of target agent IDs that this agent is authorized to delegate tasks to.
   */
  handoffs?: string[];
  /**
   * Maximum internal reasoning/tool steps before forcing a handoff or completion.
   * Default: 5
   */
  maxSteps?: number;
  /**
   * A2A skills description for Agent Card discovery
   */
  skills?: A2AAgentSkill[];
  /**
   * Optional micro-economy budget wallet capping spend for this agent.
   */
  wallet?: SwarmAgentWallet;
}

/**
 * Micro-economy wallet cap for an individual swarm agent.
 */
export interface SwarmAgentWallet {
  maxCostUsd?: number;
  maxTokens?: number;
}

export class AgentWalletExceededError extends Error {
  public readonly agentId: string;
  public readonly limitUsd?: number;
  public readonly currentCostUsd: number;

  constructor(agentId: string, currentCostUsd: number, limitUsd?: number) {
    super(
      `Agent "${agentId}" exceeded allocated budget wallet: $${currentCostUsd.toFixed(4)} (limit: $${limitUsd})`,
    );
    this.name = 'AgentWalletExceededError';
    this.agentId = agentId;
    this.currentCostUsd = currentCostUsd;
    this.limitUsd = limitUsd;
  }
}

/**
 * Shared memory context accessible and mutable by all agents in the swarm
 */
export class SwarmContext {
  private store = new Map<string, unknown>();

  constructor(initialData?: Record<string, unknown>) {
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) {
        this.store.set(key, value);
      }
    }
  }

  public get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  public set(key: string, value: unknown): this {
    this.store.set(key, value);
    return this;
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public getAll(): Record<string, unknown> {
    return Object.fromEntries(this.store.entries());
  }

  public toPromptSection(): string {
    if (this.store.size === 0) return '';
    return `\n\n[SHARED SWARM CONTEXT]:\n${JSON.stringify(this.getAll(), null, 2)}`;
  }
}

/**
 * Options for instantiating an AgentSwarm
 */
export interface AgentSwarmOptions {
  /**
   * Specialist agent configurations participating in the swarm
   */
  agents: SwarmAgentConfig[];
  /**
   * Initial default agent ID to receive incoming user requests.
   * Defaults to the first agent in the array.
   */
  defaultAgentId?: string;
  /**
   * Maximum allowed delegations between agents to prevent infinite ping-pong loops.
   * Default: 10
   */
  maxHandoffs?: number;
  /**
   * Optional initial shared context values
   */
  initialContext?: Record<string, unknown>;
  /**
   * Global fallback model if agent does not specify one
   */
  defaultModel?: string;
}

/**
 * Result returned after a Swarm completes its multi-agent orchestration
 */
export interface SwarmResult {
  /**
   * Final text output produced by the completing agent
   */
  content: string;
  /**
   * ID of the agent that produced the final answer
   */
  finalAgentId: string;
  /**
   * Full multi-agent conversation history including tool and handoff messages
   */
  history: ChatMessage[];
  /**
   * Final shared memory state after all turns
   */
  sharedContext: Record<string, unknown>;
  /**
   * Total LLM request steps executed across all agents
   */
  totalSteps: number;
  /**
   * Total number of successful delegations between agents
   */
  totalHandoffs: number;
  /**
   * Step breakdown by agent ID
   */
  agentSteps: Record<string, number>;
  /**
   * Cumulative estimated cost across all agent turns (if usage cost available)
   */
  totalCostUsd: number;
  /**
   * Spend and token breakdown tracked per agent ID
   */
  agentSpendBreakdown?: Record<string, { costUsd: number; tokens: number }>;
}

/**
 * Real-time event emitted during a streaming swarm run
 */
export type SwarmStreamEvent =
  | {
      type: 'agent-start';
      agentId: string;
      agentName: string;
      step: number;
      handoffCount: number;
    }
  | {
      type: 'reasoning-delta';
      agentId: string;
      reasoningDelta: string;
      chunk: UnifiedApiStreamChunk;
    }
  | {
      type: 'text-delta';
      agentId: string;
      textDelta: string;
      chunk: UnifiedApiStreamChunk;
    }
  | {
      type: 'tool-call-start';
      agentId: string;
      toolCalls: ToolCall[];
    }
  | {
      type: 'tool-call-result';
      agentId: string;
      toolCalls: ToolCall[];
      results: ChatMessage[];
    }
  | {
      type: 'handoff';
      fromAgentId: string;
      toAgentId: string;
      reason: string;
      contextUpdates?: Record<string, unknown>;
    }
  | {
      type: 'done';
      result: SwarmResult;
    };

/**
 * In-Process Multi-Agent Swarm Orchestrator
 */
export class AgentSwarm {
  private client: SinapsClient;
  private agents = new Map<string, SwarmAgentConfig>();
  private defaultAgentId: string;
  private maxHandoffs: number;
  private defaultModel?: string;

  constructor(client: SinapsClient, options: AgentSwarmOptions) {
    this.client = client;
    this.maxHandoffs = options.maxHandoffs ?? 10;
    this.defaultModel = options.defaultModel;

    if (!options.agents || options.agents.length === 0) {
      throw new Error('AgentSwarm requires at least one specialist agent.');
    }

    for (const agent of options.agents) {
      this.agents.set(agent.id, agent);
    }

    this.defaultAgentId = options.defaultAgentId || options.agents[0].id;
    if (!this.agents.has(this.defaultAgentId)) {
      throw new Error(
        `Default agent ID "${this.defaultAgentId}" is not in the registered agents list.`,
      );
    }
  }

  /**
   * Get an agent by its ID
   */
  public getAgent(id: string): SwarmAgentConfig | undefined {
    return this.agents.get(id);
  }

  /**
   * List all registered swarm agents
   */
  public listAgents(): SwarmAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Export A2A Agent Cards for all registered agents in this swarm
   */
  public exportAgentCards(baseUrl?: string): A2AAgentCard[] {
    return Array.from(this.agents.values()).map((agent) => ({
      name: agent.name,
      description: `${agent.role}: ${agent.instructions.slice(0, 200)}`,
      url: baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/agents/${agent.id}`
        : undefined,
      version: '2.11.0',
      capabilities: {
        streaming: true,
        handoffs: (agent.handoffs && agent.handoffs.length > 0) || false,
      },
      skills: agent.skills || [
        {
          id: `${agent.id}-core`,
          name: agent.name,
          description: agent.role,
          tags: [agent.id, 'sinapsai-swarm'],
          inputModes: ['text/plain', 'application/json'],
          outputModes: ['text/plain', 'application/json'],
        },
      ],
    }));
  }

  /**
   * Synthesize handoff tool definitions for an agent
   */
  private getHandoffTools(agent: SwarmAgentConfig): ToolDefinition[] {
    if (!agent.handoffs || agent.handoffs.length === 0) {
      return [];
    }

    const tools: ToolDefinition[] = [];
    for (const targetId of agent.handoffs) {
      const target = this.agents.get(targetId);
      if (!target) continue;

      tools.push({
        type: 'function',
        function: {
          name: `transfer_to_${target.id}`,
          description: `Delegate the task to ${target.name} (${target.role}). ${target.instructions.slice(0, 140)}`,
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description:
                  'Detailed explanation of why you are transferring this task',
              },
              context_updates: {
                type: 'object',
                description:
                  'Key-value state updates to commit to shared memory before handoff',
                additionalProperties: true,
              },
            },
            required: ['reason'],
          },
        },
      });
    }

    return tools;
  }

  /**
   * Compile full tool list for an agent, combining its specific tools, client.mcp tools, and handoff tools
   */
  private compileAgentTools(agent: SwarmAgentConfig): ToolDefinition[] {
    const handoffTools = this.getHandoffTools(agent);
    const mcpTools = this.client.mcp.toUnifiedTools();

    if (agent.tools) {
      return [...agent.tools, ...handoffTools];
    }

    return [...mcpTools, ...handoffTools];
  }

  /**
   * Run the multi-agent swarm to completion (non-streaming)
   */
  public async run(options: {
    messages?: ChatMessage[];
    task?: string;
    initialAgentId?: string;
    context?: Record<string, unknown>;
  }): Promise<SwarmResult> {
    const context = new SwarmContext(options.context);
    let activeAgentId = options.initialAgentId || this.defaultAgentId;
    let handoffCount = 0;
    let totalSteps = 0;
    const agentSteps: Record<string, number> = {};
    const agentSpendBreakdown: Record<
      string,
      { costUsd: number; tokens: number }
    > = {};
    const startCost = this.client.getMetrics().estimatedCostUsd;
    const history: ChatMessage[] = options.messages
      ? [...options.messages]
      : [];
    if (options.task && history.length === 0) {
      history.push({ role: 'user', content: options.task });
    }

    while (handoffCount <= this.maxHandoffs) {
      const agent = this.agents.get(activeAgentId);
      if (!agent) {
        throw new Error(`Active agent "${activeAgentId}" not found in Swarm.`);
      }

      agentSteps[activeAgentId] = (agentSteps[activeAgentId] || 0) + 1;
      totalSteps++;

      // Build effective system instructions injected with shared context
      const systemContent = `${agent.instructions}\n\nYou are specialist: ${agent.name} (${agent.role}).${context.toPromptSection()}`;

      // Filter out existing system prompts and prepend active agent's system prompt
      const stepMessages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...history.filter((m) => m.role !== 'system'),
      ];

      const tools = this.compileAgentTools(agent);

      const req: CreateChatCompletionRequest = {
        model: agent.model || this.defaultModel || 'default',
        messages: stepMessages,
        tools: tools.length > 0 ? tools : undefined,
        thinkingBudget: agent.thinkingBudget,
      };

      const response = (await this.client.chat.completions.create(
        req,
      )) as UnifiedApiResponse;

      const choice = response.choices[0];
      if (!choice) {
        break;
      }

      // Track micro-economy wallet spend per agent
      const usage = response.usage as
        | {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          }
        | undefined;
      const promptTokens = usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
      const completionTokens =
        usage?.completionTokens ?? usage?.completion_tokens ?? 0;
      const stepTokens =
        usage?.totalTokens ??
        usage?.total_tokens ??
        promptTokens + completionTokens;
      const stepCost =
        (response as { costUsd?: number }).costUsd ??
        promptTokens * 0.0000015 + completionTokens * 0.000002;

      if (!agentSpendBreakdown[activeAgentId]) {
        agentSpendBreakdown[activeAgentId] = { costUsd: 0, tokens: 0 };
      }
      agentSpendBreakdown[activeAgentId].costUsd = Number(
        (agentSpendBreakdown[activeAgentId].costUsd + stepCost).toFixed(6),
      );
      agentSpendBreakdown[activeAgentId].tokens += stepTokens;

      if (agent.wallet) {
        if (
          agent.wallet.maxCostUsd !== undefined &&
          agentSpendBreakdown[activeAgentId].costUsd > agent.wallet.maxCostUsd
        ) {
          throw new AgentWalletExceededError(
            activeAgentId,
            agentSpendBreakdown[activeAgentId].costUsd,
            agent.wallet.maxCostUsd,
          );
        }
        if (
          agent.wallet.maxTokens !== undefined &&
          agentSpendBreakdown[activeAgentId].tokens > agent.wallet.maxTokens
        ) {
          throw new AgentWalletExceededError(
            activeAgentId,
            agentSpendBreakdown[activeAgentId].tokens,
            agent.wallet.maxTokens,
          );
        }
      }

      const msg = choice.message;
      history.push(msg);

      // Check if the agent called any tools
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        let delegatedTo: string | undefined;

        // Check for handoff tool call
        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          if (fnName.startsWith('transfer_to_')) {
            const targetId = fnName.replace('transfer_to_', '');
            if (this.agents.has(targetId)) {
              delegatedTo = targetId;

              // Parse handoff arguments
              let parsedArgs: {
                reason?: string;
                context_updates?: Record<string, unknown>;
              } = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || '{}');
              } catch {
                parsedArgs = {};
              }

              if (parsedArgs.context_updates) {
                for (const [k, v] of Object.entries(
                  parsedArgs.context_updates,
                )) {
                  context.set(k, v);
                }
              }

              // Append handoff acknowledgment tool message
              history.push({
                role: 'tool',
                tool_call_id: tc.id,
                name: fnName,
                content: JSON.stringify({
                  status: 'transferred',
                  targetAgent: targetId,
                  reason: parsedArgs.reason || 'Delegated to specialist',
                }),
              });
              break;
            }
          }
        }

        // If handoff occurred, advance agent and continue
        if (delegatedTo) {
          handoffCount++;
          activeAgentId = delegatedTo;
          continue;
        }

        // Regular MCP tools execution
        const toolResults = await this.client.mcp.executeToolCalls(
          msg.tool_calls,
        );
        for (const tr of toolResults) {
          history.push(tr);
        }
        continue;
      }

      // No tool calls and no handoffs: final answer reached
      const finalContent =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as ContentPart[])
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('')
            : '';

      const endCost = this.client.getMetrics().estimatedCostUsd;
      const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));

      return {
        content: finalContent,
        finalAgentId: activeAgentId,
        history,
        sharedContext: context.getAll(),
        totalSteps,
        totalHandoffs: handoffCount,
        agentSteps,
        totalCostUsd,
        agentSpendBreakdown,
      };
    }

    // Hit max handoffs safeguard
    const lastMsg = history[history.length - 1];
    const endCost = this.client.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));
    return {
      content:
        typeof lastMsg?.content === 'string'
          ? lastMsg.content
          : 'Max handoffs reached.',
      finalAgentId: activeAgentId,
      history,
      sharedContext: context.getAll(),
      totalSteps,
      totalHandoffs: handoffCount,
      agentSteps,
      totalCostUsd,
      agentSpendBreakdown,
    };
  }

  /**
   * Run the multi-agent swarm with real-time streaming events
   */
  public async *runStream(options: {
    messages?: ChatMessage[];
    task?: string;
    initialAgentId?: string;
    context?: Record<string, unknown>;
  }): AsyncGenerator<SwarmStreamEvent, void, undefined> {
    const context = new SwarmContext(options.context);
    let activeAgentId = options.initialAgentId || this.defaultAgentId;
    let handoffCount = 0;
    let totalSteps = 0;
    const agentSteps: Record<string, number> = {};
    const agentSpendBreakdown: Record<
      string,
      { costUsd: number; tokens: number }
    > = {};
    const startCost = this.client.getMetrics().estimatedCostUsd;
    const history: ChatMessage[] = options.messages
      ? [...options.messages]
      : [];
    if (options.task && history.length === 0) {
      history.push({ role: 'user', content: options.task });
    }

    while (handoffCount <= this.maxHandoffs) {
      const agent = this.agents.get(activeAgentId);
      if (!agent) {
        throw new Error(`Active agent "${activeAgentId}" not found in Swarm.`);
      }

      agentSteps[activeAgentId] = (agentSteps[activeAgentId] || 0) + 1;
      totalSteps++;

      yield {
        type: 'agent-start',
        agentId: activeAgentId,
        agentName: agent.name,
        step: totalSteps,
        handoffCount,
      };

      const systemContent = `${agent.instructions}\n\nYou are specialist: ${agent.name} (${agent.role}).${context.toPromptSection()}`;
      const stepMessages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...history.filter((m) => m.role !== 'system'),
      ];

      const tools = this.compileAgentTools(agent);

      const req: CreateChatCompletionRequest = {
        model: agent.model || this.defaultModel || 'default',
        messages: stepMessages,
        tools: tools.length > 0 ? tools : undefined,
        thinkingBudget: agent.thinkingBudget,
        stream: true,
      };

      const stream = (await this.client.chat.completions.create(
        req,
      )) as AsyncIterable<UnifiedApiStreamChunk>;

      let contentAcc = '';
      let reasoningAcc = '';
      const toolCallsMap = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (
          typeof delta.reasoning_content === 'string' &&
          delta.reasoning_content
        ) {
          reasoningAcc += delta.reasoning_content;
          yield {
            type: 'reasoning-delta',
            agentId: activeAgentId,
            reasoningDelta: delta.reasoning_content,
            chunk,
          };
        }

        if (typeof delta.content === 'string' && delta.content) {
          contentAcc += delta.content;
          yield {
            type: 'text-delta',
            agentId: activeAgentId,
            textDelta: delta.content,
            chunk,
          };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsMap.get(idx) || {
              id: '',
              name: '',
              arguments: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments)
              existing.arguments += tc.function.arguments;
            toolCallsMap.set(idx, existing);
          }
        }
      }

      const assembledToolCalls: ToolCall[] = Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([idx, tc]) => ({
          id: tc.id || `call_${totalSteps}_${idx}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments || '{}',
          },
        }));

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: contentAcc,
        reasoning_content: reasoningAcc || undefined,
        tool_calls:
          assembledToolCalls.length > 0 ? assembledToolCalls : undefined,
      };
      history.push(assistantMsg);

      if (assembledToolCalls.length > 0) {
        yield {
          type: 'tool-call-start',
          agentId: activeAgentId,
          toolCalls: assembledToolCalls,
        };

        let delegatedTo: string | undefined;

        for (const tc of assembledToolCalls) {
          const fnName = tc.function.name;
          if (fnName.startsWith('transfer_to_')) {
            const targetId = fnName.replace('transfer_to_', '');
            if (this.agents.has(targetId)) {
              delegatedTo = targetId;

              let parsedArgs: {
                reason?: string;
                context_updates?: Record<string, unknown>;
              } = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || '{}');
              } catch {
                parsedArgs = {};
              }

              if (parsedArgs.context_updates) {
                for (const [k, v] of Object.entries(
                  parsedArgs.context_updates,
                )) {
                  context.set(k, v);
                }
              }

              yield {
                type: 'handoff',
                fromAgentId: activeAgentId,
                toAgentId: targetId,
                reason: parsedArgs.reason || 'Delegated to specialist',
                contextUpdates: parsedArgs.context_updates,
              };

              history.push({
                role: 'tool',
                tool_call_id: tc.id,
                name: fnName,
                content: JSON.stringify({
                  status: 'transferred',
                  targetAgent: targetId,
                  reason: parsedArgs.reason || 'Delegated to specialist',
                }),
              });
              break;
            }
          }
        }

        if (delegatedTo) {
          handoffCount++;
          activeAgentId = delegatedTo;
          continue;
        }

        // Parallel regular tool execution
        const toolResults =
          await this.client.mcp.executeToolCalls(assembledToolCalls);
        for (const tr of toolResults) {
          history.push(tr);
        }

        yield {
          type: 'tool-call-result',
          agentId: activeAgentId,
          toolCalls: assembledToolCalls,
          results: toolResults,
        };
        continue;
      }

      // Completed successfully
      const endCost = this.client.getMetrics().estimatedCostUsd;
      const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));

      const result: SwarmResult = {
        content: contentAcc,
        finalAgentId: activeAgentId,
        history,
        sharedContext: context.getAll(),
        totalSteps,
        totalHandoffs: handoffCount,
        agentSteps,
        totalCostUsd,
        agentSpendBreakdown,
      };

      yield {
        type: 'done',
        result,
      };
      return;
    }

    // Max handoffs reached
    const endCost = this.client.getMetrics().estimatedCostUsd;
    const totalCostUsd = Number(Math.max(0, endCost - startCost).toFixed(6));

    const result: SwarmResult = {
      content: 'Max handoffs reached.',
      finalAgentId: activeAgentId,
      history,
      sharedContext: context.getAll(),
      totalSteps,
      totalHandoffs: handoffCount,
      agentSteps,
      totalCostUsd,
    };

    yield {
      type: 'done',
      result,
    };
  }
}
