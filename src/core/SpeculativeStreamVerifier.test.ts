import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type {
  ChatCompletionChunk,
  UnifiedApiRequest,
  UnifiedApiResponse,
} from '../types/index.js';
import {
  type SpeculativeProviderLike,
  SpeculativeStreamVerifier,
} from './SpeculativeStreamVerifier.js';

describe('SpeculativeStreamVerifier', () => {
  // Helper to create a mock streaming draft provider using standard Provider.generateContent
  function createMockDraftProvider(chunks: string[]): Provider {
    return {
      id: 'mock-draft',
      name: 'MockDraft',
      generateContent: async (_req: UnifiedApiRequest) => {
        return (async function* () {
          let i = 0;
          for (const c of chunks) {
            const chunk: ChatCompletionChunk = {
              id: `chunk-${i++}`,
              model: 'fast-draft',
              provider: 'mock-draft',
              choices: [
                {
                  delta: { content: c },
                  finishReason: null,
                },
              ],
            };
            yield chunk;
          }
        })();
      },
    };
  }

  // Helper to create a mock auditor provider using standard Provider.generateContent
  function createMockAuditorProvider(auditResponse: string): Provider {
    return {
      id: 'mock-auditor',
      name: 'MockAuditor',
      generateContent: vi.fn().mockResolvedValue({
        id: 'audit-res',
        model: 'heavy-auditor',
        provider: 'mock-auditor',
        choices: [
          {
            message: { role: 'assistant', content: auditResponse },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      } satisfies UnifiedApiResponse),
    };
  }

  it('streams tokens directly to the consumer in real-time', async () => {
    const draftProvider = createMockDraftProvider([
      'TypeScript is ',
      'a strongly typed ',
      'programming language.\n\n',
    ]);
    const verifier = new SpeculativeStreamVerifier({ draftProvider });

    const gen = verifier.executeStream({
      model: 'fast-draft',
      messages: [{ role: 'user', content: 'What is TS?' }],
    });

    const received: string[] = [];
    for await (const chunk of gen) {
      received.push(chunk.choices[0]?.delta?.content ?? '');
    }

    expect(received.join('')).toBe(
      'TypeScript is a strongly typed programming language.\n\n',
    );
  });

  it('triggers background audit and identifies invalid claims via onCorrection', async () => {
    const draftProvider = createMockDraftProvider([
      'The Python math.sqrt(-1) returns ',
      'an imaginary number without error by default. ',
      'This is standard behavior.',
    ]);

    const auditorProvider = createMockAuditorProvider(
      '[INVALID: math.sqrt(-1) raises ValueError in Python; cmath.sqrt must be used]',
    );

    const onCorrection = vi.fn();

    const verifier = new SpeculativeStreamVerifier({
      draftProvider,
      auditorProvider,
      minSentenceLength: 20,
      onCorrection,
    });

    const result = await verifier.execute({
      model: 'fast-draft',
      messages: [{ role: 'user', content: 'Explain math.sqrt(-1)' }],
    });

    const stats = result.stats;

    expect(stats.correctionsCount).toBeGreaterThan(0);
    expect(stats.auditedSentences).toBeGreaterThan(0);
    expect(onCorrection).toHaveBeenCalled();

    const firstCorr = onCorrection.mock.calls[0][0];
    expect(firstCorr.reason).toContain('raises ValueError');
  });

  it('fails soft without blocking streaming if auditor encounters an error', async () => {
    const draftProvider = createMockDraftProvider([
      'Fast stream token 1. ',
      'Fast stream token 2. ',
    ]);

    const failingAuditor: Provider = {
      id: 'failing-auditor',
      name: 'FailingAuditor',
      generateContent: vi
        .fn()
        .mockRejectedValue(new Error('Auditor connection timeout')),
    };

    const verifier = new SpeculativeStreamVerifier({
      draftProvider,
      auditorProvider: failingAuditor,
      minSentenceLength: 10,
    });

    const gen = verifier.executeStream({
      model: 'fast-draft',
      messages: [{ role: 'user', content: 'Test' }],
    });

    const tokens: string[] = [];
    for await (const chunk of gen) {
      tokens.push(chunk.choices[0]?.delta?.content ?? '');
    }

    expect(tokens.join('')).toBe('Fast stream token 1. Fast stream token 2. ');
  });

  it('also supports custom execute/executeStream provider adapters', async () => {
    const customDraft: SpeculativeProviderLike = {
      id: 'custom-draft',
      executeStream: async function* () {
        yield {
          id: 'c1',
          model: 'draft',
          choices: [
            { delta: { content: 'Claim check test. ' }, finishReason: 'stop' },
          ],
        };
      },
    };

    const customAuditor: SpeculativeProviderLike = {
      id: 'custom-auditor',
      execute: vi.fn().mockResolvedValue({
        id: 'a1',
        model: 'auditor',
        choices: [
          {
            message: { role: 'assistant', content: '[VALID]' },
            finishReason: 'stop',
          },
        ],
      }),
    };

    const verifier = new SpeculativeStreamVerifier({
      draftProvider: customDraft,
      auditorProvider: customAuditor,
      minSentenceLength: 10,
    });

    const result = await verifier.execute({
      model: 'draft',
      messages: [{ role: 'user', content: 'Verify claim' }],
    });

    expect(result.fullDraftText).toBe('Claim check test. ');
    expect(result.stats.auditPassRate).toBe(1);
    expect(customAuditor.execute).toHaveBeenCalled();
  });
});
