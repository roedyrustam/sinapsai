import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/index.js';
import {
  createFastSemanticEmbedding,
  type SemanticRoute,
  SemanticRouter,
} from './SemanticRouter.js';

describe('SemanticRouter', () => {
  it('generates normalized embeddings with fast vectorizer', () => {
    const vec64 = createFastSemanticEmbedding(
      'Write a binary search algorithm in TypeScript',
      64,
    );
    expect(vec64.length).toBe(64);

    const norm = Math.sqrt(vec64.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('routes prompts to the best semantic match', async () => {
    const routes: SemanticRoute[] = [
      {
        name: 'coding',
        targetModel: 'claude-3-7-sonnet',
        samples: [
          'write a python function to parse json',
          'implement binary search algorithm in typescript',
          'fix this react useEffect bug',
          'create an express router with rest api endpoints',
        ],
        threshold: 0.5,
      },
      {
        name: 'support',
        targetModel: 'gemini-2.5-flash-lite',
        samples: [
          'how do I reset my password',
          'where can I find my invoice',
          'cancel my subscription and get refund',
          'contact billing customer support',
        ],
        threshold: 0.35,
      },
      {
        name: 'math',
        targetModel: 'o3-mini',
        samples: [
          'calculate the derivative of sin x squared',
          'solve this differential equation',
          'compute the eigenvalues of a 3x3 matrix',
          'prove the pythagorean theorem',
        ],
        threshold: 0.35,
      },
    ];

    const router = new SemanticRouter({ routes });

    // Test coding classification
    const codeMatch = await router.classify(
      'How do I build a REST API in Node.js?',
    );
    expect(codeMatch.matched).toBe(true);
    expect(codeMatch.route?.name).toBe('coding');
    expect(codeMatch.route?.targetModel).toBe('claude-3-7-sonnet');
    expect(codeMatch.latencyMs).toBeGreaterThan(0);
    expect(codeMatch.scores.length).toBe(3);

    // Test support classification
    const supportMatch = await router.classify(
      'I need a refund for my last invoice',
    );
    expect(supportMatch.matched).toBe(true);
    expect(supportMatch.route?.name).toBe('support');
    expect(supportMatch.route?.targetModel).toBe('gemini-2.5-flash-lite');

    // Test math classification
    const mathMatch = await router.classify(
      'Calculate matrix eigenvalues step by step',
    );
    expect(mathMatch.matched).toBe(true);
    expect(mathMatch.route?.name).toBe('math');
    expect(mathMatch.route?.targetModel).toBe('o3-mini');
  });

  it('handles ChatMessage[] input', async () => {
    const router = new SemanticRouter({
      routes: [
        {
          name: 'debugging',
          targetModel: 'claude-3-7-sonnet',
          samples: [
            'debug this error message',
            'fix null pointer exception in java',
          ],
          threshold: 0.35,
        },
      ],
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Debug this NullPointerException in Java' },
    ];

    const result = await router.classify(messages);
    expect(result.matched).toBe(true);
    expect(result.route?.name).toBe('debugging');
  });

  it('respects threshold and returns matched: false when below threshold', async () => {
    const router = new SemanticRouter({
      routes: [
        {
          name: 'biology',
          targetModel: 'gpt-4o',
          samples: [
            'cellular respiration mitochondria ATP',
            'photosynthesis in chloroplasts',
          ],
          threshold: 0.95, // Impractically high threshold
        },
      ],
    });

    const result = await router.classify('Tell me about sports news');
    expect(result.matched).toBe(false);
    expect(result.route).toBeUndefined();
    expect(result.scores[0]?.routeName).toBe('biology');
  });

  it('manages routes lifecycle dynamically (add, get, remove, clear)', async () => {
    const router = new SemanticRouter();
    expect(router.getRoutes().length).toBe(0);

    await router.addRoute({
      name: 'financial',
      targetModel: 'deepseek-reasoner',
      samples: [
        'analyze quarterly balance sheet',
        'calculate cash flow margins',
      ],
    });

    expect(router.hasRoute('financial')).toBe(true);
    expect(router.getRoute('financial')?.targetModel).toBe('deepseek-reasoner');

    await router.addRoutes([
      {
        name: 'legal',
        targetModel: 'claude-3-7-sonnet',
        samples: ['review terms of service agreement', 'gdpr compliance check'],
      },
    ]);

    expect(router.getRoutes().length).toBe(2);

    expect(router.removeRoute('financial')).toBe(true);
    expect(router.hasRoute('financial')).toBe(false);
    expect(router.getRoutes().length).toBe(1);

    router.clearRoutes();
    expect(router.getRoutes().length).toBe(0);
  });

  it('supports customEmbed function', async () => {
    const mockEmbed = async (text: string) => {
      // Deterministic 4-dim mock vector based on keywords
      if (text.includes('code') || text.includes('program'))
        return [1, 0, 0, 0];
      if (text.includes('money') || text.includes('tax')) return [0, 1, 0, 0];
      return [0, 0, 1, 0];
    };

    const router = new SemanticRouter({
      customEmbed: mockEmbed,
      defaultThreshold: 0.7,
    });

    await router.addRoute({
      name: 'tech',
      targetModel: 'gpt-4o',
      samples: ['code program software'],
    });

    const result = await router.classify('help me code');
    expect(result.matched).toBe(true);
    expect(result.route?.name).toBe('tech');
  });

  it('handles empty query gracefully', async () => {
    const router = new SemanticRouter();
    const result = await router.classify('');
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
