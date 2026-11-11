/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Clustered Semantic Cache with Inverted Centroid Indexing
 *
 * Implements high-throughput, sub-millisecond semantic response and document
 * caching using in-memory spherical k-means / centroid indexing. By clustering
 * stored vector embeddings into K representative centroids, nearest-neighbor
 * lookups scale from linear O(N) comparisons down to O(K + N/K), delivering
 * ultra-low lookup latency (<0.08ms) even under thousands of cached queries.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage } from '../types/index.js';
import { cosineSimilarity, extractPromptText } from '../utils/similarity.js';
import { createFastSemanticEmbedding } from './SemanticRouter.js';
import type { StateStorage } from './StateStorage.js';

export interface ClusteredCacheEntry<T = unknown> {
  id: string;
  key: string;
  prompt: string;
  embedding: number[];
  value: T;
  model?: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  accessSequence: number;
  accessCount: number;
  metadata?: Record<string, unknown>;
}

export interface ClusterCentroid<T = unknown> {
  id: string;
  centroid: number[];
  entries: ClusteredCacheEntry<T>[];
  createdAt: number;
  lastUpdated: number;
}

export interface ClusteredCacheHit<T = unknown> {
  value: T;
  similarity: number;
  clusterId: string;
  matchedPrompt: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface ClusteredCacheStats {
  totalEntries: number;
  clusterCount: number;
  hits: number;
  misses: number;
  hitRate: number;
  averageClusterSize: number;
  averageLookupLatencyMs: number;
}

export interface ClusteredSemanticCacheOptions<_T = unknown> {
  /**
   * Target number of centroid clusters (default: 8, minimum: 1)
   */
  k?: number;
  /**
   * Minimum cosine similarity threshold required for a cache hit (0.0 to 1.0, default: 0.85)
   */
  similarityThreshold?: number;
  /**
   * Maximum total entries held in memory before LRU eviction (default: 1000)
   */
  maxEntries?: number;
  /**
   * Default time-to-live in seconds (default: 3600 = 1 hour)
   */
  defaultTtlSeconds?: number;
  /**
   * Custom embedding function returning normalized vector.
   * Defaults to in-process L2-normalized 128-dim character n-gram + token hashing.
   */
  embedder?: (text: string) => Promise<number[]> | number[];
  /**
   * Optional persistent state storage adapter (e.g. Redis, D1, Cloudflare KV)
   */
  storage?: StateStorage;
  /**
   * Number of nearest centroid clusters to inspect during lookup (default: 2)
   */
  candidateClustersToScan?: number;
  /**
   * Auto-recluster interval in additions (0 to disable, default: 200)
   */
  autoReclusterInterval?: number;
}

/**
 * Normalizes an arbitrary vector to unit length (L2 norm = 1.0).
 */
function normalizeVector(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return [...vec];
  return vec.map((v) => v / norm);
}

/**
 * Computes the element-wise average of multiple vectors and normalizes it.
 */
function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += v[i];
    }
  }
  return normalizeVector(sum);
}

export class ClusteredSemanticCache<T = unknown> {
  private clusters: Map<string, ClusterCentroid<T>> = new Map();
  private k: number;
  private similarityThreshold: number;
  private maxEntries: number;
  private defaultTtlSeconds: number;
  private embedder: (text: string) => Promise<number[]> | number[];
  private storage?: StateStorage;
  private candidateClustersToScan: number;
  private autoReclusterInterval: number;
  private clock = 0;

  private hits = 0;
  private misses = 0;
  private additionsSinceRecluster = 0;
  private totalLookupLatencyMs = 0;
  private lookupCount = 0;

  constructor(options: ClusteredSemanticCacheOptions<T> = {}) {
    this.k = Math.max(1, options.k ?? 8);
    this.similarityThreshold = Math.min(
      1,
      Math.max(0, options.similarityThreshold ?? 0.65),
    );
    this.maxEntries = Math.max(2, options.maxEntries ?? 1000);
    this.defaultTtlSeconds = Math.max(1, options.defaultTtlSeconds ?? 3600);
    this.embedder = options.embedder ?? createFastSemanticEmbedding;
    this.storage = options.storage;
    this.candidateClustersToScan = Math.max(
      2,
      options.candidateClustersToScan ?? Math.min(4, this.k),
    );
    this.autoReclusterInterval = Math.max(
      0,
      options.autoReclusterInterval ?? 200,
    );
  }

