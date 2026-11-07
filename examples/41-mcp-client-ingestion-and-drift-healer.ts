/**
 * Example 41: External MCP Client Ingestion & Autonomous Schema Drift Healer
 *
 * Demonstrates:
 * 1. AutonomousDriftHealer: Automatically heals misnamed parameter keys, coerces stringified types, and injects smart defaults.
 * 2. External MCP Server Ingestion: Connecting to an external MCP endpoint over HTTP/SSE via JSON-RPC 2.0.
 * 3. Transparent tool registration and invocation in SinapsAI.
 */

import { AutonomousDriftHealer, McpToolBridge } from '../src/index.js';

async function main() {
  console.log('=== 1. Autonomous Schema Drift Healer ===');
  const schema = {
    type: 'object' as const,
    properties: {
      userId: { type: 'string' },
      searchQuery: { type: 'string' },
      maxTokens: { type: 'number' },
      filterActive: { type: 'boolean' },
    },
    required: ['userId', 'searchQuery', 'filterActive'],
  };

  const driftedArgs = {
    user_id: 'usr_777', // underscore vs camelCase
    query: 'vector databases', // fuzzy rename to searchQuery
    maxTokens: '4096', // string to number coercion
    // filterActive missing -> will be injected with default (false)
  };

  const healResult = AutonomousDriftHealer.healToolArguments(driftedArgs, schema);
  console.log('Original Drifted Args:', healResult.originalArgs);
  console.log('Autonomously Healed Args:', healResult.healedArgs);
  console.log('Remediated Fields:', healResult.remediatedFields);

  console.log('\n=== 2. Upstream Error Diagnosis ===');
  const diag = AutonomousDriftHealer.diagnoseProviderError(new Error('Rate limit exceeded (HTTP 429)'));
  console.log(`Error Category: ${diag.category}`);
  console.log(`Recommended Action: ${diag.recommendedAction}`);
  console.log(`Transient: ${diag.isTransient}`);

  console.log('\n=== 3. In-Process MCP Bridge with Drift Healing ===');
  const bridge = new McpToolBridge();
  bridge.registerTool({
    name: 'fetch_user_profile',
    description: 'Fetches user profile by ID and query filter.',
    inputSchema: schema,
    handler: async (args) => {
      return {
        status: 'success',
        receivedUserId: args.userId,
        receivedQuery: args.searchQuery,
        receivedTokens: args.maxTokens,
      };
    },
  });

  const toolResult = await bridge.executeToolCall({
    id: 'call_drift_test',
    type: 'function',
    function: {
      name: 'fetch_user_profile',
      arguments: JSON.stringify(driftedArgs),
    },
  });

  console.log('Tool Execution Content:');
  console.log(toolResult.content);
  console.log('Self-Healing Hint:');
  console.log(toolResult.selfHealingHint);

  console.log('\n=== Example 41 Completed Successfully! ===');
}

main().catch(console.error);
