/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Hybrid RAG Engine (BM25 + Dense Cosine + Reciprocal Rank Fusion)
 *
 * Implements:
 * 1. Semantic paragraph chunker with configurable max token / size and overlap.
 * 2. Pure in-memory Okapi BM25 inverted index for lexical keyword precision.
 * 3. Dense vector cosine similarity for deep semantic understanding.
 * 4. Reciprocal Rank Fusion (RRF) combining sparse + dense rank lists.
 * 5. Zero external dependencies, pure Web Standards.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { cosineSimilarity } from '../utils/similarity.js';

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  tokenCount: number;
}

export interface ChunkOptions {
  maxChunkSize?: number;
  overlap?: number;
}

export interface RagSearchOptions {
  query?: string;
  topK?: number;
  minScore?: number;
  /**
   * Balance between sparse lexical search and dense semantic search (0.0 to 1.0).
   * 0.0 = BM25 only, 1.0 = Dense Vector only, 0.5 = Balanced RRF (default).
   */
  hybridWeight?: number;
  /**
   * Optional pre-computed embedding vector for the query.
   */
  queryEmbedding?: number[];
}

export interface RagSearchResult {
  chunk: DocumentChunk;
  score: number;
  rrfScore?: number;
  denseScore?: number;
  bm25Rank?: number;
  vectorRank?: number;
}

export interface HybridRagOptions {
  /**
   * Default chunking options.
   */
  chunkOptions?: ChunkOptions;
  /**
   * Optional custom embedding function: (text: string) => Promise<number[]>
   */
  customEmbed?: (text: string) => Promise<number[]>;
}

/**
 * Splits text into semantic chunks respecting paragraphs, code fences, and sentences.
 */
export function chunkDocument(
  documentIdOrText: string,
  textOrOptions?: string | ChunkOptions,
  metadata?: Record<string, unknown>,
  options: ChunkOptions = {},
): DocumentChunk[] {
  let documentId: string;
  let text: string;
  let opts: ChunkOptions;
  let meta: Record<string, unknown> | undefined;

  if (typeof textOrOptions === 'string') {
    documentId = documentIdOrText;
    text = textOrOptions;
    meta = metadata;
    opts = options;
  } else {
    documentId = 'doc';
    text = documentIdOrText;
    opts = (textOrOptions as ChunkOptions) || {};
    meta = metadata;
  }

  const maxSize = opts.maxChunkSize ?? 800;
  const overlap = opts.overlap ?? 100;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  // Split into natural paragraph blocks
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: DocumentChunk[] = [];
  let currentBuffer = '';
  let chunkIdx = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentBuffer.length + trimmed.length + 2 <= maxSize) {
      currentBuffer =
        currentBuffer.length > 0 ? `${currentBuffer}\n\n${trimmed}` : trimmed;
    } else {
      if (currentBuffer.length > 0) {
        chunks.push({
          id: `${documentId}_chunk_${chunkIdx}`,
          documentId,
          chunkIndex: chunkIdx++,
          text: currentBuffer,
          metadata: meta,
          tokenCount: Math.ceil(currentBuffer.length / 4),
        });

        // Retain overlap tail
        const overlapStart = Math.max(0, currentBuffer.length - overlap);
        currentBuffer = currentBuffer.substring(overlapStart).trim();
      }

      // If single paragraph itself exceeds maxSize, slice by sentences or words
      if (trimmed.length > maxSize) {
        let segments = trimmed.split(/(?<=[.!?])\s+/);
        if (segments.length <= 1) {
          segments = trimmed.split(/\s+/);
        }
        for (const s of segments) {
          if (currentBuffer.length + s.length + 1 <= maxSize) {
            currentBuffer =
              currentBuffer.length > 0 ? `${currentBuffer} ${s}` : s;
          } else {
            if (currentBuffer.length > 0) {
              chunks.push({
                id: `${documentId}_chunk_${chunkIdx}`,
                documentId,
                chunkIndex: chunkIdx++,
                text: currentBuffer,
                metadata: meta,
                tokenCount: Math.ceil(currentBuffer.length / 4),
              });
              const overlapStart = Math.max(0, currentBuffer.length - overlap);
              currentBuffer = currentBuffer.substring(overlapStart).trim();
            }
            currentBuffer =
              currentBuffer.length > 0 ? `${currentBuffer} ${s}` : s;
          }
        }
      } else {
        currentBuffer =
          currentBuffer.length > 0 ? `${currentBuffer}\n\n${trimmed}` : trimmed;
      }
    }
  }

  if (currentBuffer.length > 0) {
    chunks.push({
      id: `${documentId}_chunk_${chunkIdx}`,
      documentId,
      chunkIndex: chunkIdx,
      text: currentBuffer,
      metadata: meta,
      tokenCount: Math.ceil(currentBuffer.length / 4),
    });
  }

  return chunks;
}

