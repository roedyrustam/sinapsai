/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 53: SinapsAI v4.0 — Modular Subpaths, Self-Healing Structured Outputs & Full MCP 2025-06-18
 *
 * Demonstrates:
 * 1. Tree-shakeable modular subpath imports (`sinapsai/providers`, `sinapsai/mcp`).
 * 2. Self-healing typed structured outputs (`client.chat.completions.createStructured<T>()`).
 * 3. MCP 2025-06-18 `resources/read`, `prompts/get`, and `elicitation/create`.
 */

import { s, SinapsClient } from 'sinapsai';
import { McpToolBridge } from 'sinapsai/mcp';
import { QwenProvider } from 'sinapsai/providers';

const mcp = new McpToolBridge();
mcp.registerPrompt({
  name: 'security_audit',
  description: 'Audit an API contract for OWASP Top 10 risks',
  arguments: [{ name: 'service', required: true }],
  render: (args) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Perform an OWASP API security audit on service: ${args?.service || 'gateway'}`,
        },
      },
    ],
  }),
});

const client = new SinapsClient({
  mcpBridge: mcp,
  providers: [
    new QwenProvider({ apiKey: process.env.QWEN_API_KEY || 'sk-qwen-v4' }),
  ],
});

const AuditReportSchema = s.object({
  service: s.string(),
  riskScore: s.number(),
  passed: s.boolean(),
});

async function main() {
  console.log('=== SinapsAI v4.0.0: Modular Subpaths, MCP Resources & Structured Outputs ===\n');

  const resRead = await client.mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: 'sinaps://models/frontier' },
  });
  const models = JSON.parse(resRead.result.contents[0].text) as unknown[];
  console.log(`Live MCP Frontier Models Resource count: ${models.length}`);

  try {
    const { data, attempts } = await client.chat.completions.createStructured({
      model: 'qwen3-turbo',
      messages: [
        { role: 'user', content: 'Return audit JSON for billing-api.' },
      ],
      schema: AuditReportSchema,
      maxRetries: 2,
    });
    console.log(`Structured output validated in ${attempts} attempt(s):`, data);
  } catch (err) {
    console.warn('Structured call skipped (offline demo key):', (err as Error).message);
  }
}

main().catch(console.error);
