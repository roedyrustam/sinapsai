/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Tests for Speculative Multi-Draft Consensus & Arbitration Engine
 */

import { describe, expect, it, vi } from 'vitest';
import type { UnifiedApiResponse } from '../types/index.js';
import {
  ConsensusEngine,
  calculatePairwiseSimilarity,
  computeTermFrequencyVector,
} from './ConsensusEngine.js';
import { SinapsClient } from './SinapsClient.js';

describe('ConsensusEngine', () => {
  describe('vector computation and similarity', () => {
    it('computes normalized term frequency vectors', () => {
      const vocab = new Map<string, number>([
        ['quantum', 0],
        ['computing', 1],
        ['speed', 2],
      ]);

      const vec = computeTermFrequencyVector(
        'quantum computing delivers speed',
        vocab,
      );
      expect(vec.length).toBe(3);
      // All 3 words present, normalized length should be 1.0
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it('calculates pairwise similarity for identical vectors', () => {
      const v1 = [0.5, 0.5, 0.5, 0.5];
      const v2 = [0.5, 0.5, 0.5, 0.5];
      const sim = calculatePairwiseSimilarity([v1, v2]);
      expect(sim).toBeCloseTo(1.0, 2);
    });

    it('calculates pairwise similarity for orthogonal vectors', () => {
      const v1 = [1, 0];
      const v2 = [0, 1];
      const sim = calculatePairwiseSimilarity([v1, v2]);
      expect(sim).toBeCloseTo(0.0, 2);
    });

    it('handles single vector or empty vectors gracefully', () => {
      expect(calculatePairwiseSimilarity([[1, 2]])).toBe(1.0);
      expect(calculatePairwiseSimilarity([])).toBe(1.0);
    });
  });

  describe('execute', () => {
    it('throws when draftModels is empty', async () => {
      const engine = new ConsensusEngine();
      // biome-ignore lint/suspicious/noExplicitAny: mock client
      const mockClient: any = { chat: { completions: { create: vi.fn() } } };

      await expect(
        engine.execute(mockClient, {
          draftModels: [],
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('ConsensusEngine requires at least one draftModel');
    });

    it('reaches consensus when draft models provide highly concordant answers', async () => {
      const engine = new ConsensusEngine();

      const mockCreate = vi.fn().mockImplementation((req) => {
        const text =
          'The capital of France is Paris. It is famous for the Eiffel Tower.';
        const res: UnifiedApiResponse = {
          id: `chatcmpl-${req.model}`,
          object: 'chat.completion',
          created: Date.now(),
          model: req.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
        };
        return Promise.resolve(res);
      });

      // biome-ignore lint/suspicious/noExplicitAny: mock client
      const mockClient: any = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await engine.execute(mockClient, {
        draftModels: ['gemini-2.5-flash-lite', 'gpt-4o-mini'],
        consensusThreshold: 0.8,
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.consensusReached).toBe(true);
      expect(result.consensusScore).toBeGreaterThanOrEqual(0.8);
      expect(result.judgeEscalated).toBe(false);
      expect(result.synthesizedText).toContain('Paris');
      expect(result.drafts.length).toBe(2);
    });

    it('escalates to Judge Model when draft models diverge beyond threshold', async () => {
      const engine = new ConsensusEngine();

      const mockCreate = vi.fn().mockImplementation((req) => {
        let text = '';
        if (req.model === 'model-a') {
          text = 'Apple bananas orange fruit nutrition vitamin.';
        } else if (req.model === 'model-b') {
          text = 'Quantum mechanics entanglement relativity spacetime physics.';
        } else if (req.model === 'judge-model') {
          text =
            'Synthesized verdict: Model A discussed fruits, Model B discussed physics.';
        }

        const res: UnifiedApiResponse = {
          id: `chatcmpl-${req.model}`,
          object: 'chat.completion',
          created: Date.now(),
          model: req.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
        };
        return Promise.resolve(res);
      });

      // biome-ignore lint/suspicious/noExplicitAny: mock client
      const mockClient: any = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await engine.execute(mockClient, {
        draftModels: ['model-a', 'model-b'],
        judgeModel: 'judge-model',
        consensusThreshold: 0.85,
        messages: [{ role: 'user', content: 'Arbitrate this prompt' }],
      });

      // 2 drafts + 1 judge call = 3 calls
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.consensusReached).toBe(false);
      expect(result.judgeEscalated).toBe(true);
      expect(result.judgeModel).toBe('judge-model');
      expect(result.synthesizedText).toContain('Synthesized verdict');
    });

    it('handles partial draft failures gracefully and still proceeds', async () => {
      const engine = new ConsensusEngine();

      const mockCreate = vi.fn().mockImplementation((req) => {
        if (req.model === 'failing-model') {
          return Promise.reject(new Error('Rate limit exceeded'));
        }
        const res: UnifiedApiResponse = {
          id: `chatcmpl-${req.model}`,
          object: 'chat.completion',
          created: Date.now(),
          model: req.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Reliable answer from backup model.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        };
        return Promise.resolve(res);
      });

      // biome-ignore lint/suspicious/noExplicitAny: mock client
      const mockClient: any = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await engine.execute(mockClient, {
        draftModels: ['failing-model', 'working-model'],
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.drafts.length).toBe(1);
      expect(result.drafts[0].model).toBe('working-model');
      expect(result.synthesizedText).toBe('Reliable answer from backup model.');
    });
  });

  describe('SinapsClient integration', () => {
    it('exposes client.consensus.create directly', async () => {
      const client = new SinapsClient({
        providers: [
          {
            id: 'mock-p',
            name: 'mock',
            models: ['m1', 'm2'],
            apiKey: 'test-key',
          },
        ],
      });

      vi.spyOn(client.chat.completions, 'create').mockResolvedValue({
        id: 'mock-1',
        object: 'chat.completion',
        created: Date.now(),
        model: 'm1',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Fast consensus response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      const res = await client.consensus.create({
        draftModels: ['m1', 'm2'],
        messages: [{ role: 'user', content: 'Verify' }],
      });

      expect(res.consensusReached).toBe(true);
      expect(res.synthesizedText).toBe('Fast consensus response');
    });
  });
});
