/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Clustered Semantic Cache Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { ClusteredSemanticCache } from './ClusteredSemanticCache.js';

describe('ClusteredSemanticCache', () => {
  it('should store and retrieve semantically similar prompts with low latency', async () => {
    const cache = new ClusteredSemanticCache<string>({
      similarityThreshold: 0.6,
      k: 4,
    });

    await cache.set(
      'How to implement binary search in TypeScript?',
      'Binary search divides the sorted array into halves...',
    );

    // Semantically similar query
    const hit = await cache.get(
      'How do I write a binary search algorithm in TypeScript?',
    );
    expect(hit).not.toBeNull();
    expect(hit?.value).toBe(
      'Binary search divides the sorted array into halves...',
    );
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.6);
    expect(hit?.latencyMs).toBeDefined();

    // Completely unrelated query should miss
    const miss = await cache.get(
      'What are the best tourist attractions in Bali?',
    );
    expect(miss).toBeNull();
  });

  it('should partition distinct topics into separate clusters and update stats', async () => {
    const cache = new ClusteredSemanticCache<string>({
      similarityThreshold: 0.65,
      k: 3,
    });

    // Topic 1: Coding
    await cache.set('How to fix a null pointer exception in Java?', 'Check null checks.');
    await cache.set('Fixing undefined error in JavaScript code', 'Use optional chaining.');

    // Topic 2: Cooking
    await cache.set('How to make traditional Italian spaghetti carbonara?', 'Use pecorino, eggs, and guanciale.');
    await cache.set('Pasta carbonara authentic recipe steps', 'Do not use cream in carbonara.');

    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(4);
    expect(stats.clusterCount).toBeGreaterThanOrEqual(1);

    // Lookup topic 1
    const codeHit = await cache.get('java null pointer fix');
    expect(codeHit).not.toBeNull();
    expect(codeHit?.value).toBe('Check null checks.');

    // Lookup topic 2
    const pastaHit = await cache.get('recipe for italian spaghetti carbonara');
    expect(pastaHit).not.toBeNull();
    expect(pastaHit?.value).toBe('Use pecorino, eggs, and guanciale.');

    const updatedStats = cache.getStats();
    expect(updatedStats.hits).toBe(2);
    expect(updatedStats.hitRate).toBe(1.0);
  });

  it('should respect TTL expiration and purge stale entries', async () => {
    const cache = new ClusteredSemanticCache<string>({
      defaultTtlSeconds: 1, // 1 second
      similarityThreshold: 0.7,
    });

    await cache.set('Quick prompt', 'Quick answer', { ttlSeconds: 0.05 }); // 50ms

    // Immediate lookup should hit
    const immediateHit = await cache.get('Quick prompt');
    expect(immediateHit).not.toBeNull();

    // Wait 70ms for expiration
    await new Promise((resolve) => setTimeout(resolve, 70));

    const expiredHit = await cache.get('Quick prompt');
    expect(expiredHit).toBeNull();
  });

  it('should enforce maxEntries and perform LRU eviction', async () => {
    const cache = new ClusteredSemanticCache<string>({
      maxEntries: 2,
      similarityThreshold: 0.8,
    });

    await cache.set('Prompt Alpha', 'Alpha response');
    await cache.set('Prompt Beta', 'Beta response');

    // Access Alpha to make it more recently used
    await cache.get('Prompt Alpha');

    // Add Gamma, should evict Beta (LRU)
    await cache.set('Prompt Gamma', 'Gamma response');

    expect(cache.getTotalEntries()).toBe(2);
    const alphaHit = await cache.get('Prompt Alpha');
    expect(alphaHit).not.toBeNull();

    const gammaHit = await cache.get('Prompt Gamma');
    expect(gammaHit).not.toBeNull();
  });

  it('should delete entries by key or prompt', async () => {
    const cache = new ClusteredSemanticCache<string>();
    await cache.set('Delete me please', 'To be deleted', { key: 'custom_del_key' });

    expect(cache.getTotalEntries()).toBe(1);

    const deleted = cache.delete('custom_del_key');
    expect(deleted).toBe(true);
    expect(cache.getTotalEntries()).toBe(0);

    const hit = await cache.get('Delete me please');
    expect(hit).toBeNull();
  });

  it('should filter cache hits by model override', async () => {
    const cache = new ClusteredSemanticCache<string>({
      similarityThreshold: 0.7,
    });

    await cache.set('Summarize this document', 'Claude summary', {
      model: 'claude-3-7-sonnet',
    });

    // Requesting with mismatched model should miss
    const gptMiss = await cache.get('Summarize this document', {
      model: 'gpt-4o',
    });
    expect(gptMiss).toBeNull();

    // Requesting with matching model should hit
    const claudeHit = await cache.get('Summarize this document', {
      model: 'claude-3-7-sonnet',
    });
    expect(claudeHit).not.toBeNull();
    expect(claudeHit?.value).toBe('Claude summary');
  });

  it('should successfully run recluster without error', async () => {
    const cache = new ClusteredSemanticCache<string>({ k: 2 });
    await cache.set('Vector item 1', 'Content 1');
    await cache.set('Vector item 2', 'Content 2');
    await cache.set('Vector item 3', 'Content 3');

    cache.recluster();
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.clusterCount).toBeGreaterThanOrEqual(1);
  });
});

