/**
 * Example 37: In-Process GraphRAG (Knowledge Graph Triples & Multi-Hop Traversal)
 *
 * Demonstrates:
 * 1. Building an in-memory Knowledge Graph with nodes, edges, and triples.
 * 2. Multi-hop traversal to discover indirect relations (A -> B -> C -> D).
 * 3. Extracting connected subgraphs and compiling into markdown for LLM system context.
 */

import { KnowledgeGraph } from '../src/index.js';

const kg = new KnowledgeGraph();

// Add Knowledge Triples
kg.addTriples([
  { subject: 'SinapsAI', predicate: 'created_by', object: 'Roedy Rustam' },
  { subject: 'SinapsAI', predicate: 'supports', object: 'Google Gemini' },
  { subject: 'SinapsAI', predicate: 'supports', object: 'Anthropic Claude' },
  { subject: 'Google Gemini', predicate: 'offers_model', object: 'Gemini 2.5 Flash' },
  { subject: 'Gemini 2.5 Flash', predicate: 'features', object: 'Dynamic Thinking Budget' },
]);

// Multi-Hop Traversal from SinapsAI
console.log('--- Multi-Hop Paths from SinapsAI ---');
const paths = kg.traverseMultiHop('SinapsAI', 3);
for (const path of paths) {
  const chain = path.nodes.map((n) => n.label).join(' ➔ ');
  console.log(`Path (depth ${path.depth}, score: ${path.score.toFixed(2)}): ${chain}`);
}

// Find Subgraph and synthesize into prompt markdown
const subGraph = kg.findSubGraph(['SinapsAI'], 2);
console.log('\n--- Synthesized GraphRAG Context for LLM Prompt ---');
console.log(kg.toContextPrompt(subGraph));
