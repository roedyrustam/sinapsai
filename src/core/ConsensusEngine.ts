/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Speculative Multi-Draft Consensus & Model Arbitration Engine
 *
 * Implements:
 * 1. Parallel multi-model speculative drafting.
 * 2. Pairwise semantic similarity consensus validation (cosine similarity).
 * 3. Automatic escalation to a Judge Model when drafts diverge beyond threshold.
 * 4. Resilient fail-soft fallback with latency and cost telemetry.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, UnifiedApiResponse } from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';

export interface ConsensusDraftResult {
  model: string;
  provider?: string;
  response: UnifiedApiResponse;
  latencyMs: number;
  text: string;
}

export interface ConsensusOptions {
  /**
   * Models to draft candidate responses in parallel.
   * e.g. ['gemini-2.5-flash-lite', 'llama-3.3-70b-versatile', 'gpt-4o-mini']
   */
  draftModels: string[];
  /**
   * Judge model to arbitrate and synthesize when consensus is not reached.
   * e.g. 'gemini-2.5-pro' or 'claude-3-7-sonnet'
   */
  judgeModel?: string;
  /**
   * Minimum semantic cosine similarity threshold to consider consensus reached (default: 0.85).
   */
  consensusThreshold?: number;
  /**
   * Prompt messages to send to candidate models.
   */
  messages: ChatMessage[];
  /**
   * Optional custom embedding function: (text: string) => Promise<number[]>
   */
  customEmbed?: (text: string) => Promise<number[]>;
  /**
   * Optional temperature override for drafts (default: 0.2).
   */
  temperature?: number;
  /**
   * Optional maxTokens for draft models.
   */
  maxTokens?: number;
  /**
   * Optional AbortSignal.
   */
  signal?: AbortSignal;
}

export interface ConsensusResult {
  /**
   * Authoritative final response (either consensus centroid or Judge synthesized answer).
   */
  finalResponse: UnifiedApiResponse;
  /**
   * Synthesized final answer text extracted from finalResponse.
   */
  synthesizedText: string;
  /**
   * True if candidate draft models reached consensus above threshold.
   */
  consensusReached: boolean;
  /**
   * Average pairwise semantic similarity across all successful drafts (0.0 to 1.0).
   */
  averageSimilarity: number;
  /**
   * Alias for averageSimilarity.
   */
  consensusScore: number;
  /**
   * Individual candidate draft results with latencies.
   */
  drafts: ConsensusDraftResult[];
  /**
   * True if divergence triggered Judge Model arbitration.
   */
  escalatedToJudge: boolean;
  /**
   * Alias for escalatedToJudge.
   */
  judgeEscalated: boolean;
  /**
   * Judge model used for arbitration, if escalated.
   */
  judgeModel?: string;
  /**
   * Response from the Judge Model if arbitration was invoked.
   */
  judgeResponse?: UnifiedApiResponse;
  /**
   * Total execution time in milliseconds.
   */
  totalDurationMs: number;
}

/**
 * Fast in-process bag-of-words / TF vectorizer for zero-network cosine similarity
 * when no remote embedding model is configured.
 */
export function computeTermFrequencyVector(
  text: string,
  vocabulary: Map<string, number>,
): number[] {
  const vec = new Array(vocabulary.size).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  for (const word of words) {
    const idx = vocabulary.get(word);
    if (idx !== undefined) {
      vec[idx] += 1;
    }
  }

  // Normalize L2
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

/**
 * Computes pairwise cosine similarity matrix and returns average similarity.
 */
export function calculatePairwiseSimilarity(vectors: number[][]): number {
  if (vectors.length < 2) return 1.0;

  let totalSim = 0;
  let pairs = 0;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const sim = Math.max(0, cosineSimilarity(vectors[i], vectors[j]));
      totalSim += sim;
      pairs++;
    }
  }

  return pairs > 0 ? Number((totalSim / pairs).toFixed(4)) : 1.0;
}

