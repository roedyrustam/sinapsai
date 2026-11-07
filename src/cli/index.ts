#!/usr/bin/env node
/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Command Line Interface (CLI)
 *
 * Usage:
 *   npx sinapsai serve [--port 8080] [--host 0.0.0.0]
 *   npx sinapsai mcp
 *   npx sinapsai health
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { SinapsClient } from '../core/SinapsClient.js';
import { AnthropicProvider } from '../providers/AnthropicProvider.js';
import { DeepSeekProvider } from '../providers/DeepSeekProvider.js';
import { GeminiProvider } from '../providers/GeminiProvider.js';
import { GroqProvider } from '../providers/GroqProvider.js';
import { MistralProvider } from '../providers/MistralProvider.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { OpenAiProvider } from '../providers/OpenAiProvider.js';
import { OpenRouterProvider } from '../providers/OpenRouterProvider.js';
import type { Provider } from '../providers/Provider.js';
import { startMcpStdioServer } from './mcpServer.js';
import { createGatewayServer } from './server.js';

export function buildClientFromEnv(): SinapsClient {
  const providers: Provider[] = [];

  if (process.env.GEMINI_API_KEY) {
    providers.push(new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY }));
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY }));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(
      new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    );
  }
  if (process.env.GROQ_API_KEY) {
    providers.push(new GroqProvider({ apiKey: process.env.GROQ_API_KEY }));
  }
  if (process.env.DEEPSEEK_API_KEY) {
    providers.push(
      new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    );
  }
  if (process.env.MISTRAL_API_KEY) {
    providers.push(
      new MistralProvider({ apiKey: process.env.MISTRAL_API_KEY }),
    );
  }
  if (process.env.OPENROUTER_API_KEY) {
    providers.push(
      new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY }),
    );
  }

  // Fallback to local Ollama if no cloud keys configured
  if (providers.length === 0) {
    providers.push(new OllamaProvider());
  }

  return new SinapsClient({
    providers,
    strategy: 'adaptive',
  });
}

export async function runCli(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const command = args[0] || 'serve';

  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`
SinapsAI CLI - In-Process AI Gateway & Control Plane

Commands:
  serve       Start local OpenAI-compatible HTTP Gateway Server (default)
  dashboard   Start embedded Web UI Metrics & Telemetry Dashboard (default: 3140)
  mcp         Start Model Context Protocol (MCP) Stdio Server
  health      Check health and latency of configured providers
  version     Display installed version

Options:
  --port <num>      Port for gateway or dashboard server
  --host <string>   Host to bind server (default: 127.0.0.1)
  --api-key <key>   Protect server with an API key
`);
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write('sinapsai v3.0.0\n');
    return;
  }

  const client = buildClientFromEnv();

  if (command === 'dashboard') {
    let port = 3140;
    let host = '127.0.0.1';

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--port' && args[i + 1]) {
        port = Number(args[i + 1]) || 3140;
      }
      if (args[i] === '--host' && args[i + 1]) {
        host = args[i + 1];
      }
    }

    const dashboard = await client.startDashboard({ port, host });
    process.stdout.write(`
┌────────────────────────────────────────────────────────┐
│  📊 SinapsAI Web UI Metrics Dashboard Running          │
│  URL      : ${dashboard.getUrl()}                      │
│  API      : ${dashboard.getUrl()}/api/summary          │
│  Metrics  : ${dashboard.getUrl()}/api/prometheus       │
└────────────────────────────────────────────────────────┘
`);
    return;
  }

  if (command === 'mcp') {
    startMcpStdioServer(client);
    return;
  }

  if (command === 'health') {
    process.stdout.write('Checking SinapsAI gateway provider health...\n');
    const health = await client.checkHealth({ ping: true });
    process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
    return;
  }

  if (command === 'serve') {
    let port = 8080;
    let host = '127.0.0.1';
    let apiKey: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--port' && args[i + 1]) {
        port = Number(args[i + 1]) || 8080;
      }
      if (args[i] === '--host' && args[i + 1]) {
        host = args[i + 1];
      }
      if (args[i] === '--api-key' && args[i + 1]) {
        apiKey = args[i + 1];
      }
    }

    const server = createGatewayServer({ port, host, client, apiKey });
    server.listen(port, host, () => {
      process.stdout.write(`
┌────────────────────────────────────────────────────────┐
│  ⚡ SinapsAI Gateway Server Running                     │
│  Endpoint : http://${host}:${port}/v1/chat/completions      │
│  Health   : http://${host}:${port}/health                    │
│  Metrics  : http://${host}:${port}/metrics                   │
└────────────────────────────────────────────────────────┘
`);
    });
  }
}

// Auto-run if executed as main CLI entry point
const normalizedArgv1 = process.argv[1]?.replace(/\\/g, '/');
if (
  normalizedArgv1 &&
  (normalizedArgv1.endsWith('cli/index.js') ||
    normalizedArgv1.endsWith('cli/index.ts') ||
    normalizedArgv1.endsWith('bin/sinapsai') ||
    normalizedArgv1.endsWith('/sinapsai'))
) {
  runCli();
}
