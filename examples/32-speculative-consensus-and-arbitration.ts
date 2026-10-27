/**
 * Example 32: Speculative Multi-Draft Consensus & Supreme AI Judge Arbitration
 *
 * Demonstrates:
 * 1. Parallel speculative drafting across frontier models.
 * 2. Pairwise semantic cosine similarity analysis in-process.
 * 3. Automatic threshold verification (consensus reached vs divergence).
 * 4. Automatic escalation to a Judge Model for authoritative arbitration.
 * 5. Cost and latency telemetry with fail-soft fallback.
 */

import {
  ConsensusEngine,
  calculatePairwiseSimilarity,
  computeTermFrequencyVector,
  GeminiProvider,
  GroqProvider,
  OpenAiProvider,
  type Provider,
  SinapsClient,
  type UnifiedApiResponse,
} from '../src/index.js';

async function main() {
  console.log(
    '=== 1. Speculative Multi-Draft Consensus & Arbitration Engine ===\n',
  );

  // Configure SinapsClient with multiple providers
  const client = new SinapsClient({
    providers: [
      new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY || 'demo-gemini-key',
      }),
      new GroqProvider({
        apiKey: process.env.GROQ_API_KEY || 'demo-groq-key',
      }),
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'demo-openai-key',
      }),
    ],
  });

  // Scenario A: Mocking concordant drafts where consensus is reached
  console.log(
    '--- Scenario A: High Agreement (Consensus Reached Instantly) ---',
  );

  // Mock responses for demo execution
  const mockConcordantCreate = async (req: { model: string }) => {
    const text =
      req.model === 'gemini-2.5-flash-lite'
        ? 'Paris is the capital of France, globally renowned for the Eiffel Tower and rich culture.'
        : 'The capital of France is Paris, famous worldwide for art, history, and the Eiffel Tower.';
    return {
      id: `chatcmpl-${req.model}`,
      model: req.model,
      choices: [
        {
          message: { role: 'assistant', content: text },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
    } as UnifiedApiResponse;
  };

  const concordantClient = {
    chat: { completions: { create: mockConcordantCreate } },
  };

  const engine = new ConsensusEngine();
  const consensusResult = await engine.execute(concordantClient, {
    draftModels: ['gemini-2.5-flash-lite', 'llama-3.3-70b-versatile'],
    consensusThreshold: 0.8,
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  });

  console.log(
    `Consensus Reached: ${consensusResult.consensusReached ? '✅ YES' : '❌ NO'}`,
  );
  console.log(
    `Average Semantic Similarity: ${(consensusResult.averageSimilarity * 100).toFixed(1)}%`,
  );
  console.log(`Escalated to Judge: ${consensusResult.escalatedToJudge}`);
  console.log(`Draft Count: ${consensusResult.drafts.length}`);
  console.log(`Synthesized Answer:\n"${consensusResult.synthesizedText}"\n`);

  // Scenario B: Divergent drafts requiring Supreme AI Judge arbitration
  console.log(
    '--- Scenario B: Divergent Drafts (Supreme Judge Arbitration) ---',
  );

  const mockDivergentCreate = async (req: { model: string }) => {
    let content = '';
    if (req.model === 'gemini-2.5-flash-lite') {
      content =
        'Optimistic projection: Technology X will reach production in Q2 2027.';
    } else if (req.model === 'llama-3.3-70b-versatile') {
      content =
        'Conservative estimate: Supply chain constraints delay Technology X until 2029.';
    } else {
      content =
        'Supreme Judge Verdict: Cross-analysis indicates initial developer previews arrive Q2 2027, with full commercial mass scale projected for mid 2028.';
    }

    return {
      id: `chatcmpl-${req.model}`,
      model: req.model,
      choices: [
        {
          message: { role: 'assistant', content },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 25, completionTokens: 30, totalTokens: 55 },
    } as UnifiedApiResponse;
  };

  const divergentClient = {
    chat: { completions: { create: mockDivergentCreate } },
  };

  const arbitrationResult = await engine.execute(divergentClient, {
    draftModels: ['gemini-2.5-flash-lite', 'llama-3.3-70b-versatile'],
    judgeModel: 'gemini-2.5-pro',
    consensusThreshold: 0.85,
    messages: [
      {
        role: 'user',
        content:
          'When will Technology X be production-ready according to recent reports?',
      },
    ],
  });

  console.log(
    `Consensus Reached: ${arbitrationResult.consensusReached ? '✅ YES' : '❌ NO'}`,
  );
  console.log(
    `Average Draft Similarity: ${(arbitrationResult.averageSimilarity * 100).toFixed(1)}%`,
  );
  console.log(
    `Escalated to Judge: ${arbitrationResult.escalatedToJudge ? '⚖️ YES' : 'NO'}`,
  );
  console.log(`Judge Model: ${arbitrationResult.judgeModel}`);
  console.log(`Definitive Ruling:\n"${arbitrationResult.synthesizedText}"\n`);

  // Scenario C: Pairwise TF Vector similarity
  console.log('--- Scenario C: Zero-Network In-Process TF Vectorizer ---');
  const vocab = new Map<string, number>([
    ['cybersecurity', 0],
    ['zero', 1],
    ['trust', 2],
    ['encryption', 3],
  ]);
  const vec1 = computeTermFrequencyVector(
    'cybersecurity zero trust encryption',
    vocab,
  );
  const vec2 = computeTermFrequencyVector('zero trust cybersecurity', vocab);
  const pairwiseSim = calculatePairwiseSimilarity([vec1, vec2]);
  console.log(
    `Cosine Similarity (BoW Vectors): ${(pairwiseSim * 100).toFixed(1)}%`,
  );
}

main().catch(console.error);