export class ConsensusEngine {
  /**
   * Executes multi-model speculative drafting and consensus arbitration.
   */
  public async execute(
    client: {
      chat: {
        completions: {
          // biome-ignore lint/suspicious/noExplicitAny: accepts SinapsClient completions.create
          create: (req: any) => Promise<any>;
        };
      };
      embeddings?: {
        // biome-ignore lint/suspicious/noExplicitAny: accepts embeddings client
        create: (req: any) => Promise<any>;
      };
    },
    options: ConsensusOptions,
  ): Promise<ConsensusResult> {
    const start = Date.now();
    const threshold = options.consensusThreshold ?? 0.85;

    const extractText = (res: UnifiedApiResponse): string => {
      const c = res.choices?.[0]?.message?.content;
      return typeof c === 'string' ? c : JSON.stringify(c ?? '');
    };

    if (!options.draftModels || options.draftModels.length === 0) {
      throw new Error(
        'ConsensusEngine requires at least one draftModel in draftModels array.',
      );
    }

    // 1. Dispatch parallel speculative draft requests
    const draftPromises = options.draftModels.map(async (model) => {
      const draftStart = Date.now();
      const res = await client.chat.completions.create({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens,
        signal: options.signal,
      });

      const latencyMs = Date.now() - draftStart;
      const text = res.choices?.[0]?.message?.content || '';

      return {
        model,
        provider: res.provider,
        response: res,
        latencyMs,
        text,
      } as ConsensusDraftResult;
    });

    const settled = await Promise.allSettled(draftPromises);
    const successfulDrafts: ConsensusDraftResult[] = [];

    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.text.trim().length > 0) {
        successfulDrafts.push(s.value);
      }
    }

    if (successfulDrafts.length === 0) {
      const firstRejected = settled.find((s) => s.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      throw (
        firstRejected?.reason ??
        new Error('All candidate draft models failed to produce a response.')
      );
    }

    // If only 1 draft succeeded, consensus is trivially unanimous
    if (successfulDrafts.length === 1) {
      return {
        finalResponse: successfulDrafts[0].response,
        synthesizedText: extractText(successfulDrafts[0].response),
        consensusReached: true,
        averageSimilarity: 1.0,
        consensusScore: 1.0,
        drafts: successfulDrafts,
        escalatedToJudge: false,
        judgeEscalated: false,
        totalDurationMs: Date.now() - start,
      };
    }

    // 2. Compute semantic embeddings or TF vectors for drafts
    let vectors: number[][] = [];

    const embedFn = options.customEmbed;
    if (embedFn) {
      vectors = await Promise.all(successfulDrafts.map((d) => embedFn(d.text)));
    } else {
      // Build in-process shared vocabulary for zero-network TF vectors
      const vocab = new Map<string, number>();
      let vocabIdx = 0;
      for (const d of successfulDrafts) {
        const words = d.text
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2);
        for (const w of words) {
          if (!vocab.has(w)) {
            vocab.set(w, vocabIdx++);
          }
        }
      }
      vectors = successfulDrafts.map((d) =>
        computeTermFrequencyVector(d.text, vocab),
      );
    }

    // 3. Evaluate Pairwise Similarity
    const averageSimilarity = calculatePairwiseSimilarity(vectors);
    const consensusReached = averageSimilarity >= threshold;

    // 4. If consensus reached, select fastest or centroid candidate
    if (consensusReached || !options.judgeModel) {
      // Pick fastest candidate among successful drafts
      const best = [...successfulDrafts].sort(
        (a, b) => a.latencyMs - b.latencyMs,
      )[0];
      return {
        finalResponse: best.response,
        synthesizedText: extractText(best.response),
        consensusReached,
        averageSimilarity,
        consensusScore: averageSimilarity,
        drafts: successfulDrafts,
        escalatedToJudge: false,
        judgeEscalated: false,
        totalDurationMs: Date.now() - start,
      };
    }

    // 5. Consensus NOT reached and Judge Model is specified: Arbitrate!
    const userPromptText = options.messages
      .filter((m) => m.role === 'user')
      .map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      )
      .join('\n');

    const draftEvidence = successfulDrafts
      .map(
        (d, i) =>
          `### Candidate Draft ${i + 1} (${d.model} | ${d.latencyMs}ms):\n${d.text}`,
      )
      .join('\n\n');

    const judgePrompt: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are an expert Supreme AI Arbitrator. Multiple independent AI models produced divergent answers for the user request. Analyze the candidate drafts, cross-verify claims, eliminate hallucinations, and synthesize the single authoritative, complete, and accurate final response.',
      },
      {
        role: 'user',
        content: `User Request:\n"""\n${userPromptText}\n"""\n\nCandidate Drafts:\n${draftEvidence}\n\nPlease deliver the definitive answer:`,
      },
    ];

    const judgeResponse = await client.chat.completions.create({
      model: options.judgeModel,
      messages: judgePrompt,
      temperature: 0.1,
      signal: options.signal,
    });

    return {
      finalResponse: judgeResponse,
      synthesizedText: extractText(judgeResponse),
      consensusReached: false,
      averageSimilarity,
      consensusScore: averageSimilarity,
      drafts: successfulDrafts,
      escalatedToJudge: true,
      judgeEscalated: true,
      judgeModel: options.judgeModel,
      judgeResponse,
      totalDurationMs: Date.now() - start,
    };
  }
}
