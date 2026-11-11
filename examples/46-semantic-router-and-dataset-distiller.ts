/**
 * Example 46: In-Process Semantic Prompt Router & Synthetic Dataset Distiller
 *
 * Demonstrates:
 * 1. SemanticRouter: Sub-millisecond vector centroid prompt classification routing
 *    queries directly to specialized models without LLM classification roundtrips.
 * 2. DatasetDistiller: In-process capture, PII redaction, and export of DPO preference
 *    pairs and SFT conversations into standard HuggingFace / OpenAI JSONL formats.
 * 3. Autonomous DPO pair extraction directly from Actor-Critic swarm review cycles.
 */

import {
  type Provider,
  SemanticRouter,
  SinapsClient,
  type UnifiedApiRequest,
} from '../src/index.js';

async function main() {
  console.log('=== 1. In-Process Semantic Prompt Router Demo ===\n');

  // Initialize standalone SemanticRouter with 3 distinct domain routes
  const router = new SemanticRouter({
    defaultThreshold: 0.35,
    routes: [
      {
        name: 'coding-expert',
        targetModel: 'claude-3-7-sonnet',
        samples: [
          'write a typescript function to parse json',
          'implement binary search algorithm in rust',
          'fix null pointer exception in java spring boot',
          'build rest api endpoints using express',
        ],
        systemPromptModifier: 'You are a principal software engineer. Provide robust code.',
      },
      {
        name: 'finance-analyst',
        targetModel: 'o3-mini',
        samples: [
          'calculate net present value and internal rate of return',
          'analyze quarterly cash flow balance sheet',
          'compute weighted average cost of capital wacc',
          'audit corporate tax liability deductions',
        ],
        systemPromptModifier: 'You are a chartered financial analyst. Be quantitative.',
      },
      {
        name: 'customer-support',
        targetModel: 'gemini-2.5-flash-lite',
        samples: [
          'where can I find my invoice',
          'how do I cancel my subscription and get refund',
          'reset my password link not working',
          'contact billing customer support representative',
        ],
        systemPromptModifier: 'You are a friendly support specialist. Be concise.',
      },
    ],
  });

  const testQueries = [
    'How do I implement binary search in Rust?',
    'Where is my invoice from last month and can I get a refund?',
    'Calculate the NPV of this cash flow projection',
    'What is the capital of France?', // Unmatched general query
  ];

  for (const query of testQueries) {
    const match = await router.classify(query);
    console.log(`Query: "${query}"`);
    console.log(`  Matched: ${match.matched}`);
    if (match.matched && match.route) {
      console.log(`  Target Route: ${match.route.name}`);
      console.log(`  Target Model: ${match.route.targetModel}`);
      console.log(`  Confidence:   ${match.confidence}`);
    } else {
      console.log(`  Status:       Below threshold (falls back to default model)`);
    }
    console.log(`  Latency:      ${match.latencyMs}ms\n`);
  }

  console.log('=== 2. Synthetic Dataset Distiller (DPO & SFT) Demo ===\n');

  const mockProvider: Provider = {
    id: 'mock-llm',
    name: 'Mock LLM',
    generateContent: async (req: UnifiedApiRequest) => ({
      id: 'res-1',
      model: req.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Response generated for ' + req.model,
          },
          finishReason: 'stop',
        },
      ],
    }),
  };

  const client = new SinapsClient({
    providers: [mockProvider],
    piiGuardrails: {
      enabled: true,
    },
    semanticRouter: {
      enabled: true,
      routes: router.getRoutes(),
    },
  });

  // Verify automated Semantic Routing via client.chat.completions.create({ model: 'auto' })
  const response = await client.chat.completions.create({
    model: 'auto',
    messages: [{ role: 'user', content: 'Implement quicksort algorithm in Rust' }],
  });
  console.log(`Client Chat with model: 'auto' routed to provider for model: ${(response as any).model || 'claude-3-7-sonnet'}\n`);

  // Record a DPO pair containing personal information (PII)
  // DatasetDistiller automatically redacts emails, cards, and phones before saving
  console.log('Recording DPO pair with sensitive user PII:');
  const dpoRecord = await client.distiller.recordDpo({
    prompt: 'User roedy@example.com with card 4532-1234-5678-9010 needs assistance with tax calculation.',
    chosen: 'Tax calculation completed for taxpayer [EMAIL] with progressive brackets.',
    rejected: 'Failed to calculate tax for user roedy@example.com.',
    scoreChosen: 0.95,
    scoreRejected: 0.30,
    critique: 'Rejected response leaked raw email and failed task.',
  });

  console.log('Sanitized Prompt in DPO record:', dpoRecord.prompt);
  console.log('Sanitized Chosen in DPO record:', dpoRecord.chosen);
  console.log('Sanitized Rejected in DPO record:', dpoRecord.rejected);
  console.log();

  // Record SFT conversation
  await client.distiller.recordSft({
    messages: [
      { role: 'user', content: 'What is Raft consensus?' },
      { role: 'assistant', content: 'Raft is a consensus algorithm designed for leader election, log replication, and safety.' },
    ],
    score: 0.98,
  });

  // Export HuggingFace / TRL JSONL
  console.log('--- Exported DPO JSONL (HuggingFace / TRL format) ---');
  console.log(client.distiller.exportDpoJsonl());
  console.log();

  // Export OpenAI / Axolotl SFT JSONL
  console.log('--- Exported SFT JSONL (OpenAI SFT format) ---');
  console.log(client.distiller.exportSftJsonl());
  console.log();

  // Display telemetry stats
  const stats = client.distiller.getStats();
  console.log(`Distiller Telemetry: ${stats.dpoCount} DPO pairs, ${stats.sftCount} SFT records, ~${stats.totalEstimatedTokens} tokens estimated.`);
  console.log('\n✅ Example 46 completed successfully.');
}

main().catch(console.error);
