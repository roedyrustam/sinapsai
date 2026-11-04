/**
 * Example 39: In-Process LLM Evals & Faithfulness Guardrail
 *
 * Demonstrates:
 * 1. Faithfulness & groundedness scoring of LLM answers against RAG context.
 * 2. Answer relevance scoring against user prompt intent.
 * 3. In-process toxicity and content safety evaluation.
 */

import { LlmEvals } from '../src/index.js';

const evals = new LlmEvals();

const context = `
SinapsAI is a zero-dependency in-process AI gateway and control plane created by Roedy Rustam.
It provides automatic failover, circuit breaking, and rate limiting across multiple LLM providers.
`;

const prompt = 'What resilience features does SinapsAI provide and who created it?';

const groundedAnswer =
  'SinapsAI was created by Roedy Rustam. It provides circuit breaking, automatic failover, and rate limiting.';

const report = evals.evaluate({
  prompt,
  context,
  answer: groundedAnswer,
});

console.log('--- Evaluation Report ---');
console.log(`Passed: ${report.passed}`);
console.log(`Overall Score: ${report.overallScore}`);
console.log(`Faithfulness Score: ${report.faithfulness?.score} (isFaithful: ${report.faithfulness?.isFaithful})`);
console.log(`Relevance Score: ${report.relevance?.score} (isRelevant: ${report.relevance?.isRelevant})`);
console.log(`Toxicity Score: ${report.toxicity.score} (isSafe: ${report.toxicity.isSafe})`);

