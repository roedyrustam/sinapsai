/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse } from '../types/index.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { Router } from './Router.js';

describe('Router: Adaptive and Smart-Hybrid Routing', () => {
  class MockProvider implements Provider {
    id: string;
    name: string;
    costPer1kTokens?: number;
    promptCostPer1k?: number;
    completionCostPer1k?: number;
    latencyMs: number;
    failCount = 0;
    callCount = 0;

    constructor(
      id: string,
      name: string,
      options: {
        latencyMs?: number;
        costPer1kTokens?: number;
        promptCostPer1k?: number;
        completionCostPer1k?: number;
      } = {},
    ) {
      this.id = id;
      this.name = name;
      this.latencyMs = options.latencyMs ?? 50;
      this.costPer1kTokens = options.costPer1kTokens;
      this.promptCostPer1k = options.promptCostPer1k;
      this.completionCostPer1k = options.completionCostPer1k;
    }

    async generateContent(
      _request: UnifiedApiRequest,
    ): Promise<UnifiedApiResponse> {
      this.callCount++;
      if (this.failCount > 0) {
        this.failCount--;
        throw new Error(`Provider ${this.id} transient failure`);
      }
      return {
        id: `mock-${Date.now()}`,
        model: 'mock-model',
        choices: [
          {
            message: { role: 'assistant', content: `Response from ${this.id}` },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      };
    }
  }

  it('calculates adaptive score prioritizing high reliability and low latency', async () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    const pFast = new MockProvider('p-fast', 'Fast', { latencyMs: 50 });
    const pSlow = new MockProvider('p-slow', 'Slow', { latencyMs: 500 });

    const router = new Router([pFast, pSlow], cb, {
      strategy: 'adaptive',
      storage,
    });

    const req: UnifiedApiRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    };

    // First request routes and seeds metrics
    await router.execute(req);

    // Initial score for fresh vs sampled provider
    const scoreFast = router.calculateAdaptiveScore(pFast, req);
    expect(scoreFast).toBeGreaterThan(0);
  });

  it('routes dynamically to the provider with higher reliability in adaptive mode', async () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    const p1 = new MockProvider('p1', 'P1', { latencyMs: 100 });
    const p2 = new MockProvider('p2', 'P2', { latencyMs: 100 });

    const router = new Router([p1, p2], cb, {
      strategy: 'smart-hybrid',
      storage,
    });

    const req: UnifiedApiRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'test request' }],
    };

    // Seed both providers
    await router.execute(req);

    // Make p1 fail once
    p1.failCount = 1;
    await router.execute(req); // p1 fails, falls back to p2, p1 gets 1 failure recorded

    const scoreP1 = router.calculateAdaptiveScore(p1, req);
    const scoreP2 = router.calculateAdaptiveScore(p2, req);

    // P2 has 100% success rate, so its score is higher than P1
    expect(scoreP2).toBeGreaterThan(scoreP1);

    // The next call will select P2 first
    const res = await router.execute(req);
    expect((res as UnifiedApiResponse).choices[0].message.content).toBe(
      'Response from p2',
    );
  });
});
