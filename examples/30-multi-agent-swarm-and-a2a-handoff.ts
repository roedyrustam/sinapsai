/**
 * Example 30: In-Process Multi-Agent Swarm & Agent-to-Agent (A2A) Handoff Protocol
 *
 * Demonstrates:
 * 1. Defining specialized role-based agents (Triage, Architect, Security Auditor).
 * 2. Automatic A2A handoff tool generation (`transfer_to_<agent>`).
 * 3. Shared memory context (`SwarmContext`) updated dynamically across handoffs.
 * 4. A2A Agent Card export conforming to `/.well-known/agent.json` spec.
 * 5. Both non-streaming (`swarm.run`) and real-time streaming (`swarm.runStream`) multi-agent swarms.
 */

import {
  type ChatMessage,
  type CreateChatCompletionRequest,
  McpToolBridge,
  type Provider,
  SinapsClient,
  type UnifiedApiResponse,
  type UnifiedApiStreamChunk,
} from '../src/index.js';

async function main() {
  console.log('=== 1. In-Process Multi-Agent Swarm & A2A Protocol Setup ===\n');

  // Set up an in-process MCP tool for calculating cryptographic budget
  const mcp = new McpToolBridge();
  mcp.registerTool({
    name: 'audit_crypto_entropy',
    description: 'Calculates entropy bits for cryptographic token generation',
    inputSchema: {
      type: 'object',
      properties: {
        tokenLength: {
          type: 'number',
          description: 'Length of generated token',
        },
      },
      required: ['tokenLength'],
    },
    handler: async (args: { tokenLength: number }) => {
      const entropy = args.tokenLength * 6; // approximate ~6 bits per base64 character
      return {
        entropyBits: entropy,
        status: entropy >= 128 ? 'SECURE' : 'WEAK_ENTROPY',
      };
    },
  });

  // Simulated provider handling multi-step agent turns with mock handoffs
  let turnIndex = 0;
  const mockProvider: Provider = {
    id: 'swarm-provider',
    name: 'Swarm Frontier Provider',
    generateContent: async (req: CreateChatCompletionRequest) => {
      turnIndex++;
      const lastMsg = req.messages[req.messages.length - 1];

      // If streaming was requested, return an async generator
      if (req.stream) {
        return (async function* () {
          if (turnIndex === 1) {
            yield {
              id: 'stream_1',
              model: req.model || 'frontier',
              choices: [
                {
                  delta: {
                    content:
                      'I will analyze your request and hand off to the System Architect...',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'tc_handoff_1',
                        type: 'function',
                        function: {
                          name: 'transfer_to_architect',
                          arguments: JSON.stringify({
                            reason:
                              'User needs enterprise architectural design',
                            context_updates: {
                              workload: 'Financial Settlement Gateway',
                              slaRequirement: '99.999%',
                            },
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            } as UnifiedApiStreamChunk;
          } else {
            yield {
              id: 'stream_2',
              model: req.model || 'frontier',
              choices: [
                {
                  delta: {
                    content:
                      'Architecture Blueprint: High-Availability Multi-Region Node.js Cluster with In-Process SinapsAI Circuit Breaker and Zero-Downtime Failover.',
                  },
                  finishReason: 'stop',
                },
              ],
            } as UnifiedApiStreamChunk;
          }
        })();
      }

      // Non-streaming turns
      if (turnIndex === 1) {
        // Turn 1: Triage hands off to architect
        return {
          id: 'res_1',
          model: req.model || 'frontier',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Classified requirement as high-availability architecture. Delegating...',
                tool_calls: [
                  {
                    id: 'tc_1',
                    type: 'function',
                    function: {
                      name: 'transfer_to_architect',
                      arguments: JSON.stringify({
                        reason: 'Architecture design required',
                        context_updates: {
                          tier: 'mission-critical',
                          database: 'Distributed Cloudflare D1 + Redis',
                        },
                      }),
                    },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
        } as UnifiedApiResponse;
      }

      if (turnIndex === 2) {
        // Turn 2: Architect calls MCP tool to check crypto entropy
        return {
          id: 'res_2',
          model: req.model || 'frontier',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Checking cryptographic requirements before final review...',
                tool_calls: [
                  {
                    id: 'tc_crypto_1',
                    type: 'function',
                    function: {
                      name: 'audit_crypto_entropy',
                      arguments: JSON.stringify({ tokenLength: 32 }),
                    },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
        } as UnifiedApiResponse;
      }

      if (turnIndex === 3) {
        // Turn 3: Architect hands off to security reviewer
        return {
          id: 'res_3',
          model: req.model || 'frontier',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Blueprint drafted. Delegating to AppSec Specialist for final security audit.',
                tool_calls: [
                  {
                    id: 'tc_handoff_2',
                    type: 'function',
                    function: {
                      name: 'transfer_to_security',
                      arguments: JSON.stringify({
                        reason: 'Verify ReDoS and rate-limiting defenses',
                        context_updates: { blueprintVerified: true },
                      }),
                    },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
        } as UnifiedApiResponse;
      }

      // Final turn: Security reviewer produces final approved output
      return {
        id: 'res_4',
        model: req.model || 'frontier',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                'Security Audit PASSED: System design complies with zero-trust in-process principles. Entropy bits = 192 (SECURE). Ready for production release.',
            },
            finishReason: 'stop',
          },
        ],
      } as UnifiedApiResponse;
    },
    generateEmbedding: async () => ({
      object: 'list' as const,
      model: 'embedding',
      data: [{ object: 'embedding' as const, index: 0, embedding: [0.1, 0.2] }],
      usage: { promptTokens: 10, totalTokens: 10 },
    }),
  };

  const client = new SinapsClient({
    providers: [mockProvider],
    mcpBridge: mcp,
  });

  // 2. Define the Multi-Agent Swarm with A2A Handoff Topologies
  const swarm = client.swarm({
    defaultAgentId: 'triage',
    maxHandoffs: 5,
    agents: [
      {
        id: 'triage',
        name: 'Triage Director',
        role: 'Inquiry Classifier',
        instructions:
          'Classify incoming technical requirements and delegate to the appropriate engineer.',
        handoffs: ['architect'],
        skills: [
          {
            id: 'intent-classifier',
            name: 'Intent Classifier',
            description: 'Routes tasks to engineering sub-agents',
          },
        ],
      },
      {
        id: 'architect',
        name: 'Principal Cloud Architect',
        role: 'High-Availability System Designer',
        instructions:
          'Design resilient zero-downtime distributed systems. Delegate to security when finished.',
        handoffs: ['security'],
        skills: [
          {
            id: 'system-design',
            name: 'System Design',
            description: 'Produces resilient zero-dependency cloud topologies',
          },
        ],
      },
      {
        id: 'security',
        name: 'Principal AppSec Engineer',
        role: 'Zero-Trust Security Auditor',
        instructions:
          'Audit blueprints against ReDoS, prototype pollution, and sensitive data leakage.',
        skills: [
          {
            id: 'sec-audit',
            name: 'AppSec Invariant Audit',
            description:
              'Validates cryptographic entropy and security guardrails',
          },
        ],
      },
    ],
  });

  console.log(
    '=== 2. Exporting A2A Agent Cards (/.well-known/agent.json standard) ===',
  );
  const agentCards = swarm.exportAgentCards('https://sinapsai.internal/a2a');
  console.log(JSON.stringify(agentCards, null, 2));

  console.log('\n=== 3. Executing Autonomous Swarm (Non-Streaming Run) ===');
  turnIndex = 0; // reset turn counter
  const result = await swarm.run({
    task: 'Design an ultra-secure and high-availability payment gateway control plane.',
    context: { environment: 'production', region: 'ap-southeast-1' },
  });

  console.log(`\nFinal Output:\n${result.content}`);
  console.log(`\nCompleted by Agent: ${result.finalAgentId}`);
  console.log(`Total Agent Steps: ${result.totalSteps}`);
  console.log(`Total Handoffs: ${result.totalHandoffs}`);
  console.log('Steps per Agent:', result.agentSteps);
  console.log('Final Shared Context:', result.sharedContext);

  console.log('\n=== 4. Executing Streaming Swarm Run (Real-Time Events) ===');
  turnIndex = 0; // reset turn counter for streaming
  for await (const event of swarm.runStream({
    task: 'Stream a distributed architecture plan.',
  })) {
    if (event.type === 'agent-start') {
      console.log(
        `\n[Agent Activated] ${event.agentName} (${event.agentId}) - Step ${event.step}`,
      );
    } else if (event.type === 'text-delta') {
      process.stdout.write(event.textDelta);
    } else if (event.type === 'handoff') {
      console.log(
        `\n[A2A Handoff] Transferring: ${event.fromAgentId} -> ${event.toAgentId} (Reason: ${event.reason})`,
      );
      if (event.contextUpdates) {
        console.log('Context Updates:', event.contextUpdates);
      }
    } else if (event.type === 'done') {
      console.log(
        `\n\n[Done] Orchestration complete in ${event.result.totalSteps} steps!`,
      );
    }
  }

  console.log(
    '\n✨ Multi-Agent Swarm & A2A Handoff Protocol demonstrated successfully!',
  );
}

main().catch(console.error);
