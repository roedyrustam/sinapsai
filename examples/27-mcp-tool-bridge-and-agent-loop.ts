/**
 * SinapsAI - Example 27: Model Context Protocol (MCP) Tool Bridge & Autonomous Agent Loop
 *
 * Demonstrates:
 * 1. Registering in-process MCP tools with schemas and async handlers.
 * 2. Bi-directional schema conversion between MCP and OpenAI/Unified ToolDefinition formats.
 * 3. Autonomous multi-step tool-calling agent loop via `client.runWithTools()`.
 * 4. Step-by-step progress tracking with `onStep` callbacks.
 * 5. MCP JSON-RPC 2.0 protocol dispatching (`tools/list`, `tools/call`, `ping`).
 *
 * Run with: npx tsx examples/27-mcp-tool-bridge-and-agent-loop.ts
 */

import {
  McpToolBridge,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== SinapsAI - MCP Tool Bridge & Autonomous Agent Loop ===\n');

  // 1. Initialize client with LLM provider
  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
        defaultModel: 'gpt-4o-mini',
      }),
    ],
  });

  // 2. Register local in-process MCP tools on the client's MCP bridge
  client.mcp.registerTool({
    name: 'get_stock_quote',
    description: 'Fetches the current market quote and currency for a given stock ticker symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g. AAPL, MSFT, NVDA)',
        },
      },
      required: ['symbol'],
    },
    handler: async ({ symbol }: { symbol: string }) => {
      console.log(`  [MCP Handler] Executing get_stock_quote for symbol: ${symbol}`);
      const mockDatabase: Record<string, { price: number; currency: string; company: string }> = {
        AAPL: { price: 235.5, currency: 'USD', company: 'Apple Inc.' },
        MSFT: { price: 420.25, currency: 'USD', company: 'Microsoft Corporation' },
        NVDA: { price: 138.1, currency: 'USD', company: 'NVIDIA Corporation' },
      };

      const quote = mockDatabase[symbol.toUpperCase()];
      if (!quote) {
        return { error: `Ticker '${symbol}' not found in database.` };
      }
      return quote;
    },
  });

  client.mcp.registerTool({
    name: 'calculate_portfolio_value',
    description: 'Calculates the total monetary value of an asset holding given shares and price.',
    inputSchema: {
      type: 'object',
      properties: {
        shares: { type: 'number', description: 'Number of owned shares' },
        pricePerShare: { type: 'number', description: 'Price per individual share' },
        currency: { type: 'string', description: 'Currency code' },
      },
      required: ['shares', 'pricePerShare'],
    },
    handler: async ({
      shares,
      pricePerShare,
      currency = 'USD',
    }: { shares: number; pricePerShare: number; currency?: string }) => {
      console.log(
        `  [MCP Handler] Calculating portfolio value: ${shares} shares @ $${pricePerShare} ${currency}`,
      );
      const total = shares * pricePerShare;
      return {
        shares,
        pricePerShare,
        totalValue: Math.round(total * 100) / 100,
        currency,
        timestamp: new Date().toISOString(),
      };
    },
  });

  console.log('Registered MCP Tools:');
  for (const t of client.mcp.listTools()) {
    console.log(` - ${t.name}: ${t.description}`);
  }
  console.log('\nConverted Unified Tools Format:');
  console.log(JSON.stringify(client.mcp.getTools(), null, 2));

  // 3. Test JSON-RPC 2.0 interface directly (enables external MCP clients / Stdio workers)
  console.log('\n--- Testing JSON-RPC 2.0 Protocol Dispatching ---');
  const listRpcResponse = await client.mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 'rpc-1',
    method: 'tools/list',
  });
  console.log('JSON-RPC tools/list response:');
  console.log(JSON.stringify(listRpcResponse, null, 2));

  const callRpcResponse = await client.mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 'rpc-2',
    method: 'tools/call',
    params: {
      name: 'get_stock_quote',
      arguments: { symbol: 'NVDA' },
    },
  });
  console.log('\nJSON-RPC tools/call response:');
  console.log(JSON.stringify(callRpcResponse, null, 2));

  // 4. Autonomous Agent Loop simulation / execution
  console.log('\n--- Autonomous Agent Loop (client.runWithTools) ---');
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('Executing live agent loop with OpenAI gpt-4o-mini...');
      const result = await client.runWithTools({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content:
              'I own 25 shares of Apple (AAPL). What is the current stock price and what is the total value of my holding?',
          },
        ],
        maxSteps: 5,
        onStep: (step) => {
          console.log(
            `\n>>> [Agent Step ${step.stepIndex}] Completed in ${step.durationMs}ms:`,
          );
          for (const tc of step.toolCalls) {
            console.log(`    Requested Tool: ${tc.function.name}(${tc.function.arguments})`);
          }
          for (const tr of step.toolResults) {
            console.log(`    Tool Output: ${tr.content}`);
          }
        },
      });

      console.log('\nFinal Assistant Response:');
      console.log(result.response.choices[0].message.content);
      console.log(`\nAgent Summary: ${result.totalSteps} steps executed, ${result.totalTokens} total tokens.`);
    } catch (err) {
      console.error('Error during live agent loop:', err);
    }
  } else {
    console.log(
      '(Set OPENAI_API_KEY environment variable to test live multi-turn agent execution)',
    );
  }

  console.log('\n=== Example 27 Completed Successfully ===');
}

main().catch(console.error);
