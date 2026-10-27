/**
 * Example 31: Universal LLM Optimization (LLMO) Control Plane
 *
 * Demonstrates:
 * 1. Universal Prompt Token Minification & Whitespace Pruning (code-block aware).
 * 2. System Instruction Deduplication & Normalization.
 * 3. Deterministic KV-Cache Prefix Alignment & Tool Schema Canonicalization.
 * 4. Multi-Signal Complexity Analysis & Adaptive Model Cascading (Tier 1/2/3).
 * 5. Dynamic Thinking Budget Allocation & FinOps Savings Telemetry.
 */

import {
  type ChatMessage,
  type CreateChatCompletionRequest,
  LlmOptimizer,
  type Provider,
  SinapsClient,
  type ToolDefinition,
  type UnifiedApiResponse,
} from '../src/index.js';

async function main() {
  console.log('=== 1. Universal LLM Optimization Engine (LLMO) Standalone ===\n');

  const optimizer = new LlmOptimizer({
    enabled: true,
    minifyPrompts: true,
    minificationMode: 'lossless',
    deduplicateSystem: true,
    alignKvCachePrefix: true,
    autoCascadeModel: true,
    cascadeTiers: {
      tier1: 'gemini-2.5-flash-lite',
      tier2: 'gemini-2.5-flash',
      tier3: 'gemini-2.5-pro',
    },
  });

  // A. Prompt with redundant whitespace and formatting containing code
  const unoptimizedPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a Senior Systems Architect.   \n\n\n\nAlways adhere to clean code principles.',
    },
    {
      role: 'system',
      content: 'Always adhere to clean code principles.\nOutput production-grade TypeScript.',
    },
    {
      role: 'user',
      content: `   Please   review    this function   with too    many spaces:



\`\`\`typescript
function calculateThroughput(bytes: number, ms: number): number {
    // Indentation inside code blocks must remain 100% intact!
    if (ms <= 0) {
        return 0;
    }
    return (bytes / 1024) / (ms / 1000);
}
\`\`\`

Explain the concurrency overhead   and    benchmark the result.   `,
    },
  ];

  console.log('--- Original Prompt (Character count: %d) ---', JSON.stringify(unoptimizedPrompt).length);

  const optimizationResult = optimizer.optimize({
    model: 'auto',
    messages: unoptimizedPrompt,
  });

  console.log('Tokens before optimization:', optimizationResult.originalTokens);
  console.log('Tokens after optimization: ', optimizationResult.optimizedTokens);
  console.log('Tokens saved:             ', optimizationResult.tokensSaved);
  console.log('Savings ratio:            ', `${(optimizationResult.savingsRatio * 100).toFixed(1)}%`);
  console.log('Complexity score:         ', optimizationResult.complexity.score);
  console.log('Complexity tier:          ', optimizationResult.complexity.tier);
  console.log('Complexity signals:       ', optimizationResult.complexity.signals.join(', '));
  console.log('Cascaded Model:           ', optimizationResult.cascadeModel);
  console.log('Recommended Thinking:     ', optimizationResult.thinkingBudget);

  console.log('\n--- Minified Messages ---');
  for (const m of optimizationResult.messages) {
    console.log(`[${m.role.toUpperCase()}]:\n${m.content}\n`);
  }

  console.log('=== 2. Deterministic KV-Cache Prefix Alignment ===\n');

  const unalignedTools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'zeta_analytics',
        description: 'Performs statistical aggregation',
        parameters: {
          window_size: 60,
          metric: 'p99_latency',
          aggregation: { order: 'desc', fields: ['ts', 'val'] },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'alpha_circuit',
        description: 'Inspects circuit breaker state',
      },
    },
  ];

  const alignedTools = optimizer.optimize({
    model: 'auto',
    messages: [{ role: 'user', content: 'check health' }],
    tools: unalignedTools,
  }).tools;

  console.log('Lexicographically Sorted Tool Names:');
  for (const t of alignedTools || []) {
    console.log(`- ${t.function.name}`);
  }

  console.log('\n=== 3. Integrated SinapsClient with LLMO Enabled ===\n');

  let executedModel = '';
  let executedPromptLength = 0;

  const mockProvider: Provider = {
    id: 'mock-frontier',
    name: 'Frontier Provider',
    generateContent: async (req: CreateChatCompletionRequest) => {
      executedModel = req.model || 'default';
      executedPromptLength = JSON.stringify(req.messages).length;
      const res: UnifiedApiResponse = {
        id: 'llmo-resp-1',
        model: req.model || 'default',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'LLMO-optimized execution succeeded with minimal token footprint.',
            },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 25,
          completionTokens: 12,
          totalTokens: 37,
        },
      };
      return res;
    },
  };

  const client = new SinapsClient({
    providers: [mockProvider],
    llmo: {
      enabled: true,
      minifyPrompts: true,
      autoCascadeModel: true,
      cascadeTiers: {
        tier1: 'gemini-2.5-flash-lite',
        tier2: 'gemini-2.5-flash',
        tier3: 'gemini-2.5-pro',
      },
    },
  });

  // Query 1: Simple greeting (auto-cascaded to Tier 1: gemini-2.5-flash-lite)
  console.log('Executing Simple Query ("hi"):');
  await client.chat.completions.create({
    model: 'auto',
    messages: [{ role: 'user', content: '   hi   there!   ' }],
  });
  console.log(`-> Dispatched to: ${executedModel} (${executedPromptLength} characters)`);

  // Query 2: Deep reasoning prompt (auto-cascaded to Tier 3: gemini-2.5-pro)
  console.log('\nExecuting Deep Architecture Query:');
  await client.chat.completions.create({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content:
          'Architect a formal proof for distributed deadlock prevention in concurrent raft algorithms with step-by-step benchmark and security audit.',
      },
    ],
  });
  console.log(`-> Dispatched to: ${executedModel} (${executedPromptLength} characters)`);

  console.log('\n=== 4. LLMO FinOps Savings Telemetry ===\n');
  const metrics = client.getMetrics();
  console.log('Total Optimized Requests:', metrics.llmoMetrics?.totalOptimizedRequests);
  console.log('Total Tokens Saved:      ', metrics.llmoMetrics?.totalTokensSaved);
  console.log('Total Estimated USD Saved: $', metrics.llmoMetrics?.totalEstimatedUsdSaved.toFixed(5));
  console.log('Avg Compression Ratio:   ', `${((1 - (metrics.llmoMetrics?.averageCompressionRatio || 1)) * 100).toFixed(1)}% token reduction`);
  console.log('Cascaded Requests Count: ', metrics.llmoMetrics?.cascadedRequestsCount);

  console.log('\n[PASS] Example 31 completed successfully.');
}

main().catch(console.error);
