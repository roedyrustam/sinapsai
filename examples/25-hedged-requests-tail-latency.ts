/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 25: Hedged Speculative Requests for Tail-Latency (P99) Reduction
 *
 * Demonstrates:
 * 1. Speculative hedged requests: firing a backup request if the primary provider exceeds delayMs.
 * 2. Racing redundant providers and automatically aborting slower requests once a winner resolves.
 * 3. Listening to onHedgeFired and onHedgeWon hooks for latency telemetry.
 *
 * Run with: npx -y tsx examples/25-hedged-requests-tail-latency.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  HedgedExecutor,
  OpenAiProvider,
  type Provider,
  type UnifiedApiRequest,
  type UnifiedApiResponse,
} from '../src/index.js';

async function main() {
  console.log(
    '=== SinapsAI: Hedged Requests for P99 Tail-Latency Elimination ===\n',
  );

  // --- Mock Redundant Providers with Simulated Latencies ---
  const primaryProvider: Provider = {
    id: 'primary-heavy',
    name: 'Primary LLM (Under heavy load)',
    generateContent: async () => {
      // Simulate slow response: 400ms
      await new Promise((r) => setTimeout(r, 400));
      return {
        id: 'res-primary',
        model: 'primary-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Response from primary provider.',
            },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  const backupProvider: Provider = {
    id: 'backup-fast',
    name: 'Backup LLM (Low latency)',
    generateContent: async () => {
      // Simulate fast response: 50ms
      await new Promise((r) => setTimeout(r, 50));
      return {
        id: 'res-backup',
        model: 'backup-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Response from backup provider.',
            },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  // Configure HedgedExecutor: if primary does not respond in 150ms, fire backup
  const hedgedExecutor = new HedgedExecutor({
    enabled: true,
    delayMs: 150, // Hedge threshold: 150ms
    maxHedges: 1,
    onHedgeFired: (primary, backup, delayMs) => {
      console.log(
        `⏱️ [HEDGE FIRED] ${primary.name} exceeded ${delayMs}ms. Firing backup ${backup.name}...`,
      );
    },
    onHedgeWon: (winner, elapsedMs) => {
      console.log(
        `🏆 [HEDGE WON] Backup provider "${winner.name}" won the race in ${elapsedMs}ms!`,
      );
    },
  });

  const request: UnifiedApiRequest = {
    model: 'default',
    messages: [
      { role: 'user', content: 'Explain zero-dependency hedged requests.' },
    ],
  };

  console.log('Sending request through HedgedExecutor...');
  const startTime = Date.now();

  const raceResult = await hedgedExecutor.execute(
    [primaryProvider, backupProvider],
    request,
    async (provider, req) => {
      const res = await provider.generateContent(req);
      return res as UnifiedApiResponse;
    },
  );

  const totalTime = Date.now() - startTime;
  console.log('\n--- Race Results ---');
  console.log(`Winner Provider : ${raceResult.winnerProvider.name}`);
  console.log(
    `Was Hedged      : ${raceResult.wasHedged ? 'YES (Backup Saved P99)' : 'NO'}`,
  );
  console.log(
    `Total Elapsed   : ${totalTime}ms (Winner time: ${raceResult.elapsedMs}ms)`,
  );
  console.log(
    `Answer Content  : "${raceResult.response.choices[0].message.content}"`,
  );

  console.log('\n=== Example 25 Completed Successfully ===');
}

main().catch(console.error);
