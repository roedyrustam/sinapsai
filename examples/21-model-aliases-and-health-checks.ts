/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 21: Model Aliases & Gateway Health Probes
 *
 * Demonstrates:
 * 1. Defining virtual model aliases ('fast', 'smart', 'code', 'cheap') to avoid hardcoding provider models.
 * 2. Dynamically updating aliases via client.setModelAlias().
 * 3. Checking gateway provider liveness, circuit breaker status, and active ping health probes.
 *
 * Run with: npx -y tsx examples/21-model-aliases-and-health-checks.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  OpenAiProvider,
  SinapsClient,
  type UnifiedApiResponse,
} from '../src/index.js';

async function main() {
  console.log('=== SinapsAI: Model Aliases & Gateway Health Probes ===\n');

  // 1. Initialize SinapsClient with virtual model aliases
  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        id: 'primary-openai',
        apiKey: process.env.OPENAI_API_KEY || 'mock-key',
      }),
    ],
    modelAliases: {
      fast: 'gpt-4o-mini',
      smart: 'gpt-4o',
      reasoning: 'o3-mini',
    },
  });

  // 2. Query registered aliases
  console.log('Current Model Aliases:', client.getModelAliases());
  console.log('Resolving "fast":', client.resolveModel('fast'));
  console.log('Resolving "smart":', client.resolveModel('smart'));
  console.log('Resolving unknown "llama-3":', client.resolveModel('llama-3'));

  // 3. Dynamically register new aliases
  client.setModelAlias('code', 'qwen-2.5-coder-32b');
  console.log('Updated Aliases after adding "code":', client.getModelAliases());

  // 4. Perform passive gateway health inspection
  console.log('\n--- Passive Gateway Health Check ---');
  const passiveReport = await client.checkHealth();
  console.log('Overall Status:', passiveReport.status);
  console.log('Providers Checked:', passiveReport.providers.length);
  for (const p of passiveReport.providers) {
    console.log(
      `  - [${p.status.toUpperCase()}] Provider "${p.id}": circuit=${p.circuitState}, successRate=${(p.successRate * 100).toFixed(1)}%`,
    );
  }

  // 5. Active probe ping (mock demonstration without live network required)
  console.log('\n--- Active Probe Ping (demonstration) ---');
  console.log(
    'In active probe mode (options.ping = true), SinapsAI sends a 1-token heartbeat ping to each provider.',
  );
  console.log('Example: await client.checkHealth({ ping: true, timeoutMs: 2000 });');

  console.log('\nDone!');
}

main().catch(console.error);
