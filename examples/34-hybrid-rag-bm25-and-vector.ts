/**
 * Example 34: In-Process Hybrid RAG (BM25 + Dense Cosine + Reciprocal Rank Fusion)
 *
 * Demonstrates:
 * 1. Semantic paragraph chunker with configurable size and overlap.
 * 2. Pure in-memory Okapi BM25 inverted index for exact keyword matching.
 * 3. Dense vector cosine similarity for conceptual understanding.
 * 4. Reciprocal Rank Fusion (RRF) mathematically merging sparse + dense rankings.
 * 5. Prompt context block synthesis for LLM generation.
 */

import {
  Bm25Index,
  chunkDocument,
  HybridRagEngine,
  reciprocalRankFusion,
} from '../src/index.js';

async function main() {
  console.log(
    '=== 1. In-Process Hybrid RAG Engine (BM25 + Dense Vector + RRF) ===\n',
  );

  const rag = new HybridRagEngine({
    chunkOptions: { maxChunkSize: 400, overlap: 60 },
  });

  console.log('--- A. Indexing Knowledge Documents ---');
  await rag.addDocument(
    'sinaps_arch',
    `SinapsAI is an ultra-fast, zero-dependency in-process AI gateway and control plane written in TypeScript.
It runs anywhere: Node.js 18+, Bun, Deno, Cloudflare Workers, and Browser environments.
Key internal components include Router, McpBridge, CircuitBreaker, LlmOptimizer, and RateLimiter.`,
    { category: 'core_architecture' },
  );

  await rag.addDocument(
    'sinaps_finops',
    `SinapsAI incorporates FinOps telemetry, budget guardrails, token estimation, and prompt caching prefix optimization.
By canonicalizing tool definitions and deduplicating system prompts, SinapsAI maximizes KV-cache hit rates on frontier models like Gemini and Claude.`,
    { category: 'finops' },
  );

  await rag.addDocument(
    'sinaps_swarms',
    `AgentSwarm enables autonomous specialist agent collaboration using the A2A (Agent-to-Agent) protocol.
Each agent in the swarm can be equipped with an autonomous micro-economy budget wallet to strictly cap spend and prevent runaway token loops.`,
    { category: 'swarms' },
  );

  console.log(`Indexed Total Chunks: ${rag.count()}\n`);

  console.log('--- B. Performing Hybrid Retrieval ---');
  const query = 'How does SinapsAI optimize KV-cache hit rates and FinOps?';
  console.log(`Search Query: "${query}"\n`);

  const results = await rag.search(query, { topK: 2, hybridWeight: 0.5 });

  for (const [idx, item] of results.entries()) {
    console.log(`Result #${idx + 1} [RRF Score: ${item.score}]:`);
    console.log(`  Document: ${item.chunk.documentId}`);
    console.log(`  BM25 Rank: ${item.bm25Rank ?? 'N/A'}`);
    console.log(`  Vector Rank: ${item.vectorRank ?? 'N/A'}`);
    console.log(`  Text:\n  "${item.chunk.text}"\n`);
  }

  console.log('--- C. Formatted Prompt Context for LLM Ingestion ---');
  const promptContext = rag.formatForPrompt(results);
  console.log(promptContext);

  console.log('\n--- D. Standalone BM25 Inverted Index & RRF Scoring ---');
  const bm25 = new Bm25Index();
  bm25.add(
    'd1',
    'PostgreSQL relational database with pgvector high performance indexing.',
  );
  bm25.add('d2', 'Redis in-memory caching and distributed pubsub messaging.');
  bm25.add(
    'd3',
    'ClickHouse real-time columnar analytics database for massive log telemetry.',
  );

  const bm25Matches = bm25.score('PostgreSQL relational database');
  console.log('BM25 Matches for "PostgreSQL relational database":');
  for (const m of bm25Matches) {
    console.log(`  - Doc: ${m.id}, Score: ${m.score}`);
  }

  // Pure RRF Demo
  const fusedRrf = reciprocalRankFusion(['d1', 'd2'], ['d2', 'd3'], 60);
  console.log('\nReciprocal Rank Fusion Output:');
  for (const f of fusedRrf) {
    console.log(
      `  - Doc: ${f.id}, Score: ${f.score.toFixed(5)} (BM25 Rank: ${f.bm25Rank ?? 'none'}, Vector Rank: ${f.vectorRank ?? 'none'})`,
    );
  }
}

main().catch(console.error);
