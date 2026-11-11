/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Semantic Prompt Router & Intent Classifier
 *
 * Provides sub-millisecond semantic intent classification using vector centroid
 * matching over fast character n-grams or dense embeddings, routing incoming prompts
 * directly to optimal specialized models without LLM classification roundtrips.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage } from '../types/index.js';
import { cosineSimilarity, extractPromptText } from '../utils/similarity.js';

export interface SemanticRoute {
  /**
   * Unique name of the semantic route (e.g. 'coding', 'customer-support', 'math')
   */
  name: string;
  /**
   * Target model identifier to use when this route matches (e.g. 'claude-3-7-sonnet', 'gemini-2.5-flash-lite')
   */
  targetModel: string;
  /**
   * Optional target provider ID (e.g. 'anthropic', 'gemini', 'groq')
   */
  targetProvider?: string;
  /**
   * Exemplar sample queries representing this route
   */
  samples: string[];
  /**
   * Minimum cosine similarity threshold required to match (0.0 to 1.0, default: 0.60)
   */
  threshold?: number;
  /**
   * Optional system prompt modifier to prepend or set when this route matches
   */
  systemPromptModifier?: string;
  /**
   * Optional user-defined metadata
   */
  metadata?: Record<string, unknown>;
}

export interface SemanticMatchResult {
  /**
   * Whether any route exceeded its similarity threshold
   */
  matched: boolean;
  /**
   * The highest-scoring matched route (if matched is true)
   */
  route?: SemanticRoute;
  /**
   * Confidence score of the match (cosine similarity between 0.0 and 1.0)
   */
  confidence: number;
  /**
   * Execution time in milliseconds (typically <1ms for in-process vectorization)
   */
  latencyMs: number;
  /**
   * All evaluated route scores sorted descending
   */
  scores: Array<{ routeName: string; score: number }>;
}

export interface SemanticRouterOptions {
  /**
   * Initial list of semantic routes
   */
  routes?: SemanticRoute[];
  /**
   * Default minimum similarity threshold for routes without explicit threshold (default: 0.60)
   */
  defaultThreshold?: number;
  /**
   * Optional custom embedding function: (text: string) => Promise<number[]>
   */
  customEmbed?: (text: string) => Promise<number[]>;
  /**
   * Embedding vector dimensions when using internal fast vectorizer (default: 128)
   */
  dimensions?: number;
}

export interface SemanticRouterConfig extends SemanticRouterOptions {
  enabled?: boolean;
}

interface CachedRoute {
  route: SemanticRoute;
  centroid: number[];
  sampleVectors: number[][];
}

const DEFAULT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'i',
  'me',
  'my',
  'myself',
  'we',
  'our',
  'you',
  'your',
  'do',
  'does',
  'did',
  'how',
  'what',
  'where',
  'when',
  'why',
  'can',
  'could',
  'would',
  'should',
  'please',
  'help',
  'tell',
  'need',
  'want',
  'this',
]);

/**
 * Fast in-process character 3-gram + token hashing vectorizer for zero-dependency semantic embeddings.
 * Produces an L2-normalized vector.
 */