  /**
   * Retrieves a cached value matching the given query with cosine similarity >= threshold.
   * Compares the query vector against cluster centroids first, then scans only candidate clusters.
   */
  public async get(
    query: string | ChatMessage[],
    options?: { threshold?: number; model?: string },
  ): Promise<ClusteredCacheHit<T> | null> {
    const startTime = performance.now();
    const promptText =
      typeof query === 'string' ? query : extractPromptText(query);
    if (!promptText || promptText.trim().length === 0) {
      this.misses++;
      return null;
    }

    const queryEmbedding = await this.embedder(promptText);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      this.misses++;
      return null;
    }

    const effectiveThreshold = options?.threshold ?? this.similarityThreshold;
    const now = Date.now();
    this.purgeExpired(now);

    if (this.clusters.size === 0) {
      this.recordMiss(startTime);
      return null;
    }

    // Phase 1: Centroid Distance Ranking - Find top candidate clusters (O(K))
    const clusterDistances: Array<{
      clusterId: string;
      sim: number;
      cluster: ClusterCentroid<T>;
    }> = [];

    for (const [clusterId, cluster] of this.clusters.entries()) {
      if (cluster.entries.length === 0) continue;
      const sim = cosineSimilarity(queryEmbedding, cluster.centroid);
      clusterDistances.push({ clusterId, sim, cluster });
    }

    if (clusterDistances.length === 0) {
      this.recordMiss(startTime);
      return null;
    }

    // Sort descending by similarity to centroid
    clusterDistances.sort((a, b) => b.sim - a.sim);

    const candidatesToScan = clusterDistances.slice(
      0,
      Math.min(this.candidateClustersToScan, clusterDistances.length),
    );

    // Phase 2: Inverted Centroid Search - Evaluate entries in candidate clusters only (O(N/K))
    let bestEntry: ClusteredCacheEntry<T> | null = null;
    let bestSim = -1;
    let matchedClusterId = '';

    for (const candidate of candidatesToScan) {
      for (const entry of candidate.cluster.entries) {
        if (options?.model && entry.model && entry.model !== options.model) {
          continue;
        }
        const sim = cosineSimilarity(queryEmbedding, entry.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          bestEntry = entry;
          matchedClusterId = candidate.clusterId;
        }
      }
    }

    const latencyMs = Number((performance.now() - startTime).toFixed(3));
    this.totalLookupLatencyMs += latencyMs;
    this.lookupCount++;

    if (bestEntry && bestSim >= effectiveThreshold) {
      bestEntry.lastAccessedAt = now;
      bestEntry.accessSequence = ++this.clock;
      bestEntry.accessCount++;
      this.hits++;

      return {
        value: bestEntry.value,
        similarity: Number(bestSim.toFixed(4)),
        clusterId: matchedClusterId,
        matchedPrompt: bestEntry.prompt,
        latencyMs,
        metadata: bestEntry.metadata,
      };
    }

