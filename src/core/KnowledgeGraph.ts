/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Knowledge Graph & GraphRAG Traversal Engine
 *
 * Implements:
 * 1. Zero-dependency in-memory graph representation (Adjacency List).
 * 2. Triples extraction (Subject - Predicate - Object).
 * 3. Multi-Hop BFS / DFS graph traversal and path scoring.
 * 4. Subgraph synthesis formatted for LLM system prompt injection.
 * 5. Integration with Hybrid RAG for multi-hop relational retrieval.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  properties?: Record<string, unknown>;
  weight?: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  properties?: Record<string, unknown>;
}

export interface GraphTriple {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
  score: number;
  depth: number;
}

export interface SubGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  triples: GraphTriple[];
  paths: GraphPath[];
}

export interface KnowledgeGraphOptions {
  caseSensitive?: boolean;
  maxDefaultDepth?: number;
  defaultEdgeWeight?: number;
}

export class KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private adjacency: Map<string, Set<string>> = new Map(); // nodeId -> Set of edgeIds
  private incoming: Map<string, Set<string>> = new Map(); // nodeId -> Set of incoming edgeIds
  private options: Required<KnowledgeGraphOptions>;

  constructor(options: KnowledgeGraphOptions = {}) {
    this.options = {
      caseSensitive: options.caseSensitive ?? false,
      maxDefaultDepth: options.maxDefaultDepth ?? 3,
      defaultEdgeWeight: options.defaultEdgeWeight ?? 1.0,
    };
  }

  private normalizeId(id: string): string {
    return this.options.caseSensitive ? id.trim() : id.trim().toLowerCase();
  }

  /**
   * Adds or updates a node in the graph.
   */
  public addNode(node: {
    id: string;
    label?: string;
    type?: string;
    properties?: Record<string, unknown>;
    weight?: number;
  }): GraphNode {
    const id = this.normalizeId(node.id);
    const existing = this.nodes.get(id);

    const fullNode: GraphNode = {
      id,
      label: node.label || node.id,
      type: node.type || existing?.type || 'entity',
      properties: {
        ...(existing?.properties || {}),
        ...(node.properties || {}),
      },
      weight: node.weight ?? existing?.weight ?? 1.0,
    };

    this.nodes.set(id, fullNode);
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
    if (!this.incoming.has(id)) this.incoming.set(id, new Set());

    return fullNode;
  }

  /**
   * Adds or updates a directed edge between two nodes.
   */
  public addEdge(edge: {
    id?: string;
    sourceId: string;
    targetId: string;
    relation: string;
    weight?: number;
    properties?: Record<string, unknown>;
  }): GraphEdge {
    const sourceId = this.normalizeId(edge.sourceId);
    const targetId = this.normalizeId(edge.targetId);
    const relation = edge.relation.trim();

    // Auto-create nodes if they do not exist
    if (!this.nodes.has(sourceId)) {
      this.addNode({ id: sourceId, label: edge.sourceId });
    }
    if (!this.nodes.has(targetId)) {
      this.addNode({ id: targetId, label: edge.targetId });
    }

    const edgeId = edge.id || `${sourceId}__${relation}__${targetId}`;
    const fullEdge: GraphEdge = {
      id: edgeId,
      sourceId,
      targetId,
      relation,
      weight: edge.weight ?? this.options.defaultEdgeWeight,
      properties: edge.properties || {},
    };

    this.edges.set(edgeId, fullEdge);
    this.adjacency.get(sourceId)?.add(edgeId);
    this.incoming.get(targetId)?.add(edgeId);

    return fullEdge;
  }

  /**
   * Adds a knowledge triple (Subject - Predicate - Object).
   */
  public addTriple(triple: GraphTriple): {
    subjectNode: GraphNode;
    targetNode: GraphNode;
    edge: GraphEdge;
  } {
    const subjectNode = this.addNode({
      id: triple.subject,
      label: triple.subject,
    });
    const targetNode = this.addNode({
      id: triple.object,
      label: triple.object,
    });
    const edge = this.addEdge({
      sourceId: triple.subject,
      targetId: triple.object,
      relation: triple.predicate,
      weight: triple.confidence ?? 1.0,
      properties: triple.metadata,
    });

    return { subjectNode, targetNode, edge };
  }

  /**
   * Batch adds multiple knowledge triples.
   */
  public addTriples(triples: GraphTriple[]): void {
    for (const t of triples) {
      this.addTriple(t);
    }
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(this.normalizeId(id));
  }

  public hasNode(id: string): boolean {
    return this.nodes.has(this.normalizeId(id));
  }

  public getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Rule-based entity & relation extraction from text without external libraries.
   * Parses common patterns like:
   * "X is a Y", "X has Y", "X works at Y", "X founded Y", "X uses Y", "X located in Y"
   */
  public extractTriplesFromText(text: string): GraphTriple[] {
    const triples: GraphTriple[] = [];
    const sentences = text
      .split(/(?<=[.?!])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const patterns: Array<{ regex: RegExp; predicate: string }> = [
      { regex: /^(.+?)\s+(?:is a|is an|is)\s+(.+?)$/i, predicate: 'is_a' },
      {
        regex: /^(.+?)\s+(?:works at|works for|employed by)\s+(.+?)$/i,
        predicate: 'works_at',
      },
      {
        regex: /^(.+?)\s+(?:founded|created|developed|built)\s+(.+?)$/i,
        predicate: 'created',
      },
      {
        regex: /^(.+?)\s+(?:located in|based in|in)\s+(.+?)$/i,
        predicate: 'located_in',
      },
      { regex: /^(.+?)\s+(?:has|owns|possesses)\s+(.+?)$/i, predicate: 'has' },
      {
        regex: /^(.+?)\s+(?:uses|supports|integrates with)\s+(.+?)$/i,
        predicate: 'uses',
      },
      {
        regex: /^(.+?)\s+(?:part of|belongs to|member of)\s+(.+?)$/i,
        predicate: 'part_of',
      },
    ];

    for (const sentence of sentences) {
      const clean = sentence.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ').trim();
      for (const { regex, predicate } of patterns) {
        const match = clean.match(regex);
        if (match?.[1] && match[2]) {
          const sub = match[1].trim();
          const obj = match[2].trim();
          if (
            sub.length > 1 &&
            obj.length > 1 &&
            sub.length < 50 &&
            obj.length < 50
          ) {
            triples.push({
              subject: sub,
              predicate,
              object: obj,
              confidence: 0.85,
            });
            break;
          }
        }
      }
    }

    return triples;
  }

  /**
   * Traverses graph from start node up to maxDepth hops using Breadth-First Search (BFS).
   */
  public traverseMultiHop(
    startNodeId: string,
    maxDepth: number = this.options.maxDefaultDepth,
  ): GraphPath[] {
    const startId = this.normalizeId(startNodeId);
    const startNode = this.nodes.get(startId);
    if (!startNode) return [];

    const paths: GraphPath[] = [];
    const queue: Array<{
      currentId: string;
      currentNodes: GraphNode[];
      currentEdges: GraphEdge[];
      depth: number;
      cumulativeScore: number;
    }> = [
      {
        currentId: startId,
        currentNodes: [startNode],
        currentEdges: [],
        depth: 0,
        cumulativeScore: 1.0,
      },
    ];

    const visitedPaths = new Set<string>();

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { currentId, currentNodes, currentEdges, depth, cumulativeScore } =
        item;

      if (depth > 0) {
        paths.push({
          nodes: [...currentNodes],
          edges: [...currentEdges],
          score: cumulativeScore,
          depth,
        });
      }

      if (depth >= maxDepth) continue;

      const edgeIds = this.adjacency.get(currentId);
      if (!edgeIds) continue;

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const nextNode = this.nodes.get(edge.targetId);
        if (!nextNode) continue;

        // Prevent immediate cycles
        if (currentNodes.some((n) => n.id === nextNode.id)) continue;

        const pathKey = `${currentEdges.map((e) => e.id).join('->')}->${edge.id}`;
        if (visitedPaths.has(pathKey)) continue;
        visitedPaths.add(pathKey);

        const nextScore = cumulativeScore * (edge.weight || 1.0) * 0.85; // decay factor per hop

        queue.push({
          currentId: edge.targetId,
          currentNodes: [...currentNodes, nextNode],
          currentEdges: [...currentEdges, edge],
          depth: depth + 1,
          cumulativeScore: nextScore,
        });
      }
    }

    return paths.sort((a, b) => b.score - a.score);
  }

  /**
   * Finds connected subgraphs matching one or more seed entity queries.
   */
  public findSubGraph(seedEntities: string[], maxDepth = 2): SubGraphResult {
    const nodeSet = new Map<string, GraphNode>();
    const edgeSet = new Map<string, GraphEdge>();
    const allPaths: GraphPath[] = [];

    for (const entity of seedEntities) {
      const norm = this.normalizeId(entity);
      let matchNode = this.nodes.get(norm);

      // Partial fuzzy search if exact match not found
      if (!matchNode) {
        for (const [id, node] of this.nodes.entries()) {
          if (id.includes(norm) || norm.includes(id)) {
            matchNode = node;
            break;
          }
        }
      }

      if (matchNode) {
        nodeSet.set(matchNode.id, matchNode);
        const paths = this.traverseMultiHop(matchNode.id, maxDepth);
        allPaths.push(...paths);

        for (const p of paths) {
          for (const n of p.nodes) nodeSet.set(n.id, n);
          for (const e of p.edges) edgeSet.set(e.id, e);
        }
      }
    }

    const triples: GraphTriple[] = [];
    for (const edge of edgeSet.values()) {
      const src = nodeSet.get(edge.sourceId);
      const tgt = nodeSet.get(edge.targetId);
      if (src && tgt) {
        triples.push({
          subject: src.label,
          predicate: edge.relation,
          object: tgt.label,
          confidence: edge.weight,
        });
      }
    }

    return {
      nodes: Array.from(nodeSet.values()),
      edges: Array.from(edgeSet.values()),
      triples,
      paths: allPaths.sort((a, b) => b.score - a.score),
    };
  }

  /**
   * Formats a subgraph or triples list into clean Markdown for system prompt context injection.
   */
  public toContextPrompt(subGraph: SubGraphResult): string {
    if (subGraph.triples.length === 0) return '';

    const lines = [
      '### KNOWLEDGE GRAPH / RELATIONAL FACTS:',
      ...subGraph.triples.map(
        (t) => `- (${t.subject}) --[${t.predicate}]--> (${t.object})`,
      ),
    ];

    if (subGraph.paths.length > 0) {
      lines.push('\n### MULTI-HOP RELATION PATHS:');
      const topPaths = subGraph.paths.slice(0, 5);
      for (const p of topPaths) {
        const pathStr = p.nodes.map((n) => n.label).join(' ➔ ');
        lines.push(`- ${pathStr} (score: ${p.score.toFixed(2)})`);
      }
    }

    return lines.join('\n');
  }
}