export function createFastSemanticEmbedding(
  text: string,
  dimensions = 128,
): number[] {
  const vec = new Array(dimensions).fill(0);
  const clean = text.toLowerCase().replace(/[^\w\s]/g, ' ');
  const rawWords = clean.split(/\s+/).filter((w) => w.length > 0);
  const words = rawWords.filter((w) => !DEFAULT_STOP_WORDS.has(w));
  const tokensToProcess = words.length > 0 ? words : rawWords;

  for (const word of tokensToProcess) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % dimensions;
    vec[bucket] += 3.0;

    // Character 3-grams for subword morphology
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const trigram = word.substring(j, j + 3);
        let triHash = 0;
        for (let k = 0; k < trigram.length; k++) {
          triHash = (triHash << 5) - triHash + trigram.charCodeAt(k);
          triHash |= 0;
        }
        vec[Math.abs(triHash) % dimensions] += 1.0;
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

export class SemanticRouter {
  private routes: Map<string, CachedRoute> = new Map();
  private defaultThreshold: number;
  private customEmbed?: (text: string) => Promise<number[]>;
  private dimensions: number;

  constructor(options?: SemanticRouterOptions) {
    this.defaultThreshold = options?.defaultThreshold ?? 0.35;
    this.customEmbed = options?.customEmbed;
    this.dimensions = options?.dimensions ?? 128;

    if (options?.routes && options.routes.length > 0) {
      for (const route of options.routes) {
        // Synchronous initial add with internal vectorizer
        const { centroid, sampleVectors } = this.computeVectorsSync(
          route.samples,
        );
        this.routes.set(route.name, { route, centroid, sampleVectors });
      }
    }
  }

  private computeVectorsSync(samples: string[]): {
    centroid: number[];
    sampleVectors: number[][];
  } {
    if (samples.length === 0) {
      return {
        centroid: new Array(this.dimensions).fill(0),
        sampleVectors: [],
      };
    }
    const sampleVectors: number[][] = [];
    const centroid = new Array(this.dimensions).fill(0);
    for (const sample of samples) {
      const vec = createFastSemanticEmbedding(sample, this.dimensions);
      sampleVectors.push(vec);
      for (let i = 0; i < this.dimensions; i++) {
        centroid[i] += vec[i];
      }
    }
    // L2 Normalize centroid
    const norm = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        centroid[i] /= norm;
      }
    }
    return { centroid, sampleVectors };
  }

  private async computeVectorsAsync(samples: string[]): Promise<{
    centroid: number[];
    sampleVectors: number[][];
  }> {
    if (samples.length === 0) {
      return {
        centroid: new Array(this.dimensions).fill(0),
        sampleVectors: [],
      };
    }
    if (!this.customEmbed) {
      return this.computeVectorsSync(samples);
    }

    const sampleVectors: number[][] = [];
    for (const sample of samples) {
      const vec = await this.customEmbed(sample);
      sampleVectors.push(vec);
    }

    const dims = sampleVectors[0].length;
    const centroid = new Array(dims).fill(0);
    for (const vec of sampleVectors) {
      for (let i = 0; i < dims; i++) {
        centroid[i] += vec[i];
      }
    }
    // L2 Normalize
    const norm = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        centroid[i] /= norm;
      }
    }
    return { centroid, sampleVectors };
  }

  /**
   * Registers a new semantic route with pre-computed exemplar vectors
   */
  async addRoute(route: SemanticRoute): Promise<void> {
    const { centroid, sampleVectors } = await this.computeVectorsAsync(
      route.samples,
    );
    this.routes.set(route.name, { route, centroid, sampleVectors });
  }

  /**
   * Registers multiple semantic routes in parallel
   */
  async addRoutes(routes: SemanticRoute[]): Promise<void> {
    await Promise.all(routes.map((r) => this.addRoute(r)));
  }

  /**
   * Removes a semantic route by name
   */
  removeRoute(name: string): boolean {
    return this.routes.delete(name);
  }

  /**
   * Retrieves a route by name
   */
  getRoute(name: string): SemanticRoute | undefined {
    return this.routes.get(name)?.route;
  }

  /**
   * Checks if a route exists
   */
  hasRoute(name: string): boolean {
    return this.routes.has(name);
  }

  /**
   * Returns all registered routes
   */
  getRoutes(): SemanticRoute[] {
    return Array.from(this.routes.values()).map((c) => c.route);
  }

  /**
   * Clears all registered routes
   */
  clearRoutes(): void {
    this.routes.clear();
  }

  /**
   * Classifies an input prompt or chat messages and matches against registered routes.
   * Runs in <1ms when using native vectorization.
   */
  async classify(input: string | ChatMessage[]): Promise<SemanticMatchResult> {
    const startTime = performance.now();
    const queryText =
      typeof input === 'string' ? input : extractPromptText(input);

    if (this.routes.size === 0 || !queryText.trim()) {
      return {
        matched: false,
        confidence: 0,
        latencyMs: Math.max(0.01, performance.now() - startTime),
        scores: [],
      };
    }

    const queryVector = this.customEmbed
      ? await this.customEmbed(queryText)
      : createFastSemanticEmbedding(queryText, this.dimensions);

    const scores: Array<{ routeName: string; score: number }> = [];

    let bestRoute: SemanticRoute | undefined;
    let highestScore = -1;

    for (const [routeName, cached] of this.routes.entries()) {
      // Calculate max similarity across all exemplar samples in this route
      let routeMaxSimilarity = -1;
      for (const sampleVec of cached.sampleVectors) {
        const sim = cosineSimilarity(queryVector, sampleVec);
        if (sim > routeMaxSimilarity) {
          routeMaxSimilarity = sim;
        }
      }

      // Also compute centroid similarity
      const centroidSim = cosineSimilarity(queryVector, cached.centroid);
      // Aggregate: 70% exemplar max + 30% centroid
      const aggregatedScore =
        routeMaxSimilarity > -1
          ? Math.max(routeMaxSimilarity, centroidSim)
          : centroidSim;

      const roundedScore = Math.round(aggregatedScore * 1000) / 1000;
      scores.push({ routeName, score: roundedScore });

      const threshold = cached.route.threshold ?? this.defaultThreshold;
      if (aggregatedScore >= threshold && aggregatedScore > highestScore) {
        highestScore = aggregatedScore;
        bestRoute = cached.route;
      }
    }

    scores.sort((a, b) => b.score - a.score);

    const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
      matched: bestRoute !== undefined,
      route: bestRoute,
      confidence:
        highestScore > -1
          ? Math.round(highestScore * 1000) / 1000
          : (scores[0]?.score ?? 0),
      latencyMs: Math.max(0.01, latencyMs),
      scores,
    };
  }
}
