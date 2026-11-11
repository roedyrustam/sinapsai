/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * KV-Cache Prefix Pinning Optimizer Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage, ToolDefinition } from '../types/index.js';
import { KvCacheOptimizer } from './KvCacheOptimizer.js';

describe('KvCacheOptimizer', () => {
  it('should relocate volatile timestamps from system prompt to preserve byte prefix identity', () => {
    const optimizer = new KvCacheOptimizer({ minCacheTokens: 100 });

    const messagesTurn1: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a high-performance FinTech trading assistant. Current time: 2026-11-11T16:32:25Z. Always respond with strict JSON.',
      },
      { role: 'user', content: 'What is the BTC price?' },
    ];

    const messagesTurn2: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a high-performance FinTech trading assistant. Current time: 2026-11-11T17:45:10Z. Always respond with strict JSON.',
      },
      { role: 'user', content: 'What is the ETH price?' },
    ];

    const part1 = optimizer.partition(messagesTurn1);
    const part2 = optimizer.partition(messagesTurn2);

    // Both turns should have the exact same byte-prefix hash despite differing timestamps!
    expect(part1.prefixHash).toBe(part2.prefixHash);

    // System message in both turns should be cleaned of timestamps
    expect(part1.messages[0].content).not.toContain('2026-11-11T16:32:25Z');
    expect(part2.messages[0].content).not.toContain('2026-11-11T17:45:10Z');

    // The volatile user message should receive the relocated runtime metadata
    expect(part1.messages[1].content).toContain(
      '[RUNTIME_CONTEXT]: Current time: 2026-11-11T16:32:25Z',
    );
    expect(part2.messages[1].content).toContain(
      '[RUNTIME_CONTEXT]: Current time: 2026-11-11T17:45:10Z',
    );
  });

  it('should canonicalize tools lexicographically for deterministic byte ordering', () => {
    const optimizer = new KvCacheOptimizer();

    const toolsUnordered: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'zeta_tool',
          description: 'Zeta description',
          parameters: {
            z_param: { type: 'string' },
            a_param: { type: 'number' },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'alpha_tool',
          description: 'Alpha description',
          parameters: {
            b_field: { type: 'boolean' },
            a_field: { type: 'string' },
          },
        },
      },
    ];

    const canonical = optimizer.canonicalizeTools(toolsUnordered);

    // Tools sorted by name
    expect(canonical[0].function.name).toBe('alpha_tool');
    expect(canonical[1].function.name).toBe('zeta_tool');

    // Schema properties sorted alphabetically
    const alphaKeys = Object.keys(canonical[0].function.parameters || {});
    expect(alphaKeys).toEqual(['a_field', 'b_field']);

    const zetaKeys = Object.keys(canonical[1].function.parameters || {});
    expect(zetaKeys).toEqual(['a_param', 'z_param']);
  });

  it('should predict cache hit rate and cost savings when prefix exceeds threshold', () => {
    const optimizer = new KvCacheOptimizer({ minCacheTokens: 100 });

    const longSystemPrompt = 'A'.repeat(1200); // ~300 tokens
    const messages: ChatMessage[] = [
      { role: 'system', content: longSystemPrompt },
      { role: 'user', content: 'Brief query' },
    ];

    const partitioned = optimizer.partition(messages);
    expect(partitioned.cacheEligible).toBe(true);
    expect(partitioned.staticPrefixTokens).toBeGreaterThanOrEqual(100);

    const savings = optimizer.predictCacheSavings(partitioned);
    expect(savings.predictedHitRate).toBeGreaterThan(0.7);
    expect(savings.estimatedCachedTokens).toBeGreaterThan(0);
    expect(savings.discountPercentage).toBeGreaterThan(50);
    expect(savings.estimatedSavingsUsd).toBeGreaterThan(0);
  });

  it('should handle empty or small messages without crashing', () => {
    const optimizer = new KvCacheOptimizer({ minCacheTokens: 1024 });
    const emptyResult = optimizer.partition([]);
    expect(emptyResult.totalEstimatedTokens).toBe(0);
    expect(emptyResult.cacheEligible).toBe(false);

    const smallMessages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    const smallResult = optimizer.partition(smallMessages);
    expect(smallResult.cacheEligible).toBe(false);

    const savings = optimizer.predictCacheSavings(smallResult);
    expect(savings.predictedHitRate).toBe(0.0);
    expect(savings.estimatedSavingsUsd).toBe(0.0);
  });
});
