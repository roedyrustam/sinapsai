import { describe, expect, it } from 'vitest';
import { CognitiveBrain } from './CognitiveBrain.js';
import { InMemoryStorage } from './InMemoryStorage.js';

describe('CognitiveBrain (Tri-Memory Fusion Architecture)', () => {
  it('initializes memory, graph, and rag subsystems correctly', () => {
    const brain = new CognitiveBrain();
    expect(brain.memory).toBeDefined();
    expect(brain.graph).toBeDefined();
    expect(brain.rag).toBeDefined();
  });

  it('stores facts, adds triples, ingests documents, and retrieves unified context', async () => {
    const storage = new InMemoryStorage();
    const brain = new CognitiveBrain({ storage });

    // 1. Remember episodic fact
    await brain.rememberFact(
      'User prefers dark mode and concise responses.',
      'user_123',
    );

    // 2. Add relational triples to Knowledge Graph
    brain.addKnowledgeTriple({
      subject: 'SinapsAI',
      predicate: 'uses',
      object: 'Zero-Dependency Architecture',
      confidence: 1.0,
    });
    brain.addKnowledgeTriple({
      subject: 'SinapsAI',
      predicate: 'supports',
      object: 'Edge Runtimes',
      confidence: 0.9,
    });

    // 3. Ingest document into Hybrid RAG
    await brain.ingestDocument(
      'doc_arch',
      'SinapsAI is an in-process AI Gateway designed for maximum reliability with Circuit Breaker and lowest-latency routing.',
      { topic: 'architecture' },
    );

    // 4. Unified retrieval
    const result = await brain.retrieveContext({
      query: 'SinapsAI architecture and dark mode preferences',
      userId: 'user_123',
    });

    expect(result.query).toBe(
      'SinapsAI architecture and dark mode preferences',
    );
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts[0].record.text).toContain('dark mode');
    expect(result.subgraph.triples.length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.formattedPrompt).toContain(
      '[UNIFIED COGNITIVE BRAIN CONTEXT]',
    );
    expect(result.formattedPrompt).toContain('EPISODIC USER FACTS');
    expect(result.formattedPrompt).toContain('KNOWLEDGE GRAPH');
    expect(result.formattedPrompt).toContain('RETRIEVED KNOWLEDGE CONTEXT');
  });

  it('injects cognitive context into ChatMessage[] correctly', async () => {
    const brain = new CognitiveBrain();
    await brain.rememberFact('User is a TypeScript engineer.', 'u1');

    const context = await brain.retrieveContext({
      query: 'TypeScript programming',
      userId: 'u1',
    });

    const messages = [
      { role: 'system' as const, content: 'Base instruction.' },
      { role: 'user' as const, content: 'Help me write code.' },
    ];

    const injected = brain.injectIntoMessages(messages, context);
    expect(injected[0].content).toContain('Base instruction.');
    expect(injected[0].content).toContain('[UNIFIED COGNITIVE BRAIN CONTEXT]');
    expect(injected[0].content).toContain('TypeScript engineer');
  });
});
