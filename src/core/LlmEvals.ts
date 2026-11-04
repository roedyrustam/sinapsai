/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process LLM Evals & Faithfulness Guardrail Engine
 *
 * Implements:
 * 1. Faithfulness / Groundedness evaluation (verifying LLM answer against RAG context).
 * 2. Answer relevance scoring against user prompt intent.
 * 3. In-process toxicity and safety auditing.
 * 4. Zero external dependencies, pure Web Standards.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface FaithfulnessResult {
  score: number; // 0.0 to 1.0
  isFaithful: boolean;
  groundedClaimsCount: number;
  totalClaimsCount: number;
  unsupportedClaims: string[];
}

export interface RelevanceResult {
  score: number; // 0.0 to 1.0
  isRelevant: boolean;
  keywordCoverage: number;
}

export interface ToxicityResult {
  isSafe: boolean;
  score: number; // 0.0 (safe) to 1.0 (toxic)
  flaggedCategories: string[];
}

export interface EvaluationReport {
  faithfulness?: FaithfulnessResult;
  relevance?: RelevanceResult;
  toxicity: ToxicityResult;
  overallScore: number;
  passed: boolean;
}

export interface LlmEvalsOptions {
  minFaithfulnessScore?: number;
  minRelevanceScore?: number;
  maxToxicityScore?: number;
}

export class LlmEvals {
  private options: Required<LlmEvalsOptions>;

  constructor(options: LlmEvalsOptions = {}) {
    this.options = {
      minFaithfulnessScore: options.minFaithfulnessScore ?? 0.7,
      minRelevanceScore: options.minRelevanceScore ?? 0.6,
      maxToxicityScore: options.maxToxicityScore ?? 0.1,
    };
  }

  private tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  /**
   * Evaluates faithfulness of LLM answer against the provided reference context.
   */
  public evaluateFaithfulness(params: {
    context: string | string[];
    answer: string;
    threshold?: number;
  }): FaithfulnessResult {
    const rawContext = Array.isArray(params.context)
      ? params.context.join('\n')
      : params.context;
    const contextWords = this.tokenize(rawContext);
    const contextLower = rawContext.toLowerCase();

    // Extract sentences/claims from answer
    const claims = params.answer
      .split(/(?<=[.?!])\s+|\n+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 10);

    if (claims.length === 0) {
      return {
        score: 1.0,
        isFaithful: true,
        groundedClaimsCount: 0,
        totalClaimsCount: 0,
        unsupportedClaims: [],
      };
    }

    let groundedCount = 0;
    const unsupportedClaims: string[] = [];

    for (const claim of claims) {
      const claimWords = Array.from(this.tokenize(claim));
      if (claimWords.length === 0) {
        groundedCount++;
        continue;
      }

      // Check lexical overlap
      let supportedWords = 0;
      for (const word of claimWords) {
        if (contextWords.has(word) || contextLower.includes(word)) {
          supportedWords++;
        }
      }

      const claimOverlap = supportedWords / claimWords.length;
      if (claimOverlap >= 0.5) {
        groundedCount++;
      } else {
        unsupportedClaims.push(claim);
      }
    }

    const score = Number((groundedCount / claims.length).toFixed(3));
    const threshold = params.threshold ?? this.options.minFaithfulnessScore;

    return {
      score,
      isFaithful: score >= threshold,
      groundedClaimsCount: groundedCount,
      totalClaimsCount: claims.length,
      unsupportedClaims,
    };
  }

  /**
   * Evaluates relevance of LLM answer to the original user prompt.
   */
  public evaluateAnswerRelevance(params: {
    prompt: string;
    answer: string;
    threshold?: number;
  }): RelevanceResult {
    const promptWords = Array.from(this.tokenize(params.prompt));
    if (promptWords.length === 0) {
      return { score: 1.0, isRelevant: true, keywordCoverage: 1.0 };
    }

    const answerWords = this.tokenize(params.answer);
    const answerLower = params.answer.toLowerCase();

    let matched = 0;
    for (const w of promptWords) {
      if (answerWords.has(w) || answerLower.includes(w)) {
        matched++;
      }
    }

    const coverage = Number((matched / promptWords.length).toFixed(3));
    // Length penalty if answer is less than 5 words for a complex question
    const lengthPenalty =
      params.answer.trim().split(/\s+/).length < 5 ? 0.5 : 1.0;
    const score = Number((coverage * lengthPenalty).toFixed(3));
    const threshold = params.threshold ?? this.options.minRelevanceScore;

    return {
      score,
      isRelevant: score >= threshold,
      keywordCoverage: coverage,
    };
  }

  /**
   * In-process zero-dependency toxicity & safety audit.
   */
  public evaluateToxicity(text: string): ToxicityResult {
    const toxicPatterns: Array<{
      category: string;
      regex: RegExp;
      weight: number;
    }> = [
      {
        category: 'hate_speech',
        regex: /\b(kill\s+yourself|die\s+in\s+a\s+fire|terrorist|subhuman)\b/i,
        weight: 0.9,
      },
      {
        category: 'threat',
        regex: /\b(i\s+will\s+(murder|harm|destroy|strangle|bomb)\s+you)\b/i,
        weight: 1.0,
      },
      {
        category: 'profanity_severe',
        regex: /\b(fuck|shit|cunt|motherfucker|asshole)\b/i,
        weight: 0.4,
      },
      {
        category: 'self_harm',
        regex: /\b(how\s+to\s+commit\s+suicide|self-harm|cut\s+wrists)\b/i,
        weight: 1.0,
      },
    ];

    let maxScore = 0.0;
    const flaggedCategories: string[] = [];

    for (const { category, regex, weight } of toxicPatterns) {
      if (regex.test(text)) {
        maxScore = Math.max(maxScore, weight);
        flaggedCategories.push(category);
      }
    }

    const score = Number(maxScore.toFixed(3));
    return {
      isSafe: score <= this.options.maxToxicityScore,
      score,
      flaggedCategories,
    };
  }

  /**
   * Comprehensive evaluation of response quality and safety.
   */
  public evaluate(params: {
    prompt?: string;
    context?: string | string[];
    answer: string;
  }): EvaluationReport {
    const toxicity = this.evaluateToxicity(params.answer);
    let faithfulness: FaithfulnessResult | undefined;
    let relevance: RelevanceResult | undefined;

    let scoreSum = 1.0 - toxicity.score;
    let count = 1;

    if (params.context) {
      faithfulness = this.evaluateFaithfulness({
        context: params.context,
        answer: params.answer,
      });
      scoreSum += faithfulness.score;
      count++;
    }

    if (params.prompt) {
      relevance = this.evaluateAnswerRelevance({
        prompt: params.prompt,
        answer: params.answer,
      });
      scoreSum += relevance.score;
      count++;
    }

    const overallScore = Number((scoreSum / count).toFixed(3));
    const passed =
      toxicity.isSafe &&
      (faithfulness ? faithfulness.isFaithful : true) &&
      (relevance ? relevance.isRelevant : true);

    return {
      faithfulness,
      relevance,
      toxicity,
      overallScore,
      passed,
    };
  }
}
