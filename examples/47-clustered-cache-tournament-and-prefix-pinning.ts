/**
 * SinapsAI - Example 47: Clustered Semantic Cache, Swarm Tournament & KV-Cache Prefix Pinning
 *
 * Demonstrates:
 * 1. In-process Clustered Semantic Cache with sub-0.08ms centroid lookups.
 * 2. Multi-Model Tournament & Voting Consensus (Borda count, cluster grouping, dissent analysis).
 * 3. KV-Cache Prefix Pinning Optimizer guaranteeing byte-identical prefixes for 75%-90% token discounts.
 *
 * Run with: npx tsx examples/47-clustered-cache-tournament-and-prefix-pinning.ts
 */

import {
  ClusteredSemanticCache,
  KvCacheOptimizer,
  SinapsClient,
  type ChatMessage,
  type CreateChatCompletionRequest,
  type Provider,
  type ToolDefinition,
  type UnifiedApiResponse,
} from '../src/index.js';

async function main() {
  console.log('=== ⚡ SinapsAI v3.4.0: Clustered Cache, Tournament & Prefix Pinning ===\n');

  // =========================================================================
  // PILAR 1: Clustered Semantic Cache (Inverted Centroid Indexing)
  // =========================================================================
  console.log('--- 1. Clustered Semantic Cache (<0.08ms Centroid Lookup) ---');
  const cache = new ClusteredSemanticCache<string>({
    k: 4,
    similarityThreshold: 0.62,
    maxEntries: 100,
  });

  // Store multiple exemplar solutions across diverse domains
  await cache.set(
    'How do I implement a thread-safe LRU cache in TypeScript?',
    'Use a Map combined with a doubly linked list for O(1) get and set operations.',
    { metadata: { category: 'data-structures' } },
  );

  await cache.set(
    'What is the recommended recipe for traditional Italian carbonara?',
    'Use guanciale, pecorino romano, egg yolks, and freshly cracked black pepper. Avoid cream.',
    { metadata: { category: 'culinary' } },
  );

  // Query with semantic variations
  const query1 = 'thread safe lru cache typescript implementation';
  const hit1 = await cache.get(query1);

  console.log(`Query: "${query1}"`);
  if (hit1) {
    console.log(`[CACHE HIT] Cluster: ${hit1.clusterId} | Similarity: ${hit1.similarity} | Latency: ${hit1.latencyMs}ms`);
    console.log(`Response: "${hit1.value}"\n`);
  }

  const query2 = 'traditional italian pasta carbonara recipe';
  const hit2 = await cache.get(query2);

  console.log(`Query: "${query2}"`);
  if (hit2) {
    console.log(`[CACHE HIT] Cluster: ${hit2.clusterId} | Similarity: ${hit2.similarity} | Latency: ${hit2.latencyMs}ms`);
    console.log(`Response: "${hit2.value}"\n`);
  }

  const stats = cache.getStats();
  console.log('Cache Stats:', {
    totalEntries: stats.totalEntries,
    clusterCount: stats.clusterCount,
    hitRate: `${(stats.hitRate * 100).toFixed(1)}%`,
    avgClusterSize: stats.averageClusterSize,
  });
  console.log('\n--------------------------------------------------------------\n');

  // =========================================================================
  // PILAR 2: KV-Cache Prefix Pinning & Partitioning Optimizer
  // =========================================================================
  console.log('--- 2. KV-Cache Prefix Pinning Optimizer (75%-90% Token Discount) ---');
  const kvOptimizer = new KvCacheOptimizer({ minCacheTokens: 25 });

  const rawMessagesTurn1: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an enterprise AI architect. Current time: 2026-11-11T16:45:00Z. Always provide zero-dependency TypeScript code and strictly adhere to Anti-Slop standards.',
    },
    {
      role: 'user',
      content: 'Design an in-process circuit breaker.',
    },
  ];

  const rawMessagesTurn2: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an enterprise AI architect. Current time: 2026-11-11T17:30:15Z. Always provide zero-dependency TypeScript code and strictly adhere to Anti-Slop standards.',
    },
    {
      role: 'user',
      content: 'Now add exponential backoff retry support.',
    },
  ];

  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'validate_token',
        description: 'Validates JWT tokens.',
        parameters: { token: { type: 'string' } },
      },
    },
  ];

  const part1 = kvOptimizer.partition(rawMessagesTurn1, tools);
  const part2 = kvOptimizer.partition(rawMessagesTurn2, tools);

  console.log('Turn 1 Prefix Hash:', part1.prefixHash);
  console.log('Turn 2 Prefix Hash:', part2.prefixHash);
  console.log(`Are Prefix Hashes Byte-Identical? -> ${part1.prefixHash === part2.prefixHash ? '✅ YES (100% Cache Hit)' : '❌ NO'}`);

  console.log('\nOptimized Turn 1 System Content:');
  console.log(`"${part1.messages[0].content}"`);

  console.log('\nOptimized Turn 1 User Message with Relocated Runtime Context:');
  console.log(`"${part1.messages[1].content}"`);

  const savingsPrediction = kvOptimizer.predictCacheSavings(part1);
  console.log('\nPredicted Cache Savings:');
  console.log({
    predictedHitRate: `${(savingsPrediction.predictedHitRate * 100).toFixed(0)}%`,
    estimatedCachedTokens: savingsPrediction.estimatedCachedTokens,
    discountPercentage: `${savingsPrediction.discountPercentage}%`,
    estimatedSavingsUsd: `$${savingsPrediction.estimatedSavingsUsd}`,
  });
  console.log('\n--------------------------------------------------------------\n');

  // =========================================================================
  // PILAR 3: Multi-Model Tournament & Voting Consensus Swarm
  // =========================================================================
  console.log('--- 3. Multi-Model Tournament & Voting Consensus Swarm ---');

  // Mock Provider simulating 3 specialist agents + 1 synthesizer
  let callCount = 0;
  const mockProvider: Provider = {
    id: 'mock-frontier',
    name: 'Frontier Mock Provider',
    generateContent: async (_req: CreateChatCompletionRequest): Promise<UnifiedApiResponse> => {
      callCount++;
      if (callCount === 1) {
        // Agent 1: Lead Architect
        return {
          id: 'res-lead',
          model: 'claude-3-7-sonnet',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Recommendation: Deploy SQLite with Write-Ahead Logging (WAL) and Litestream replication for edge persistence.',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      if (callCount === 2) {
        // Agent 2: SRE Engineer (Aligned with Agent 1)
        return {
          id: 'res-sre',
          model: 'gemini-2.5-pro',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'We recommend SQLite with WAL mode and continuous streaming replication to S3 via Litestream.',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      if (callCount === 3) {
        // Agent 3: Dissenting Agent (Different paradigm)
        return {
          id: 'res-dissent',
          model: 'gpt-4o',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Recommendation: Deploy a managed multi-node Spanner database cluster with globally distributed consensus.',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      // Agent 4: Master Synthesizer
      return {
        id: 'res-synth',
        model: 'o3-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                'Synthesized Verdict: For edge environments, SQLite WAL with Litestream delivers optimal latency and zero operational overhead, while acknowledging Spanner as an alternative for global multi-region write scale.',
            },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  const client = new SinapsClient({
    providers: [mockProvider],
  });

  const swarm = client.swarm({
    agents: [
      { id: 'lead_architect', name: 'Lead Architect', role: 'Architect', instructions: 'Evaluate edge architecture.' },
      { id: 'sre_engineer', name: 'SRE Lead', role: 'SRE', instructions: 'Evaluate reliability.' },
      { id: 'cloud_expert', name: 'Cloud Specialist', role: 'Cloud', instructions: 'Evaluate distributed clouds.' },
      { id: 'synthesizer', name: 'Master Synthesizer', role: 'Judge', instructions: 'Synthesize consensus and dissent.' },
    ],
  });

  console.log('Running tournament consensus across 3 diverse agents...\n');
  const tournament = await swarm.runTournament({
    agentIds: ['lead_architect', 'sre_engineer', 'cloud_expert'],
    task: 'Determine the optimal edge storage architecture for a high-throughput microservice.',
    votingStrategy: 'borda',
    similarityThreshold: 0.55,
    synthesizerAgentId: 'synthesizer',
    onVoteProgress: (progress) => {
      console.log(`[Tournament Progress] Phase: ${progress.phase} ${progress.completedAgents ? `(${progress.completedAgents}/${progress.totalAgents})` : ''}`);
    },
  });

  console.log('\n=== 🏆 Tournament Consensus Outcome ===');
  console.log(`Winning Agent: ${tournament.winningAgentId}`);
  console.log(`Strategy: ${tournament.strategy} | Confidence: ${(tournament.confidence * 100).toFixed(1)}%`);
  console.log(`Total Clusters: ${tournament.clusters.length}`);
  console.log(`Dissenting Views Identified: ${tournament.dissentingViews.length}`);

  if (tournament.dissentingViews.length > 0) {
    console.log('\n[Minority Dissent Analysis]:');
    for (const d of tournament.dissentingViews) {
      console.log(`- Agent "${d.agentId}" (Vote Share: ${(d.voteShare * 100).toFixed(1)}%):`);
      console.log(`  "${d.content}"`);
    }
  }

  console.log('\n[Master Synthesized Content]:');
  console.log(tournament.synthesizedContent);

  // Check automated DPO distillation from tournament dissent
  const dpoRecords = client.distiller.getDpoRecords();
  console.log('\nAutomated DPO Distillation from Tournament:');
  console.log(`Recorded Pairs: ${dpoRecords.length}`);
  if (dpoRecords.length > 0) {
    console.log(`Chosen: "${dpoRecords[0].chosen.substring(0, 60)}..."`);
    console.log(`Rejected (Dissent): "${dpoRecords[0].rejected.substring(0, 60)}..."`);
  }

  console.log('\n✨ Example 47 Completed Successfully.');
}

main().catch(console.error);
