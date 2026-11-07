/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Unified In-Process Cognitive Brain (Tri-Memory Fusion Architecture)
 *
 * Implements:
 * 1. Tri-Memory Fusion: Unifies Episodic Vector Memory (user facts),
 *    In-Memory Knowledge Graph (relational triples & multi-hop traversal),
 *    and Hybrid RAG (BM25 sparse + dense cosine Reciprocal Rank Fusion).
 * 2. Unified context retrieval synthesizing all three memory pillars into a single
 *    structured system prompt section.
 * 3. Dynamic conversational injection ([UNIFIED COGNITIVE BRAIN CONTEXT]).
 * 4. Zero runtime dependencies, edge-ready, with LRU memory safeguards.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, TextContentPart } from '../types/index.js';
import {
  EpisodicMemory,
  type EpisodicMemoryOptions,
  type MemoryRecallResult,
  type MemoryRecord,
  type MemoryStoreOptions,
} from './EpisodicMemory.js';
import {
  type DocumentChunk,
  HybridRagEngine,
  type HybridRagOptions,
  type RagSearchResult,
} from './HybridRag.js';
import {
  type GraphTriple,
  KnowledgeGraph,
  type KnowledgeGraphOptions,
  type SubGraphResult,
} from './KnowledgeGraph.js';
import type { StateStorage } from './StateStorage.js';

export interface CognitiveBrainOptions {
  storage?: StateStorage;
  episodic?: EpisodicMemoryOptions;
  graph?: KnowledgeGraphOptions;
  rag?: HybridRagOptions;
  maxRecentMemoryEntries?: number;
}

export interface CognitiveRetrieveOptions {
  query: string;
  userId?: string;
  maxFacts?: number;
  maxGraphDepth?: number;
  maxChunks?: number;
  minSimilarity?: number;
}

export interface CognitiveContextResult {
  query: string;
  facts: MemoryRecallResult[];
  subgraph: SubGraphResult;
  chunks: RagSearchResult[];
  formattedPrompt: string;
  totalTokensEstimate: number;
}

export class CognitiveBrain {
  public readonly memory: EpisodicMemory;
  public readonly graph: KnowledgeGraph;
  public readonly rag: HybridRagEngine;
  private readonly maxRecentMemoryEntries: number;
  private recentEntries: string[] = [];

  constructor(options: CognitiveBrainOptions = {}) {
    this.memory = new EpisodicMemory({
      storage: options.storage,
      ...options.episodic,
    });
    this.graph = new KnowledgeGraph(options.graph);
    this.rag = new HybridRagEngine(options.rag);
    this.maxRecentMemoryEntries = options.maxRecentMemoryEntries ?? 500;
  }

  /**
   * Stores an episodic memory fact for a user or tenant.
   */
  public async rememberFact(
    fact: string | MemoryStoreOptions,
    userId?: string,
  ): Promise<MemoryRecord> {
    const opts: MemoryStoreOptions =
      typeof fact === 'string'
        ? { text: fact, userId: userId }
        : { ...fact, userId: fact.userId || userId };

    const record = await this.memory.store(opts);

    // Track in LRU array to monitor memory usage
    if (this.recentEntries.length >= this.maxRecentMemoryEntries) {
      this.recentEntries.shift();
    }
    this.recentEntries.push(record.id);

    return record;
  }

  /**
   * Adds a relational triple (subject - predicate - object) to the Knowledge Graph.
   */
  public addKnowledgeTriple(triple: GraphTriple): void {
    this.graph.addTriple(triple);
  }

  /**
   * Automatically extracts triples from text and adds them to the Knowledge Graph.
   */
  public ingestKnowledgeFromText(text: string): GraphTriple[] {
    const triples = this.graph.extractTriplesFromText(text);
    for (const t of triples) {
      this.graph.addTriple(t);
    }
    return triples;
  }

