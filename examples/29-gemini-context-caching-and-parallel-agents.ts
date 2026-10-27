/**
 * Example 29: Gemini Context Caching Control Plane & Massively Parallel Agent Loops
 *
 * Demonstrates:
 * 1. `client.contextCache.evaluateEligibility()`: Detects if static prefixes qualify for Google Context Caching.
 * 2. `client.contextCache.create()`, `.get()`, `.list()`, and `.delete()`: First-class lifecycle management.
 * 3. `client.runWithToolsStream()`: Massively parallel tool execution for multi-tool calls.
 * 4. Automatic Gemini 4 availability fallback (`gemini-4-argon` / `gemini-4-pro` -> `gemini-3.8-flash`).
 */

import {
  type CreateCachedContentOptions,
  GEMINI_MODELS,
  McpToolBridge,
  type Provider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== 1. Google Context Caching Control Plane (SinapsClient) ===');

  const mockGeminiProvider = {
    id: 'gemini-live',
    name: 'Gemini',
    generateContent: async (req: { model: string }) => {
      return {
        id: 'gemini-res',
        model: req.model,
        choices: [
          {
            message: { role: 'assistant', content: 'Cached context answer.' },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 35000,
          completionTokens: 150,
          totalTokens: 35150,
          cachedPromptTokens: 34500,
        },
      };
    },
    // Context caching provider methods
    createCachedContent: async (options: CreateCachedContentOptions) => ({
      name: 'cachedContents/codebase-knowledge-repo',
      model: options.model,
      displayName: options.displayName || 'Knowledge Base Cache',
      createTime: new Date().toISOString(),
      expireTime: new Date(Date.now() + 3600000).toISOString(),
    }),
    getCachedContent: async (name: string) => ({
      name,
      model: 'gemini-4-pro',
      displayName: 'Knowledge Base Cache',
    }),
    listCachedContents: async () => [
      {
        name: 'cachedContents/codebase-knowledge-repo',
        model: 'gemini-4-pro',
      },
    ],
    deleteCachedContent: async (name: string) => {
      console.log(`[Cache Purged] Deleted ${name}`);
    },
  } as unknown as Provider;

  const client = new SinapsClient({
    providers: [mockGeminiProvider],
  });

  // Check eligibility for context caching (threshold: 32,768 tokens)
  const eligibility = client.contextCache.evaluateEligibility({
    messages: [
      {
        role: 'system',
        content: 'System documentation prefix: '.repeat(10000), // ~60,000 chars => ~15,000 tokens
      },
    ],
  });
  console.log('Context Cache Eligibility Analysis:');
  console.log(`- Eligible: ${eligibility.eligible}`);
  console.log(
    `- Estimated Prefix Tokens: ${eligibility.estimatedPrefixTokens}`,
  );
  console.log(`- Threshold Tokens: ${eligibility.thresholdTokens}`);

  // Create context cache
  const cachedContent = await client.contextCache.create({
    model: GEMINI_MODELS.PRO_4,
    displayName: 'Monolithic Codebase Documentation Cache',
    messages: [
      {
        role: 'system',
        content: 'Full monolithic codebase dump and AST schema',
      },
    ],
    ttl: '7200s',
  });
  console.log('\nCreated Context Cache on Gemini:', cachedContent.name);

  // List existing context caches
  const caches = await client.contextCache.list();
  console.log(`Found ${caches.length} active context cache(s).`);

  // Query using cachedContent
  const response = await client.chat.completions.create({
    model: GEMINI_MODELS.PRO_4,
    messages: [
      { role: 'user', content: 'How does the auth subsystem verify tokens?' },
    ],
    cachedContent: cachedContent.name,
  });
  console.log('\nResponse received with Prompt Caching:');
  console.log(`- Content: ${response.choices[0].message.content}`);
  console.log(
    `- Cached Prompt Tokens: ${response.usage?.cachedPromptTokens} (75-90% discount)`,
  );

  console.log('\n=== 2. Massively Parallel Tool Execution (Agentic MoE) ===');

  const bridge = new McpToolBridge();

  bridge.registerTool({
    name: 'search_vector_db',
    description: 'Searches vector database for semantic matches',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    handler: async (args) => {
      console.log(
        `  -> [Tool 1] Executing search_vector_db(${args.query}) concurrently...`,
      );
      await new Promise((r) => setTimeout(r, 80));
      return { matches: ['doc_1', 'doc_2'] };
    },
  });

  bridge.registerTool({
    name: 'fetch_git_blame',
    description: 'Fetches git blame for file',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } } },
    handler: async (args) => {
      console.log(
        `  -> [Tool 2] Executing fetch_git_blame(${args.file}) concurrently...`,
      );
      await new Promise((r) => setTimeout(r, 80));
      return { author: 'Roedy Rustam', commit: '05fe8b3' };
    },
  });

  let turn = 0;
  const parallelAgentProvider: Provider = {
    id: 'gemini-agent-provider',
    name: 'Gemini',
    generateContent: async (req) => {
      if (!req.stream) throw new Error('Streaming expected');
      return (async function* () {
        turn++;
        if (turn === 1) {
          yield {
            id: 'agent-turn-1',
            model: GEMINI_MODELS.ARGON_4,
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
                        name: 'search_vector_db',
                        arguments: '{"query":"auth"}',
                      },
                    },
                    {
                      index: 1,
                      id: 'call_blame_2',
                      type: 'function',
                      function: {
                        name: 'fetch_git_blame',
                        arguments: '{"file":"auth.ts"}',
                      },
                    },
                  ],
                },
                finishReason: 'tool_calls',
              },
            ],
          };
        } else {
          yield {
            id: 'agent-turn-2',
            model: GEMINI_MODELS.ARGON_4,
            choices: [
              {
                delta: {
                  role: 'assistant',
                  content:
                    'Both vector search and git blame completed in parallel.',
                },
                finishReason: 'stop',
              },
            ],
          };
        }
      })();
    },
  };

  const agentClient = new SinapsClient({
    providers: [parallelAgentProvider],
    mcpBridge: bridge,
  });

  const stream = agentClient.runWithToolsStream({
    messages: [
      {
        role: 'user',
        content: 'Investigate auth.ts commit history and vector docs',
      },
    ],
    maxSteps: 2,
  });

  for await (const event of stream) {
    if (event.type === 'tool-call-start') {
      console.log(`Dispatched ${event.toolCalls.length} tool(s) in parallel.`);
    } else if (event.type === 'tool-call-result') {
      console.log(`Received result for tool: ${event.toolName}`);
    } else if (event.type === 'done') {
      console.log(
        `Agent loop completed in ${event.result.totalSteps} step(s).`,
      );
      console.log(
        `Final message: ${event.result.response.choices[0].message.content}`,
      );
    }
  }

  // Cleanup context cache
  await client.contextCache.delete(cachedContent.name);
  console.log('\nContext Cache cleaned up successfully.');
}

main().catch(console.error);
