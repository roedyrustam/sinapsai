/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 23: Context Compression & FinOps Budget Guardrails
 *
 * Demonstrates:
 * 1. Zero-dependency context compression with sliding-window and middle-out strategies.
 * 2. Atomic tool-call group preservation preventing orphaned function response messages.
 * 3. Enforcing hard and soft FinOps budget limits on cost ($ USD) and token usage.
 *
 * Run with: npx -y tsx examples/23-context-compression-and-budget.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  BudgetExceededError,
  BudgetGuardrails,
  type ChatMessage,
  ContextCompressor,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log(
    '=== SinapsAI: Context Compression & FinOps Budget Guardrails ===\n',
  );

  // --- PART A: Standalone Context Compressor ---
  console.log('--- PART A: Context Compression Strategies ---');
  const compressor = new ContextCompressor({
    maxPromptTokens: 80,
    strategy: 'middle-out',
    preserveSystemMessages: true,
  });

  const conversationHistory: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are an enterprise financial research assistant.',
    },
    {
      role: 'user',
      content: 'We need to analyze Q3 revenue projections for Acme Corp.',
    },
    {
      role: 'assistant',
      content:
        'Understood. Reviewing the Q3 balance sheet and historical margins.',
    },
    {
      role: 'user',
      content: 'What were the gross margins in Q2 across both divisions?',
    },
    {
      role: 'assistant',
      content: 'Division A reported 42% while Division B reported 38%.',
    },
    {
      role: 'user',
      content: 'Based on that, give me the final revised forecast.',
    },
  ];

  const compressed = compressor.compress(conversationHistory);
  console.log(`Original estimated tokens : ${compressed.originalTokens}`);
  console.log(`Compressed estimated tokens: ${compressed.compressedTokens}`);
  console.log(
    `Messages dropped          : ${compressed.droppedCount} / ${conversationHistory.length}`,
  );
  console.log('\nRetained Messages:');
  compressed.messages.forEach((m, i) => {
    console.log(
      `  [${i}] ${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content.slice(0, 50) : '...'}`,
    );
  });

  // --- PART B: Client Gateway with Automatic Context Compression ---
  console.log(
    '\n--- PART B: Gateway Auto-Compression & Budget Enforcement ---',
  );

  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'mock-key',
      }),
    ],
    contextCompression: {
      maxPromptTokens: 120,
      strategy: 'sliding-window',
    },
    budget: {
      maxCostUsd: 1.0, // $1.00 hard limit
      maxTotalTokens: 10000,
      action: 'block',
      onBudgetWarning: (currentCostUsd, limitUsd) => {
        console.warn(
          `[BUDGET WARNING] Current spend $${currentCostUsd} approaching limit $${limitUsd}`,
        );
      },
    },
  });

  console.log(
    'Gateway initialized with ContextCompressor and FinOps Budget guardrails.',
  );

  // --- PART C: Standalone Budget Telemetry Evaluator ---
  console.log('\n--- PART C: Standalone Budget Guardrails Evaluator ---');
  const budgetMonitor = new BudgetGuardrails({
    maxCostUsd: 5.0,
    maxTotalTokens: 50000,
    warningThresholdRatio: 0.8,
    action: 'block',
    onBudgetAlert: (alert) => {
      console.log(
        `[ALERT: ${alert.type.toUpperCase()}] ${alert.percentage}% of quota reached! (${alert.currentValue}/${alert.limitValue})`,
      );
    },
  });

  // Simulate usage at 82% threshold
  console.log('Simulating 82% usage:');
  budgetMonitor.evaluate({ estimatedCostUsd: 4.1, totalTokens: 12000 });

  // Simulate limit overrun
  console.log('\nSimulating 105% usage with action: block:');
  try {
    budgetMonitor.evaluate({ estimatedCostUsd: 5.25, totalTokens: 15000 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`Caught expected BudgetExceededError: ${err.message}`);
    }
  }

  console.log('\n=== Example 23 Completed Successfully ===');
}

main().catch(console.error);