  /**
   * Ingests and chunks a reference document into the Hybrid RAG engine (BM25 + Dense Vectors).
   */
  public async ingestDocument(
    documentId: string,
    text: string,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentChunk[]> {
    return this.rag.addDocument(documentId, text, metadata);
  }

  /**
   * Performs unified cross-memory context retrieval:
   * 1. Recalls relevant user episodic memory facts.
   * 2. Traverses knowledge graph relations around key terms in the query.
   * 3. Executes hybrid RAG search across indexed documents.
   * 4. Combines and synthesizes all three sources into an optimized Markdown prompt section.
   */
  public async retrieveContext(
    options: CognitiveRetrieveOptions,
  ): Promise<CognitiveContextResult> {
    const {
      query,
      userId,
      maxFacts = 5,
      maxGraphDepth = 2,
      maxChunks = 4,
      minSimilarity = 0.25,
    } = options;

    // 1. Recall episodic memory facts
    const factsPromise = this.memory.recall({
      query,
      userId,
      topK: maxFacts,
      minSimilarity,
    });

    // 2. Hybrid RAG document retrieval
    const ragPromise = this.rag.search({
      query,
      topK: maxChunks,
    });

    const [facts, chunks] = await Promise.all([factsPromise, ragPromise]);

    // 3. Knowledge Graph traversal around query terms
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const subgraph = this.graph.findSubGraph(queryTokens, maxGraphDepth);

    // 4. Synthesize unified formatted markdown prompt
    const sections: string[] = [];

    if (facts.length > 0) {
      const factLines = facts
        .map((f, i) => `${i + 1}. ${f.record.text}`)
        .join('\n');
      sections.push(`### [EPISODIC USER FACTS]\n${factLines}`);
    }

    if (subgraph.triples.length > 0) {
      const graphText = this.graph.toContextPrompt(subgraph);
      sections.push(graphText);
    }

    if (chunks.length > 0) {
      const ragText = this.rag.formatForPrompt(chunks);
      sections.push(ragText);
    }

    const formattedPrompt =
      sections.length > 0
        ? `\n\n[UNIFIED COGNITIVE BRAIN CONTEXT]:\n${sections.join('\n\n')}\n`
        : '';

    // Estimate tokens (~4 characters per token)
    const totalTokensEstimate = Math.ceil(formattedPrompt.length / 4);

    return {
      query,
      facts,
      subgraph,
      chunks,
      formattedPrompt,
      totalTokensEstimate,
    };
  }

  /**
   * Injects retrieved cognitive context cleanly into the system instruction of ChatMessage[].
   */
  public injectIntoMessages(
    messages: ChatMessage[],
    contextResult: CognitiveContextResult,
  ): ChatMessage[] {
    if (!contextResult.formattedPrompt) {
      return [...messages];
    }

    const result = [...messages];
    const systemIndex = result.findIndex((m) => m.role === 'system');

    if (systemIndex >= 0) {
      const sysMsg = result[systemIndex];
      let newContent: string;
      if (typeof sysMsg.content === 'string') {
        newContent = `${sysMsg.content}${contextResult.formattedPrompt}`;
      } else if (Array.isArray(sysMsg.content)) {
        const textPart = sysMsg.content.find(
          (p): p is TextContentPart => p.type === 'text',
        );
        if (textPart) {
          textPart.text = `${textPart.text}${contextResult.formattedPrompt}`;
          newContent = ''; // Handled by reference
        } else {
          newContent = contextResult.formattedPrompt;
        }
      } else {
        newContent = contextResult.formattedPrompt;
      }

      if (newContent) {
        result[systemIndex] = {
          ...sysMsg,
          content: newContent,
        };
      }
    } else {
      // Prepend a new system message
      result.unshift({
        role: 'system',
        content: `You are an intelligent assistant with access to cognitive memory.\n${contextResult.formattedPrompt}`,
      });
    }

    return result;
  }
}
