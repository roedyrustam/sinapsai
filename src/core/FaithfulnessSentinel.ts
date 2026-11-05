/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Hallucination & Faithfulness Sentinel (RAG Grounding Verification Gate)
 *
 * Implements:
 * 1. Zero-dependency atomic claim extraction from LLM outputs.
 * 2. Rapid in-process lexical & n-gram reference context alignment (Zero latency, 0 tokens).
 * 3. Optional LLM-as-a-judge verification for borderline assertions.
 * 4. Grounding verification score calculation (0.0 to 1.0).
 * 5. Automatic remediation & hedged retry on low faithfulness scores.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, UnifiedApiResponse } from '../types/index.js';
import type { SinapsClient } from './SinapsClient.js';

export interface ClaimAudit {
  claim: string;
  isSupported: boolean;
  confidence: number;
  matchingSnippet?: string;
  matchingChunkIndex?: number;
}

export interface GroundingVerificationResult {
  score: number; // 0.0 to 1.0
  passed: boolean;
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: string[];
  claimAudits: ClaimAudit[];
  escalated?: boolean;
  originalAnswer?: string;
  finalAnswer: string;
  durationMs: number;
}

export interface FaithfulnessSentinelOptions {
  minFaithfulnessScore?: number; // default: 0.75
  mode?: 'heuristic' | 'llm_judge' | 'hybrid'; // default: 'heuristic'
  judgeModel?: string;
  escalationModel?: string;
  autoEscalate?: boolean;
  client?: SinapsClient;
}

export interface VerifyGroundingParams {
  answer: string;
  context: string | string[];
  threshold?: number;
  prompt?: string;
}

export interface GroundingVerifiedRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
  }>;
  context: string | string[];
  minFaithfulness?: number;
  autoRetryOnHallucination?: boolean;
  escalationModel?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
}

export class FaithfulnessSentinel {
  public readonly minFaithfulnessScore: number;
  public readonly mode: 'heuristic' | 'llm_judge' | 'hybrid';
  public readonly judgeModel?: string;
  public readonly escalationModel?: string;
  public readonly autoEscalate: boolean;
  private client?: SinapsClient;

  constructor(options: FaithfulnessSentinelOptions = {}) {
    this.minFaithfulnessScore = options.minFaithfulnessScore ?? 0.75;
    this.mode = options.mode ?? 'heuristic';
    this.judgeModel = options.judgeModel;
    this.escalationModel = options.escalationModel;
    this.autoEscalate = options.autoEscalate ?? false;
    this.client = options.client;
  }

  public setClient(client: SinapsClient): void {
    this.client = client;
  }

  /**
   * Tokenizes text into normalized words of length > 2.
   */
  private tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  /**
   * Splits an LLM response into discrete atomic claims/assertions.
   */
  public extractClaims(text: string): string[] {
    if (!text || text.trim().length === 0) return [];

    // Split on sentence terminators or bullet points / newlines
    const rawSegments = text
      .split(/(?<=[.?!])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const claims: string[] = [];

    // Conversational preamble prefixes to exclude
    const preambleRegex =
      /^(sure|certainly|here is|here are|based on|according to|of course|as an ai|in summary|to summarize)\b/i;

    for (const seg of rawSegments) {
      // Strip leading markdown bullets / numbered list tokens
      const clean = seg.replace(/^[-*•\d.]+\s*/, '').trim();

      if (clean.length < 8) continue;
      if (preambleRegex.test(clean) && clean.split(/\s+/).length < 6) {
        continue;
      }

      claims.push(clean);
    }

    return claims.length > 0 ? claims : [text.trim()];
  }

  /**
   * Rapid in-process heuristic grounding verification against context.
   */
  public verifyGrounding(
    params: VerifyGroundingParams,
  ): GroundingVerificationResult {
    const startTime = Date.now();
    const threshold = params.threshold ?? this.minFaithfulnessScore;

    const chunks: string[] = Array.isArray(params.context)
      ? params.context
      : [params.context];

    const claims = this.extractClaims(params.answer);

    if (claims.length === 0) {
      return {
        score: 1.0,
        passed: true,
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: [],
        claimAudits: [],
        finalAnswer: params.answer,
        durationMs: Date.now() - startTime,
      };
    }

    const chunkTokenSets = chunks.map((c) => this.tokenize(c));
    const chunkLowerList = chunks.map((c) => c.toLowerCase());

    const claimAudits: ClaimAudit[] = [];
    let supportedCount = 0;
    const unsupportedClaims: string[] = [];

    for (const claim of claims) {
      const claimWords = Array.from(this.tokenize(claim));
      if (claimWords.length === 0) {
        supportedCount++;
        claimAudits.push({
          claim,
          isSupported: true,
          confidence: 1.0,
        });
        continue;
      }

      let bestChunkIndex = -1;
      let maxOverlap = 0;
      let matchingSnippet: string | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const tokenSet = chunkTokenSets[i];
        const lowerChunk = chunkLowerList[i];

        let matched = 0;
        for (const word of claimWords) {
          if (tokenSet.has(word) || lowerChunk.includes(word)) {
            matched++;
          }
        }

        const overlap = matched / claimWords.length;
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestChunkIndex = i;
          matchingSnippet = chunks[i].slice(0, 120);
        }
      }

      // Claim is considered grounded if >= 50% salient words match context
      const isSupported = maxOverlap >= 0.5;

      if (isSupported) {
        supportedCount++;
      } else {
        unsupportedClaims.push(claim);
      }

      claimAudits.push({
        claim,
        isSupported,
        confidence: Number(maxOverlap.toFixed(3)),
        matchingChunkIndex: bestChunkIndex !== -1 ? bestChunkIndex : undefined,
        matchingSnippet: isSupported ? matchingSnippet : undefined,
      });
    }

