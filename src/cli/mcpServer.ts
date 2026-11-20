/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Standalone MCP Server Stdio Transport
 *
 * Implements:
 * 1. Native Model Context Protocol (MCP v1.x) JSON-RPC 2.0 loop over process.stdin/process.stdout.
 * 2. Compatible with Claude Desktop, Cursor IDE, Antigravity, and Windsurf.
 * 3. Bridges SinapsAI tools (chat, RAG, health, consensus) into the external agent host.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import readline from 'node:readline';
import { FrontierModelRegistry } from '../core/FrontierModelRegistry.js';
import type { SinapsClient } from '../core/SinapsClient.js';
import type { FrontierModelTier } from '../types/index.js';
import { s } from '../utils/schema.js';

export function startMcpStdioServer(client: SinapsClient): void {
  // Register default built-in gateway tools
  client.mcp.registerTool({
    name: 'sinaps_chat',
    description:
      'Execute an LLM chat completion through SinapsAI multi-provider gateway with circuit breaking and automatic failover.',
    inputSchema: s
      .object({
        model: s.string({
          description:
            'Model identifier (e.g. gemini-3.8-flash, gemini-4-carbon, gpt-5.6-sol-medium, claude-sonnet-5-5)',
        }),
        prompt: s.string({ description: 'The user prompt or query' }),
      })
      .toJsonSchema(),
    handler: async (args) => {
      const model = String(args.model || 'gemini-3.8-flash');
      const prompt = String(args.prompt || '');
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.choices[0]?.message?.content || '';
    },
  });

  client.mcp.registerTool({
    name: 'sinaps_models',
    description:
      'List late-2026 frontier AI models registered in SinapsAI with pricing, context window, tier, and capabilities.',
    inputSchema: s
      .object({
        tier: s
          .string({
            description:
              'Optional execution tier filter: high-fast | fast | medium | high',
          })
          .optional(),
        provider: s
          .string({
            description:
              'Optional provider filter (e.g. gemini, anthropic, openai, xai, deepseek)',
          })
          .optional(),
      })
      .toJsonSchema(),
    handler: async (args) => {
      let list = FrontierModelRegistry.list();
      if (typeof args.tier === 'string' && args.tier) {
        list = FrontierModelRegistry.getByTier(args.tier as FrontierModelTier);
      }
      if (typeof args.provider === 'string' && args.provider) {
        const norm = args.provider.toLowerCase();
        list = list.filter((m) => m.provider.toLowerCase() === norm);
      }
      return JSON.stringify(list, null, 2);
    },
  });

  client.mcp.registerTool({
    name: 'sinaps_health',
    description:
      'Check liveness, circuit breaker status, and latency of configured LLM providers in SinapsAI.',
    inputSchema: s.object({}).toJsonSchema(),
    handler: async () => {
      const health = await client.checkHealth();
      return JSON.stringify(health, null, 2);
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed);
      const response = await client.mcp.handleJsonRpc(request);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (err) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error: invalid JSON',
          data: err instanceof Error ? err.message : String(err),
        },
      };
      process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
    }
  });

  process.stderr.write('[SinapsAI] MCP Stdio Server running.\n');
}
