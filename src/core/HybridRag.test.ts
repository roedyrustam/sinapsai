/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Tests for Hybrid RAG Engine (BM25 + Dense Cosine + Reciprocal Rank Fusion)
 */

import { describe, expect, it } from 'vitest';
import {
  Bm25Index,
  chunkDocument,
  HybridRagEngine,
  reciprocalRankFusion,
} from './HybridRag.js';
import { SinapsClient } from './SinapsClient.js';

describe('HybridRagEngine', () => {
  describe('chunkDocument', () => {
    it('splits text into semantic paragraphs when within size limits', () => {
      const text = `Paragraph 1: Welcome to SinapsAI.\n\nParagraph 2: It is an ultra-fast AI Gateway.\n\nParagraph 3: Zero runtime dependencies.`;
      const chunks = chunkDocument(text, { maxChunkSize: 100, overlap: 0 });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toContain('Paragraph 1');
    });

    it('handles long uninterrupted texts with sliding window overlap', () => {
      const longText = 'word '.repeat(300);
      const chunks = chunkDocument(longText, {
        maxChunkSize: 100,
        overlap: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[1].chunkIndex).toBe(1);
    });
  });

  describe('Bm25Index', () => {
    it('indexes and scores documents using Okapi BM25 ranking', () => {
      const bm25 = new Bm25Index();
      bm25.addDocument(
        'doc1',
        'TypeScript is a strongly typed programming language that builds on JavaScript.',
      );
      bm25.addDocument(
        'doc2',
        'Rust is a systems programming language focused on safety and memory efficiency.',
      );
      bm25.addDocument(
        'doc3',
        'Python is known for simplicity, readability, and machine learning libraries.',
      );

      const results = bm25.score(
        'TypeScript strongly typed programming language',
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('doc1');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('returns empty scores for non-matching queries', () => {
      const bm25 = new Bm25Index();
      bm25.addDocument('d1', 'apple orange banana fruit');
      const results = bm25.score('quantum teleportation entanglement');
      expect(results.length).toBe(0);
    });
  });

  describe('reciprocalRankFusion (RRF)', () => {
    it('fuses dense and sparse rankings with standard RRF formula', () => {
      const dense = new Map<string, number>([
        ['chunk_a', 0.95],
        ['chunk_b', 0.85],
        ['chunk_c', 0.7],
      ]);
      const sparse = new Map<string, number>([
        ['chunk_b', 12.5],
        ['chunk_a', 8.0],
        ['chunk_d', 5.0],
      ]);

      const fused = reciprocalRankFusion(dense, sparse, 60);

      expect(fused.length).toBe(4);
      // chunk_a and chunk_b are high in both, so they should top the fused results
      const topIds = [fused[0].id, fused[1].id];
      expect(topIds).toContain('chunk_a');
      expect(topIds).toContain('chunk_b');
    });
  });

  describe('HybridRagEngine End-to-End', () => {
    it('indexes documents and performs hybrid retrieval', async () => {
      const rag = new HybridRagEngine();

      await rag.addDocument(
        'kb_arch',
        'SinapsAI architecture consists of a Router, McpBridge, CircuitBreaker, and LLMOptimizer. It runs entirely in-process.',
        { category: 'architecture' },
      );

      await rag.addDocument(
        'kb_billing',
        'SinapsAI includes an immutable double-entry ledger, DOKU payment gateway, and SNAP BI Direct API.',
        { category: 'fintech' },
      );

      await rag.addDocument(
        'kb_agent',
        'AgentSwarm coordinates autonomous specialist agents with A2A protocol and budget wallets.',
        { category: 'agents' },
      );

      expect(rag.count()).toBeGreaterThanOrEqual(3);

      const searchResults = await rag.search({
        query: 'What components make up SinapsAI architecture in-process?',
        topK: 2,
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].chunk.documentId).toBe('kb_arch');
      expect(searchResults[0].chunk.text).toContain('Router');
      expect(searchResults[0].rrfScore).toBeGreaterThan(0);
      expect(searchResults[0].denseScore).toBeGreaterThan(0);
    });

    it('supports deleting documents and clearing the index', async () => {
      const rag = new HybridRagEngine();

      await rag.addDocument('doc_to_delete', 'Temporary test information.');
      expect(rag.count()).toBe(1);

      rag.deleteDocument('doc_to_delete');
      expect(rag.count()).toBe(0);

      await rag.addDocument('doc_x', 'Content X');
      await rag.addDocument('doc_y', 'Content Y');
      expect(rag.count()).toBe(2);

      rag.clear();
      expect(rag.count()).toBe(0);
    });

    it('integrates with SinapsClient directly via client.rag', async () => {
      const client = new SinapsClient({
        providers: [
          {
            id: 'mock-p',
            name: 'mock',
            models: ['m1'],
            apiKey: 'key',
          },
        ],
      });

      expect(client.rag).toBeInstanceOf(HybridRagEngine);
      await client.rag.addDocument(
        'guide',
        'Getting started guide for developer experience and CLI.',
      );
      const res = await client.rag.search({ query: 'getting started guide' });
      expect(res.length).toBe(1);
      expect(res[0].chunk.documentId).toBe('guide');
    });
  });
});