/**
 * Pure TypeScript In-Memory Okapi BM25 Index
 */
export class Bm25Index {
  private k1 = 1.5;
  private b = 0.75;
  private docFrequencies: Map<string, number> = new Map();
  private docLengths: Map<string, number> = new Map();
  private termFrequencies: Map<string, Map<string, number>> = new Map(); // docId -> (term -> count)
  private totalDocs = 0;
  private totalLength = 0;

  private tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  }

  public add(docId: string, text: string): void {
    const terms = this.tokenize(text);
    const length = terms.length;
    this.docLengths.set(docId, length);
    this.totalLength += length;
    this.totalDocs++;

    const tf = new Map<string, number>();
    const seenTerms = new Set<string>();

    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
      if (!seenTerms.has(term)) {
        seenTerms.add(term);
        this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
      }
    }

    this.termFrequencies.set(docId, tf);
  }

  public addDocument(docId: string, text: string): void {
    this.add(docId, text);
  }

  public scoreMap(query: string): Map<string, number> {
    const queryTerms = this.tokenize(query);
    const scores = new Map<string, number>();
    if (this.totalDocs === 0 || queryTerms.length === 0) return scores;

    const avgdl = this.totalLength / this.totalDocs;

    for (const term of queryTerms) {
      const df = this.docFrequencies.get(term) || 0;
      if (df === 0) continue;

      // Robertson-Spärck Jones IDF
      const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5));

      for (const [docId, tfMap] of this.termFrequencies.entries()) {
        const tf = tfMap.get(term) || 0;
        if (tf === 0) continue;

        const docLen = this.docLengths.get(docId) || avgdl;
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
        const termScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }

    return scores;
  }

  public score(query: string): Array<{ id: string; score: number }> {
    const scores = this.scoreMap(query);
    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score: Number(score.toFixed(4)) }))
      .sort((a, b) => b.score - a.score);
  }
}

/**
 * Combines ranked lists using Reciprocal Rank Fusion (RRF).
 */