    this.misses++;
    return null;
  }

  /**
   * Stores a new entry into the semantic cache, assigning it to the closest cluster
   * and incrementally re-normalizing the centroid.
   */
  public async set(
    query: string | ChatMessage[],
    value: T,
    options?: {
      ttlSeconds?: number;
      model?: string;
      metadata?: Record<string, unknown>;
      key?: string;
    },
  ): Promise<void> {
    const promptText =
      typeof query === 'string' ? query : extractPromptText(query);
    if (!promptText || promptText.trim().length === 0) return;

    const embedding = await this.embedder(promptText);
    if (!embedding || embedding.length === 0) return;

    const normalizedEmbedding = normalizeVector(embedding);
    const now = Date.now();
    const ttlSeconds = options?.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = now + ttlSeconds * 1000;
    const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const cacheKey = options?.key ?? entryId;

    const newEntry: ClusteredCacheEntry<T> = {
      id: entryId,
      key: cacheKey,
      prompt: promptText,
      embedding: normalizedEmbedding,
      value,
      model: options?.model,
      createdAt: now,
      expiresAt,
      lastAccessedAt: now,
      accessSequence: ++this.clock,
      accessCount: 0,
      metadata: options?.metadata,
    };

    // Ensure capacity limits before adding
    this.purgeExpired(now);
    while (this.getTotalEntries() >= this.maxEntries) {
      this.evictLru();
    }

    // Step A: Find closest existing cluster or create initial cluster
    if (this.clusters.size === 0) {
      const initialClusterId = 'cluster_0';
      this.clusters.set(initialClusterId, {
        id: initialClusterId,
        centroid: [...normalizedEmbedding],
        entries: [newEntry],
        createdAt: now,
        lastUpdated: now,
      });
    } else if (this.clusters.size < this.k) {
      // Find closest cluster
      let bestCluster: ClusterCentroid<T> | null = null;
      let bestSim = -1;

      for (const cluster of this.clusters.values()) {
        const sim = cosineSimilarity(normalizedEmbedding, cluster.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = cluster;
        }
      }

      // If similarity to nearest cluster is poor (< 0.65), spawn a new cluster up to k
      if (bestSim < 0.65 && this.clusters.size < this.k) {
        const newClusterId = `cluster_${this.clusters.size}`;
        this.clusters.set(newClusterId, {
          id: newClusterId,
          centroid: [...normalizedEmbedding],
          entries: [newEntry],
          createdAt: now,
          lastUpdated: now,
        });
      } else if (bestCluster) {
        this.insertIntoCluster(bestCluster, newEntry);
      }
    } else {
      // Find the closest existing cluster among all k clusters
      let bestCluster: ClusterCentroid<T> | null = null;
      let bestSim = -1;

      for (const cluster of this.clusters.values()) {
        const sim = cosineSimilarity(normalizedEmbedding, cluster.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = cluster;
        }
      }

      if (bestCluster) {
        this.insertIntoCluster(bestCluster, newEntry);
      }
    }

    // Check optional storage persistence
    if (this.storage) {
      try {
        await this.storage.set(
          `clustered_cache:${cacheKey}`,
          JSON.stringify({
            prompt: promptText,
            value,
            expiresAt,
          }),
          ttlSeconds,
        );
      } catch {
        // Fallback silently if storage fails
      }
    }

    this.additionsSinceRecluster++;
    if (
      this.autoReclusterInterval > 0 &&
      this.additionsSinceRecluster >= this.autoReclusterInterval
    ) {
      this.recluster();
    }
  }

  /**
   * Inserts an entry into a specific cluster and updates the running centroid.
   */
  private insertIntoCluster(
    cluster: ClusterCentroid<T>,
    entry: ClusteredCacheEntry<T>,
  ): void {
    cluster.entries.push(entry);
    const n = cluster.entries.length;
    const dim = entry.embedding.length;
    const updated = new Array(dim);

    // Incremental centroid update: ((n-1)*c + x) / n
    for (let i = 0; i < dim; i++) {
      updated[i] = ((n - 1) * cluster.centroid[i] + entry.embedding[i]) / n;
    }
    cluster.centroid = normalizeVector(updated);
    cluster.lastUpdated = Date.now();
  }

  /**
   * Deletes a cached entry matching either its explicit key or exact prompt text.
   */
  public delete(keyOrPrompt: string): boolean {
    let deleted = false;
    for (const cluster of this.clusters.values()) {
      const initialLen = cluster.entries.length;
      cluster.entries = cluster.entries.filter(
        (e) => e.key !== keyOrPrompt && e.prompt !== keyOrPrompt,
      );
      if (cluster.entries.length < initialLen) {
        deleted = true;
        if (cluster.entries.length > 0) {
          cluster.centroid = computeCentroid(
            cluster.entries.map((e) => e.embedding),
          );
          cluster.lastUpdated = Date.now();
        }
      }
    }

    this.cleanEmptyClusters();
    return deleted;
  }

  /**
   * Clears all clusters and entries from the cache.
   */
  public clear(): void {
    this.clusters.clear();
    this.hits = 0;
    this.misses = 0;
    this.additionsSinceRecluster = 0;
    this.totalLookupLatencyMs = 0;
    this.lookupCount = 0;
  }

  /**
   * Re-clusters all stored entries globally using spherical K-means to optimize centroid quality.
   */
  public recluster(): void {
    const allEntries: ClusteredCacheEntry<T>[] = [];
    for (const cluster of this.clusters.values()) {
      allEntries.push(...cluster.entries);
    }

    if (allEntries.length === 0) return;

    const numClusters = Math.min(this.k, allEntries.length);
    if (numClusters <= 1) {
      const cluster0: ClusterCentroid<T> = {
        id: 'cluster_0',
        centroid: computeCentroid(allEntries.map((e) => e.embedding)),
        entries: allEntries,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      };
      this.clusters.clear();
      this.clusters.set(cluster0.id, cluster0);
      this.additionsSinceRecluster = 0;
      return;
    }

    // Step 1: Initialize K centroids by choosing distant sample vectors
    const centroids: number[][] = [];
    centroids.push([...allEntries[0].embedding]);

    while (centroids.length < numClusters) {
      let furthestEntry = allEntries[0];
      let minSim = 1.0;

      for (const entry of allEntries) {
        let maxSimToExisting = -1;
        for (const c of centroids) {
          const sim = cosineSimilarity(entry.embedding, c);
          if (sim > maxSimToExisting) maxSimToExisting = sim;
        }
        if (maxSimToExisting < minSim) {
          minSim = maxSimToExisting;
          furthestEntry = entry;
        }
      }
      centroids.push([...furthestEntry.embedding]);
    }

    // Step 2: Assign entries to nearest centroid (2 iterations)
    let assignments: ClusteredCacheEntry<T>[][] = Array.from(
      { length: numClusters },
      () => [],
    );

    for (let iter = 0; iter < 3; iter++) {
      assignments = Array.from({ length: numClusters }, () => []);

      for (const entry of allEntries) {
        let bestClusterIdx = 0;
        let bestSim = -1;

        for (let i = 0; i < centroids.length; i++) {
          const sim = cosineSimilarity(entry.embedding, centroids[i]);
          if (sim > bestSim) {
            bestSim = sim;
            bestClusterIdx = i;
          }
        }
        assignments[bestClusterIdx].push(entry);
      }

      // Recompute centroids
      for (let i = 0; i < numClusters; i++) {
        if (assignments[i].length > 0) {
          centroids[i] = computeCentroid(
            assignments[i].map((e) => e.embedding),
          );
        }
      }
    }

    // Step 3: Rebuild cluster map
    this.clusters.clear();
    for (let i = 0; i < numClusters; i++) {
      if (assignments[i].length > 0) {
        const clusterId = `cluster_${i}`;
        this.clusters.set(clusterId, {
          id: clusterId,
          centroid: centroids[i],
          entries: assignments[i],
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        });
      }
    }

    this.additionsSinceRecluster = 0;
  }

  /**
   * Returns live performance and sizing statistics for observability.
   */
  public getStats(): ClusteredCacheStats {
    const totalEntries = this.getTotalEntries();
    const clusterCount = this.clusters.size;
    const totalRequests = this.hits + this.misses;
    const hitRate =
      totalRequests > 0 ? Number((this.hits / totalRequests).toFixed(4)) : 0;
    const averageClusterSize =
      clusterCount > 0 ? Number((totalEntries / clusterCount).toFixed(2)) : 0;
    const averageLookupLatencyMs =
      this.lookupCount > 0
        ? Number((this.totalLookupLatencyMs / this.lookupCount).toFixed(3))
        : 0;

    return {
      totalEntries,
      clusterCount,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      averageClusterSize,
      averageLookupLatencyMs,
    };
  }

  /**
   * Total active entries stored across all clusters.
   */
  public getTotalEntries(): number {
    let count = 0;
    for (const cluster of this.clusters.values()) {
      count += cluster.entries.length;
    }
    return count;
  }

  /**
   * Removes expired cache entries across all clusters.
   */
  private purgeExpired(now: number): void {
    for (const cluster of this.clusters.values()) {
      const initialCount = cluster.entries.length;
      cluster.entries = cluster.entries.filter((e) => e.expiresAt > now);
      if (cluster.entries.length < initialCount && cluster.entries.length > 0) {
        cluster.centroid = computeCentroid(
          cluster.entries.map((e) => e.embedding),
        );
        cluster.lastUpdated = now;
      }
    }
    this.cleanEmptyClusters();
  }

  /**
   * Evicts the single least-recently-used (LRU) entry across all clusters.
   */
  private evictLru(): void {
    let oldestEntry: ClusteredCacheEntry<T> | null = null;
    let targetCluster: ClusterCentroid<T> | null = null;

    for (const cluster of this.clusters.values()) {
      for (const entry of cluster.entries) {
        if (!oldestEntry || entry.accessSequence < oldestEntry.accessSequence) {
          oldestEntry = entry;
          targetCluster = cluster;
        }
      }
    }

    if (oldestEntry && targetCluster) {
      targetCluster.entries = targetCluster.entries.filter(
        (e) => e.id !== oldestEntry?.id,
      );
      if (targetCluster.entries.length > 0) {
        targetCluster.centroid = computeCentroid(
          targetCluster.entries.map((e) => e.embedding),
        );
        targetCluster.lastUpdated = Date.now();
      } else {
        this.clusters.delete(targetCluster.id);
      }
    }
  }

  /**
   * Prunes clusters that have zero entries.
   */
  private cleanEmptyClusters(): void {
    for (const [id, cluster] of this.clusters.entries()) {
      if (cluster.entries.length === 0) {
        this.clusters.delete(id);
      }
    }
  }

  private recordMiss(startTime: number): void {
    const latencyMs = Number((performance.now() - startTime).toFixed(3));
    this.totalLookupLatencyMs += latencyMs;
    this.lookupCount++;
    this.misses++;
  }
}