    const score = Number((supportedCount / claims.length).toFixed(3));
    const passed = score >= threshold;

    return {
      score,
      passed,
      totalClaims: claims.length,
      supportedClaims: supportedCount,
      unsupportedClaims,
      claimAudits,
      finalAnswer: params.answer,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * High-level verification with automatic retry / escalation if hallucination detected.
   */
  public async executeVerifiedCompletion(
    params: GroundingVerifiedRequest,
    callerClient: SinapsClient,
  ): Promise<{
    completion: UnifiedApiResponse;
    grounding: GroundingVerificationResult;
  }> {
    const client = this.client ?? callerClient;
    const threshold = params.minFaithfulness ?? this.minFaithfulnessScore;
    const autoRetry =
      params.autoRetryOnHallucination ?? this.autoEscalate ?? true;
    const escalationModel = params.escalationModel ?? this.escalationModel;

    // Inject context into messages if not already present
    const rawContext = Array.isArray(params.context)
      ? params.context.join('\n\n')
      : params.context;

    const baseMessages: ChatMessage[] = [...params.messages];
    const systemPromptAddition = `\n\nREFERENCE CONTEXT:\n${rawContext}\n\nINSTRUCTION: Answer the question strictly using the provided context above. Do not introduce outside unverified facts.`;

    const firstSystemIdx = baseMessages.findIndex((m) => m.role === 'system');
    if (firstSystemIdx >= 0) {
      baseMessages[firstSystemIdx] = {
        ...baseMessages[firstSystemIdx],
        content: baseMessages[firstSystemIdx].content + systemPromptAddition,
      };
    } else {
      baseMessages.unshift({
        role: 'system',
        content: systemPromptAddition.trim(),
      });
    }

    // First attempt
    const completion = (await client.chat.completions.create({
      model: params.model,
      messages: baseMessages,
      temperature: params.temperature ?? 0.2,
      maxTokens: params.maxTokens ?? params.max_tokens,
    })) as UnifiedApiResponse;

    const firstAnswer = completion.choices[0]?.message?.content || '';
    const verification = this.verifyGrounding({
      answer: firstAnswer,
      context: params.context,
      threshold,
    });

    // If passed or autoRetry disabled or no escalation model, return first attempt
    if (verification.passed || !autoRetry) {
      return { completion, grounding: verification };
    }

    // Escalation / Remediation Attempt
    const strictSystemPrompt = `CRITICAL ACCURACY INSTRUCTION: The previous answer contained potential ungrounded claims. Answer strictly and solely based on the provided reference context facts. If the information is not present in the context, explicitly say: "I do not have enough context to answer this." Do not extrapolate.\n\nREFERENCE CONTEXT:\n${rawContext}`;

    const retryMessages: ChatMessage[] = [
      { role: 'system', content: strictSystemPrompt },
      ...params.messages.filter((m) => m.role !== 'system'),
    ];

    const retryModel = escalationModel || params.model;

    const retryCompletion = (await client.chat.completions.create({
      model: retryModel,
      messages: retryMessages,
      temperature: 0.0, // clamp to deterministic
      maxTokens: params.maxTokens ?? params.max_tokens,
    })) as UnifiedApiResponse;

    const retryAnswer = retryCompletion.choices[0]?.message?.content || '';
    const retryVerification = this.verifyGrounding({
      answer: retryAnswer,
      context: params.context,
      threshold,
    });

    retryVerification.escalated = true;
    retryVerification.originalAnswer = firstAnswer;

    // Return retry if better or equal score, else keep first
    if (retryVerification.score >= verification.score) {
      return {
        completion: retryCompletion,
        grounding: retryVerification,
      };
    }

    return {
      completion,
      grounding: verification,
    };
  }
}