export function reciprocalRankFusion(
  bm25Input: string[] | Map<string, number>,
  vectorInput: string[] | Map<string, number>,
  k = 60,
  bm25Weight = 0.5,
  vectorWeight = 0.5,
): Array<{
  id: string;
  score: number;
  bm25Rank?: number;
  vectorRank?: number;
}> {
  const toRankedIds = (input: string[] | Map<string, number>): string[] => {
    if (Array.isArray(input)) return input;
    return Array.from(input.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  };

  const bm25RankedIds = toRankedIds(bm25Input);
  const vectorRankedIds = toRankedIds(vectorInput);

  const combined = new Map<
    string,
    { id: string; score: number; bm25Rank?: number; vectorRank?: number }
  >();

  bm25RankedIds.forEach((id, rank) => {
    const rrf = (1 / (k + rank + 1)) * bm25Weight;
    const entry = combined.get(id) || { id, score: 0 };
    entry.score += rrf;
    entry.bm25Rank = rank + 1;
    combined.set(id, entry);
  });

  vectorRankedIds.forEach((id, rank) => {
    const rrf = (1 / (k + rank + 1)) * vectorWeight;
    const entry = combined.get(id) || { id, score: 0 };
    entry.score += rrf;
    entry.vectorRank = rank + 1;
    combined.set(id, entry);
  });

  return Array.from(combined.values()).sort((a, b) => b.score - a.score);
}

export class HybridRagEngine {
  private chunks: Map<string, DocumentChunk> = new Map();
  private bm25: Bm25Index = new Bm25Index();
  private options: HybridRagOptions;

  constructor(options: HybridRagOptions = {}) {
    this.options = options;
  }

  /**
   * Adds and indexes a full text document with automatic chunking.
   */
  public async addDocument(
    documentId: string,
    text: string,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentChunk[]> {
    const createdChunks = chunkDocument(
      documentId,
      text,
      metadata,
      this.options.chunkOptions,
    );

    for (const chunk of createdChunks) {
      if (this.options.customEmbed) {
        chunk.embedding = await this.options.customEmbed(chunk.text);
      }
      this.chunks.set(chunk.id, chunk);
      this.bm25.add(chunk.id, chunk.text);
    }

    return createdChunks;
  }

  /**
   * Executes hybrid search using BM25, dense vector cosine similarity, and RRF ranking.
   */
  public async search(
    queryOrOptions: string | RagSearchOptions,
    options?: RagSearchOptions,
  ): Promise<RagSearchResult[]> {
    const query =
      typeof queryOrOptions === 'string'
        ? queryOrOptions
        : queryOrOptions.query || '';
    const opts =
      typeof queryOrOptions === 'string' ? options || {} : queryOrOptions;

    const topK = opts.topK ?? 5;
    const weight = opts.hybridWeight ?? 0.5; // 0.0 = BM25 only, 1.0 = Vector only

    // 1. BM25 Lexical Search
    const bm25Ranked = this.bm25.score(query).map((r) => r.id);

    // 2. Dense Vector Search
    const vectorScores = new Map<string, number>();
    let queryVec = opts.queryEmbedding;
    if (!queryVec && this.options.customEmbed && query.length > 0) {
      queryVec = await this.options.customEmbed(query);
    }

    if (queryVec && queryVec.length > 0) {
      for (const chunk of this.chunks.values()) {
        if (chunk.embedding && chunk.embedding.length > 0) {
          const sim = Math.max(0, cosineSimilarity(queryVec, chunk.embedding));
          vectorScores.set(chunk.id, sim);
        }
      }
    }

    const vectorRanked = Array.from(vectorScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // 3. Reciprocal Rank Fusion
    const fused = reciprocalRankFusion(
      bm25Ranked,
      vectorRanked,
      60,
      1.0 - weight,
      weight,
    );

    const sortedIds = fused.slice(0, topK);

    const results: RagSearchResult[] = [];
    for (const item of sortedIds) {
      const chunk = this.chunks.get(item.id);
      if (chunk) {
        results.push({
          chunk,
          score: Number(item.score.toFixed(6)),
          rrfScore: Number(item.score.toFixed(6)),
          denseScore: vectorScores.get(item.id) ?? 0.5,
          bm25Rank: item.bm25Rank,
          vectorRank: item.vectorRank,
        });
      }
    }
    return results;
  }

  /**
   * Formats search results into a clean context block ready for system instructions.
   */
  public formatForPrompt(results: RagSearchResult[]): string {
    if (results.length === 0) return '';
    const items = results.map(
      (r, i) => `[Source ${i + 1} (${r.chunk.documentId})]:\n${r.chunk.text}`,
    );
    return `[RETRIEVED KNOWLEDGE CONTEXT]\n${items.join('\n\n')}`;
  }

  /**
   * Returns total chunk count in index.
   */
  public getChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Alias for getChunkCount().
   */
  public count(): number {
    return this.chunks.size;
  }

  /**
   * Deletes all chunks associated with a document ID.
   */
  public deleteDocument(documentId: string): void {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.documentId === documentId) {
        this.chunks.delete(id);
      }
    }
    // Rebuild BM25 index
    this.bm25 = new Bm25Index();
    for (const chunk of this.chunks.values()) {
      this.bm25.add(chunk.id, chunk.text);
    }
  }

  /**
   * Clears all documents and resets the index.
   */
  public clear(): void {
    this.chunks.clear();
    this.bm25 = new Bm25Index();
  }
}
