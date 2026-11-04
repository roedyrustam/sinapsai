import { describe, expect, it } from 'vitest';
import { LlmEvals } from './LlmEvals.js';

describe('In-Process LLM Evals & Faithfulness Guardrail', () => {
  const evals = new LlmEvals();

  it('should verify faithfulness against grounded context', () => {
    const context =
      'SinapsAI is a zero-dependency in-process AI gateway created by Roedy Rustam. It supports circuit breaking and rate limiting.';
    const truthfulAnswer =
      'SinapsAI is an AI gateway created by Roedy Rustam. It features circuit breaking and rate limiting.';

    const result = evals.evaluateFaithfulness({
      context,
      answer: truthfulAnswer,
    });

    expect(result.isFaithful).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.unsupportedClaims.length).toBe(0);
  });

  it('should detect ungrounded hallucinated claims', () => {
    const context =
      'Photosynthesis takes place in chloroplasts using sunlight.';
    const hallucinatedAnswer =
      'Photosynthesis occurs in mitochondria and requires nuclear fission reactors.';

    const result = evals.evaluateFaithfulness({
      context,
      answer: hallucinatedAnswer,
    });

    expect(result.isFaithful).toBe(false);
    expect(result.score).toBeLessThan(0.7);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('should evaluate answer relevance to original prompt', () => {
    const prompt = 'How do I configure circuit breaker threshold in SinapsAI?';
    const relevantAnswer =
      'You can configure the circuit breaker threshold using the recoverySuccessThreshold option in SinapsAI client.';
    const irrelevantAnswer =
      'The recipe for Italian chocolate gelato calls for egg yolks, milk, and sugar.';

    const relevant = evals.evaluateAnswerRelevance({
      prompt,
      answer: relevantAnswer,
    });
    expect(relevant.isRelevant).toBe(true);
    expect(relevant.score).toBeGreaterThanOrEqual(0.6);

    const irrelevant = evals.evaluateAnswerRelevance({
      prompt,
      answer: irrelevantAnswer,
    });
    expect(irrelevant.isRelevant).toBe(false);
    expect(irrelevant.score).toBeLessThan(0.4);
  });

  it('should flag toxic or threatening content', () => {
    const safeText =
      'Here is the summary of your weekly database backup report.';
    const toxicText = 'I will murder you and destroy your family.';

    const safeResult = evals.evaluateToxicity(safeText);
    expect(safeResult.isSafe).toBe(true);
    expect(safeResult.score).toBe(0);

    const toxicResult = evals.evaluateToxicity(toxicText);
    expect(toxicResult.isSafe).toBe(false);
    expect(toxicResult.score).toBeGreaterThanOrEqual(0.9);
    expect(toxicResult.flaggedCategories).toContain('threat');
  });

  it('should run full composite evaluation', () => {
    const report = evals.evaluate({
      prompt: 'Who created SinapsAI?',
      context: 'SinapsAI was created by Roedy Rustam in 2026.',
      answer: 'SinapsAI was created by Roedy Rustam.',
    });

    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(0.8);
    expect(report.faithfulness?.isFaithful).toBe(true);
    expect(report.relevance?.isRelevant).toBe(true);
  });
});
