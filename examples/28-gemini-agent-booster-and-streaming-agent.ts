/**
 * Example 28: Gemini Agent Booster, Streaming Reversible PII Vault & Streaming Autonomous Agent Loop
 *
 * Demonstrates:
 * 1. GeminiAgentBooster: Dynamic Thinking Budget ('auto') & Deterministic KV-Cache Tool Canonicalization.
 * 2. Streaming Reversible PII Tokenization Vault across split SSE chunks.
 * 3. Real-Time Streaming Autonomous MCP Agent Loop via `client.runWithToolsStream()`.
 */

import {
  GEMINI_MODELS,
  GeminiAgentBooster,
  type Provider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== 1. GeminiAgentBooster: Dynamic Thinking Budget & KV-Cache Optimizer ===');

  const trivialAnalysis = GeminiAgentBooster.analyzeComplexity({
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log('Trivial prompt complexity:', trivialAnalysis);

  const deepAuditAnalysis = GeminiAgentBooster.analyzeComplexity({
    messages: [
      {
        role: 'user',
        content:
          'Perform a security audit and root cause analysis of this concurrency deadlock:\n```ts\nasync function transfer() { throw new TypeError("race condition"); }\n```',
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'scan_ast',
          parameters: { type: 'object', properties: { file: { type: 'string' } } },
        },
      },
    ],
  });
  console.log('Deep audit complexity:', deepAuditAnalysis);

  console.log('\n=== 2. Streaming Autonomous Agent Loop + Streaming Reversible PII Vault ===');

  let turn = 0;
  const mockStreamingProvider: Provider = {
    id: 'gemini-argon-mock',
    name: 'GeminiArgonMock',
    promptCostPer1k: 0.0005,
    completionCostPer1k: 0.002,
    generateContent: async (req) => {
      if (!req.stream) {
        throw new Error('Use streaming');
      }
      return (async function* () {
        turn++;
      if (turn === 1) {
        yield {
          id: 'step-1',
          model: GEMINI_MODELS.ARGON_4,
          choices: [
            {
              delta: {
                role: 'assistant',
                reasoning_content: 'Checking account status for {{PII_EMAIL_1}}...',
              },
              finishReason: null,
            },
          ],
        };
        yield {
          id: 'step-1',
          model: GEMINI_MODELS.ARGON_4,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_acct_1',
                    type: 'function',
                    function: {
                      name: 'get_subscription_tier',
                      arguments: '{"email":"{{PII_',
                    },
                  },
                ],
              },
              finishReason: null,
            },
          ],
        };
        yield {
          id: 'step-1',
          model: GEMINI_MODELS.ARGON_4,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: 'EMAIL_1}}"}',
                    },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
          usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
        };
      } else {
        const chunks = [
          'Verified! Account {{PII_',
          'EMAIL_1}} is on the ',
          'Enterprise Sovereign tier.',
        ];
        for (let i = 0; i < chunks.length; i++) {
          yield {
            id: 'step-2',
            model: GEMINI_MODELS.ARGON_4,
            choices: [
              {
                delta: {
                  role: 'assistant',
                  content: chunks[i],
                },
                finishReason: i === chunks.length - 1 ? 'stop' : null,
              },
            ],
            usage:
              i === chunks.length - 1
                ? { promptTokens: 50, completionTokens: 20, totalTokens: 70 }
                : undefined,
          };
        }
      }
      })();
    },
  };

  const client = new SinapsClient({
    providers: [mockStreamingProvider],
    piiGuardrails: {
      categories: ['email'],
      reversible: true,
    },
  });

  client.mcp.registerTool({
    name: 'get_subscription_tier',
    description: 'Looks up subscription tier for a customer email',
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    handler: async (args) => ({
      email: args.email,
      tier: 'Enterprise Sovereign',
      active: true,
    }),
  });

  for await (const event of client.runWithToolsStream({
    model: GEMINI_MODELS.ARGON_4,
    thinkingBudget: 'auto',
    messages: [
      {
        role: 'user',
        content: 'Check subscription status for cto@sinapsai.dev',
      },
    ],
  })) {
    if (event.type === 'reasoning-delta') {
      process.stdout.write(`[Reasoning] ${event.reasoningDelta}\n`);
    } else if (event.type === 'tool-call-start') {
      console.log(
        `[Tool Call] ${event.toolCalls.map((t) => `${t.function.name}(${t.function.arguments})`).join(', ')}`,
      );
    } else if (event.type === 'text-delta') {
      process.stdout.write(event.textDelta);
    } else if (event.type === 'done') {
      console.log(
        `\n[Done] Steps: ${event.result.totalSteps} | Tokens: ${event.result.totalTokens}`,
      );
    }
  }
}

main().catch(console.error);
