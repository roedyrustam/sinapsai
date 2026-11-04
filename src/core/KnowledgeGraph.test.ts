import { describe, expect, it } from 'vitest';
import { KnowledgeGraph } from './KnowledgeGraph.js';

describe('In-Process KnowledgeGraph & GraphRAG Traversal', () => {
  it('should add nodes and directed edges correctly', () => {
    const kg = new KnowledgeGraph();
    kg.addNode({ id: 'SinapsAI', label: 'SinapsAI', type: 'Gateway' });
    kg.addNode({ id: 'TypeScript', label: 'TypeScript', type: 'Language' });
    kg.addEdge({
      sourceId: 'SinapsAI',
      targetId: 'TypeScript',
      relation: 'written_in',
      weight: 1.0,
    });

    expect(kg.hasNode('sinapsai')).toBe(true);
    expect(kg.hasNode('typescript')).toBe(true);
    expect(kg.getAllNodes().length).toBe(2);
    expect(kg.getAllEdges().length).toBe(1);
    expect(kg.getAllEdges()[0].relation).toBe('written_in');
  });

  it('should add triples and auto-create nodes', () => {
    const kg = new KnowledgeGraph();
    kg.addTriple({
      subject: 'Roedy',
      predicate: 'created',
      object: 'SinapsAI',
      confidence: 1.0,
    });

    expect(kg.hasNode('roedy')).toBe(true);
    expect(kg.hasNode('sinapsai')).toBe(true);
    expect(kg.getAllEdges().length).toBe(1);
  });

  it('should traverse multi-hop paths with decay scoring', () => {
    const kg = new KnowledgeGraph();
    kg.addTriple({ subject: 'Alice', predicate: 'knows', object: 'Bob' });
    kg.addTriple({ subject: 'Bob', predicate: 'works_at', object: 'Google' });
    kg.addTriple({ subject: 'Google', predicate: 'created', object: 'Gemini' });

    const paths = kg.traverseMultiHop('Alice', 3);
    expect(paths.length).toBeGreaterThan(0);

    // Deepest path should connect Alice -> Bob -> Google -> Gemini
    const deepest = paths.find((p) => p.depth === 3);
    expect(deepest).toBeDefined();
    expect(deepest?.nodes.map((n) => n.label)).toEqual([
      'Alice',
      'Bob',
      'Google',
      'Gemini',
    ]);
    expect(deepest?.score).toBeLessThan(1.0); // decay applied
  });

  it('should extract rule-based triples from natural text', () => {
    const kg = new KnowledgeGraph();
    const text = 'SinapsAI is a control plane. Roedy created SinapsAI.';
    const triples = kg.extractTriplesFromText(text);

    expect(triples.length).toBeGreaterThanOrEqual(1);
    expect(
      triples.some((t) => t.predicate === 'is_a' || t.predicate === 'created'),
    ).toBe(true);
  });

  it('should synthesize connected subgraphs into context prompt markdown', () => {
    const kg = new KnowledgeGraph();
    kg.addTriple({
      subject: 'SinapsAI',
      predicate: 'supports',
      object: 'OpenAI',
    });
    kg.addTriple({
      subject: 'SinapsAI',
      predicate: 'supports',
      object: 'Gemini',
    });
    kg.addTriple({
      subject: 'Gemini',
      predicate: 'has_model',
      object: 'Gemini 2.5 Flash',
    });

    const subGraph = kg.findSubGraph(['SinapsAI'], 2);
    expect(subGraph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(subGraph.triples.length).toBeGreaterThanOrEqual(2);

    const prompt = kg.toContextPrompt(subGraph);
    expect(prompt).toContain('KNOWLEDGE GRAPH / RELATIONAL FACTS:');
    expect(prompt).toContain('SinapsAI');
    expect(prompt).toContain('Gemini');
  });
});
