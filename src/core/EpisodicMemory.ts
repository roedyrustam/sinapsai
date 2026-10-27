/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Long-Term Episodic Vector Memory Engine
 *
 * Implements:
 * 1. User & tenant-partitioned memory storage.
 * 2. Zero-dependency cosine similarity vector search with local TF or dense embeddings.
 * 3. Dynamic context injection ([LONG-TERM MEMORY]) into conversational turns.
 * 4. Pluggable persistence with StateStorage (InMemory, KV, Redis, D1).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, TextContentPart } from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';
import type { StateStorage } from './StateStorage.js';

export interface MemoryRecord {
  id: string;
  userId?: string;
  text: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryStoreOptions {
  userId?: string;
  text?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface MemoryRecallOptions {
  query: string;
  userId?: string;
  topK?: number;
  minSimilarity?: number;
  minScore?: number;
  filter?: (record: MemoryRecord) => boolean;
  queryEmbedding?: number[];
}

export interface MemoryRecallResult {
  record: MemoryRecord;
  similarity: number;
}

export interface EpisodicMemoryOptions {
  storage?: StateStorage;
  /**
   * Optional custom embedding function: (text: string) => Promise<number[]>
   */
  customEmbed?: (text: string) => Promise<number[]>;
  /**
   * Default minimum similarity threshold for recall (default: 0.50).
   */
  defaultMinSimilarity?: number;
}

/**
 * Fast in-process character n-gram / term frequency vectorizer for zero-dependency embeddings.
 */
function createFastTfEmbedding(text: string, dimensions = 64): number[] {
  const vec = new Array(dimensions).fill(0);
  const clean = text.toLowerCase().replace(/[^\w\s]/g, ' ');
  const words = clean.split(/\s+/).filter((w) => w.length > 0);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % dimensions;
    vec[bucket] += 2;

    // Character 3-grams for subword matching (e.g. "preferences" vs "prefers")
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const trigram = word.substring(j, j + 3);
        let triHash = 0;
        for (let k = 0; k < trigram.length; k++) {
          triHash = (triHash << 5) - triHash + trigram.charCodeAt(k);
          triHash |= 0;
        }
        vec[Math.abs(triHash) % dimensions] += 1;
      }
    }
  }

  // L2 Normalize
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

export class EpisodicMemory {
  private records: Map<string, MemoryRecord> = new Map();
  private options: EpisodicMemoryOptions;

  constructor(options: EpisodicMemoryOptions = {}) {
    this.options = {
      defaultMinSimilarity: options.defaultMinSimilarity ?? 0.05,
      ...options,
    };
  }

  /**
   * Retrieves a memory record by ID.
   */
  public get(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Generates a numeric vector embedding for text using customEmbed or fast local TF vectorizer.
   */
  private async getEmbedding(text: string): Promise<number[]> {
    if (this.options.customEmbed) {
      return this.options.customEmbed(text);
    }
    return createFastTfEmbedding(text, 64);
  }

  /**
   * Stores a new memory fact or interaction.
   */
  public async store(options: MemoryStoreOptions): Promise<MemoryRecord> {
    const raw = options.text ?? options.content ?? '';
    const text = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!text) {
      throw new Error('Memory text must not be empty.');
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const embedding = options.embedding ?? (await this.getEmbedding(text));
    const now = Date.now();

    const record: MemoryRecord = {
      id,
      userId: options.userId,
      text,
      content: text,
      metadata: options.metadata,
      embedding,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(id, record);

    if (this.options.storage) {
      await this.options.storage.set(`sinaps_mem_${id}`, record);
    }

    return record;
  }

  /**
   * Recalls semantically relevant memory facts for a query.
   */
  public async recall(
    options: MemoryRecallOptions,
  ): Promise<MemoryRecallResult[]> {
    const query = options.query.trim();
    if (!query) return [];

    const topK = options.topK ?? 3;
    const minSim =
      options.minScore ??
      options.minSimilarity ??
      this.options.defaultMinSimilarity ??
      0.5;
    const queryVec = options.queryEmbedding ?? (await this.getEmbedding(query));

    const scored: MemoryRecallResult[] = [];

    for (const record of this.records.values()) {
      // User partition filtering
      if (options.userId && record.userId && record.userId !== options.userId) {
        continue;
      }
      if (options.filter && !options.filter(record)) {
        continue;
      }

      const similarity = cosineSimilarity(queryVec, record.embedding);
      if (similarity >= minSim) {
        scored.push({ record, similarity: Number(similarity.toFixed(4)) });
      }
    }

    // Sort descending by similarity
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  /**
   * Injects recalled memories directly into messages as a system instruction context block.
   */
  public async injectContext(
    messages: ChatMessage[],
    query: string,
    options: Omit<MemoryRecallOptions, 'query'> = {},
  ): Promise<ChatMessage[]> {
    const memories = await this.recall({ ...options, query });
    if (memories.length === 0) {
      return messages;
    }

    const contextText = [
      '[LONG-TERM EPISODIC MEMORY / USER FACTS]',
      ...memories.map(
        (m) =>
          `- ${m.record.text} (Relevance: ${(m.similarity * 100).toFixed(0)}%)`,
      ),
    ].join('\n');

    const result = [...messages];
    const systemIdx = result.findIndex((m) => m.role === 'system');

    if (systemIdx >= 0) {
      const existing = result[systemIdx];
      const existingContent =
        typeof existing.content === 'string'
          ? existing.content
          : Array.isArray(existing.content)
            ? existing.content
                .filter((p) => p.type === 'text')
                .map((p) => (p as TextContentPart).text)
                .join('\n')
            : '';

      result[systemIdx] = {
        role: 'system',
        content: `${existingContent}\n\n${contextText}`,
      };
    } else {
      result.unshift({
        role: 'system',
        content: contextText,
      });
    }

    return result;
  }

  /**
   * Alias for injectContext with explicit userId parameter.
   */
  public async injectIntoMessages(
    messages: ChatMessage[],
    query: string,
    userId?: string,
    options: Omit<MemoryRecallOptions, 'query' | 'userId'> = {},
  ): Promise<ChatMessage[]> {
    return this.injectContext(messages, query, { ...options, userId });
  }

  /**
   * Deletes a memory record by ID.
   */
  public async delete(id: string): Promise<boolean> {
    const existed = this.records.delete(id);
    if (this.options.storage) {
      await this.options.storage.delete(`sinaps_mem_${id}`);
    }
    return existed;
  }

  /**
   * Clears memory records, optionally filtered by userId.
   */
  public async clear(userId?: string): Promise<void> {
    if (userId) {
      for (const [id, record] of this.records.entries()) {
        if (record.userId === userId) {
          this.records.delete(id);
          if (this.options.storage) {
            await this.options.storage.delete(`sinaps_mem_${id}`);
          }
        }
      }
    } else {
      this.records.clear();
      if (
        this.options.storage &&
        typeof this.options.storage.clear === 'function'
      ) {
        await this.options.storage.clear();
      }
    }
  }

  /**
   * Returns total count of stored records.
   */
  public count(userId?: string): number {
    if (!userId) return this.records.size;
    let c = 0;
    for (const r of this.records.values()) {
      if (r.userId === userId) c++;
    }
    return c;
  }
}
