/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Universal LLM Optimization Engine (LLMO)
 *
 * Implements:
 * 1. Universal Prompt Token Minification & Whitespace Pruning (code-block aware).
 * 2. System Instruction Deduplication & Normalization.
 * 3. Deterministic KV-Cache Prefix Alignment & Tool Schema Canonicalization.
 * 4. Multi-Signal Complexity Analysis & Adaptive Model Cascading (Tier 1/2/3).
 * 5. Dynamic Thinking Budget Allocation & Output Token Optimization.
 * 6. FinOps Token & USD Savings Telemetry.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ChatMessage,
  ContentPart,
  TextContentPart,
  ToolDefinition,
  UnifiedApiRequest,
} from '../types/index.js';
import {
  estimateMessageTokens,
  estimateTotalTokens,
} from './ContextCompressor.js';
import { canonicalizeJsonValue } from './GeminiAgentBooster.js';

export interface LlmCascadeTiers {
  /**
   * Tier 1 (Light/Fast): For greetings, simple QA, basic classification (complexity <= 0.35).
   * e.g., 'gemini-2.5-flash-lite', 'gpt-4o-mini', 'llama-3.3-70b-versatile'
   */
  tier1?: string;
  /**
   * Tier 2 (Standard): For general reasoning, summaries, standard coding (0.35 < complexity <= 0.70).
   * e.g., 'gemini-2.5-flash', 'gpt-4o', 'claude-3-5-haiku'
   */
  tier2?: string;
  /**
   * Tier 3 (Deep Reasoning): For complex architecture, math, proofs, multi-step debugging (complexity > 0.70).
   * e.g., 'gemini-2.5-pro', 'claude-3-7-sonnet', 'o3-mini', 'deepseek-r1'
   */
  tier3?: string;
}

export interface LlmOptimizationOptions {
  /**
   * Enable LLM Optimization pipeline. Default: true
   */
  enabled?: boolean;
  /**
   * Minify prompt whitespace and redundant formatting while preserving code blocks verbatim.
   * Default: true
   */
  minifyPrompts?: boolean;
  /**
   * Minification mode:
   * - 'lossless': Strips redundant whitespace, blank lines (>1), and trims lines. Zero semantic meaning lost.
   * - 'aggressive': Also strips polite conversational fluff (e.g. "please", "kindly", repeated greetings).
   * Default: 'lossless'
   */
  minificationMode?: 'lossless' | 'aggressive';
  /**
   * Deduplicate system instructions across conversation turns. Default: true
   */
  deduplicateSystem?: boolean;
  /**
   * Align KV-cache prefixes deterministically (lexicographical tool & schema canonicalization).
   * Default: true
   */
  alignKvCachePrefix?: boolean;
  /**
   * Automatically cascade models based on prompt complexity score. Default: false
   */
  autoCascadeModel?: boolean;
  /**
   * Custom model tier mapping for cascading.
   */
  cascadeTiers?: LlmCascadeTiers;
  /**
   * Automatically allocate thinking budget or reasoning effort based on complexity. Default: true
   */
  dynamicThinking?: boolean;
}

export interface LlmRequestOptimizationOptions {
  /**
   * Override prompt minification for this request.
   */
  minify?: boolean;
  /**
   * Override model cascading for this request.
   */
  cascade?: boolean;
  /**
   * Override minification mode for this request.
   */
  mode?: 'lossless' | 'aggressive';
}

export type LlmComplexityTier = 'tier1' | 'tier2' | 'tier3';

export interface LlmComplexityAnalysis {
  /**
   * Normalized complexity score in the range [0.0, 1.0].
   */
  score: number;
  /**
   * Resolved complexity tier.
   */
  tier: LlmComplexityTier;
  /**
   * Diagnostic signals contributing to complexity evaluation.
   */
  signals: string[];
  /**
   * Recommended model from configured cascade tiers if applicable.
   */
  recommendedModel?: string;
  /**
   * Recommended thinking budget token count (0, 2048, 8192, or 32768).
   */
  recommendedThinkingBudget?: number;
}

export interface LlmOptimizationResult {
  messages: ChatMessage[];
  originalTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  savingsRatio: number;
  complexity: LlmComplexityAnalysis;
  cascadeModel?: string;
  tools?: ToolDefinition[];
  thinkingBudget?: number | 'auto';
}

export interface LlmOptimizationMetrics {
  totalOptimizedRequests: number;
  totalTokensSaved: number;
  totalEstimatedUsdSaved: number;
  averageCompressionRatio: number;
  cascadedRequestsCount: number;
}

const COMPLEX_REASONING_REGEX =
  /\b(architect(?:ure)?|refactor|optimiz(?:e|ation)|vulnerabilit(?:y|ies)|security\s+audit|prove|theorem|algorithm|concurren(?:t|cy)|deadlock|race\s+condition|distributed|microkernel|step[\s-]by[\s-]step|root\s+cause|stack\s+trace|benchmark|formal\s+verification|regex|memory\s+leak|reverse\s+engineer)\b/i;

const CODE_OR_MATH_REGEX =
  /```[\s\S]*?```|\b(?:function|class|interface|SELECT\s+.+\s+FROM|CREATE\s+TABLE|async\s+function|Promise\.all|TypeError:|ReferenceError:|Error:\s+at\s+)\b|\$\$[\s\S]+?\$\$/i;

const SIMPLE_INTENT_REGEX =
  /^(?:hi|hello|hey|halo|ping|ok|okay|thanks|thank\s+you|terima\s+kasih|yes|no|ya|tidak|translate\s+to\s+\w+:|classify\s*:)/i;

const AGGRESSIVE_FLUFF_REGEX =
  /^(?:(?:could|can|would)\s+you\s+(?:please\s+)?(?:help\s+me\s+)?(?:to\s+)?|please\s+(?:kindly\s+)?|kindly\s+|i\s+(?:would\s+like|want)\s+you\s+to\s+)/i;

export const DEFAULT_CASCADE_TIERS: Required<LlmCascadeTiers> = {
  tier1: 'gemini-2.5-flash-lite',
  tier2: 'gemini-2.5-flash',
  tier3: 'gemini-2.5-pro',
};

/**
 * Fast, zero-dependency token estimation (~4 chars per token).
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export { estimateMessageTokens, estimateTotalTokens };

/**
 * Minifies markdown/prose text while strictly preserving code blocks verbatim.
 */
export function minifyProsePreservingCode(
  text: string,
  mode: 'lossless' | 'aggressive' = 'lossless',
): string {
  if (!text || text.length === 0) {
    return text;
  }

  // Split by fenced code blocks (``` ... ``` or ```` ... ````)
  const codeBlockRegex = /(```[\s\S]*?```|````[\s\S]*?````)/g;
  const parts = text.split(codeBlockRegex);

  const processedParts = parts.map((part) => {
    // If it's a code block, leave strictly unchanged to preserve syntax, indentation, and formatting
    if (part.startsWith('```') || part.startsWith('````')) {
      return part;
    }

    // Process prose portion
    let p = part.replace(/\r\n/g, '\n');

    // In aggressive mode, strip polite filler phrases at start of prose
    if (mode === 'aggressive') {
      p = p.replace(AGGRESSIVE_FLUFF_REGEX, '');
    }

    // Collapse multiple spaces or tabs into a single space (excluding newlines)
    p = p.replace(/[ \t]+/g, ' ');

    // Trim trailing whitespace from each line
    p = p
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    // Collapse 3 or more consecutive newlines into 2 (preserving markdown paragraphs)
    p = p.replace(/\n{3,}/g, '\n\n');

    return p;
  });

  return processedParts.join('').trim();
}

/**
 * Deduplicates system messages and normalizes identical rule statements.
 */
export function deduplicateSystemInstructions(
  messages: ChatMessage[],
): ChatMessage[] {
  const systemMessages: ChatMessage[] = [];
  const otherMessages: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemMessages.push(m);
    } else {
      otherMessages.push(m);
    }
  }

  if (systemMessages.length <= 1) {
    return messages;
  }

  // Combine and deduplicate lines across system messages
  const seenLines = new Set<string>();
  const combinedLines: string[] = [];

  for (const sm of systemMessages) {
    const content =
      typeof sm.content === 'string'
        ? sm.content
        : Array.isArray(sm.content)
          ? sm.content
              .filter((c) => c.type === 'text')
              .map((c) => (c as TextContentPart).text)
              .join('\n')
          : '';

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        combinedLines.push('');
        continue;
      }
      if (!seenLines.has(trimmed)) {
        seenLines.add(trimmed);
        combinedLines.push(trimmed);
      }
    }
  }

  const mergedSystemContent = combinedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  const mergedSystemMessage: ChatMessage = {
    role: 'system',
    content: mergedSystemContent,
  };

  return [mergedSystemMessage, ...otherMessages];
}

/**
 * Canonicalizes tool definitions to ensure byte-identical prefix hashes for KV caches.
 */
export function canonicalizeTools(
  tools?: ToolDefinition[],
): ToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools;
  }

  return [...tools]
    .sort((a, b) => a.function.name.localeCompare(b.function.name))
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
          ? (canonicalizeJsonValue(tool.function.parameters) as Record<
              string,
              unknown
            >)
          : undefined,
      },
    }));
}

export class LlmOptimizer {
  private options: LlmOptimizationOptions;
  private metrics: LlmOptimizationMetrics = {
    totalOptimizedRequests: 0,
    totalTokensSaved: 0,
    totalEstimatedUsdSaved: 0,
    averageCompressionRatio: 1.0,
    cascadedRequestsCount: 0,
  };

  constructor(options: LlmOptimizationOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      minifyPrompts: options.minifyPrompts ?? true,
      minificationMode: options.minificationMode ?? 'lossless',
      deduplicateSystem: options.deduplicateSystem ?? true,
      alignKvCachePrefix: options.alignKvCachePrefix ?? true,
      autoCascadeModel: options.autoCascadeModel ?? false,
      cascadeTiers: options.cascadeTiers ?? DEFAULT_CASCADE_TIERS,
      dynamicThinking: options.dynamicThinking ?? true,
    };
  }

  /**
   * Analyzes prompt messages to calculate a normalized complexity score [0.0, 1.0],
   * complexity tier, and recommended model/thinking budget.
   */
  public analyzeComplexity(
    messages: ChatMessage[],
    tiers: LlmCascadeTiers = this.options.cascadeTiers ?? DEFAULT_CASCADE_TIERS,
  ): LlmComplexityAnalysis {
    const resolvedTiers = { ...DEFAULT_CASCADE_TIERS, ...tiers };
    const signals: string[] = [];
    let score = 0.2; // Base baseline

    let totalChars = 0;
    let hasCodeOrMath = false;
    let hasComplexReasoning = false;
    let hasSimpleIntent = false;

    for (const m of messages) {
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((p) => p.type === 'text')
                .map((p) => (p as TextContentPart).text)
                .join(' ')
            : '';

      totalChars += text.length;

      if (CODE_OR_MATH_REGEX.test(text)) {
        hasCodeOrMath = true;
      }
      if (COMPLEX_REASONING_REGEX.test(text)) {
        hasComplexReasoning = true;
      }
      if (m.role === 'user' && SIMPLE_INTENT_REGEX.test(text.trim())) {
        hasSimpleIntent = true;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        signals.push('tool_calling_history');
        score += 0.15;
      }
    }

    if (
      hasSimpleIntent &&
      totalChars < 80 &&
      !hasCodeOrMath &&
      !hasComplexReasoning
    ) {
      signals.push('simple_intent');
      score -= 0.15;
    }

    if (hasCodeOrMath) {
      signals.push('code_or_math_blocks');
      score += 0.3;
    }

    if (hasComplexReasoning) {
      signals.push('complex_reasoning_keywords');
      score += 0.35;
    }

    // Turn depth and length factor
    if (messages.length > 6) {
      signals.push('multi_turn_depth');
      score += 0.15;
    }
    if (totalChars > 4000) {
      signals.push('long_context');
      score += 0.2;
    }

    // Clamp score to [0.0, 1.0]
    score = Math.max(0.0, Math.min(1.0, Number(score.toFixed(3))));

    let tier: LlmComplexityTier = 'tier2';
    let recommendedBudget = 2048;
    let recommendedModel = resolvedTiers.tier2;

    if (score <= 0.35) {
      tier = 'tier1';
      recommendedBudget = 0;
      recommendedModel = resolvedTiers.tier1;
    } else if (score > 0.7) {
      tier = 'tier3';
      recommendedBudget = 8192;
      recommendedModel = resolvedTiers.tier3;
    }

    return {
      score,
      tier,
      signals,
      recommendedModel,
      recommendedThinkingBudget: recommendedBudget,
    };
  }

  /**
   * Executes the full LLM Optimization pipeline on an incoming UnifiedApiRequest.
   */
  public optimize(
    request: UnifiedApiRequest,
    overrideOptions?: LlmRequestOptimizationOptions,
  ): LlmOptimizationResult {
    const isEnabled = this.options.enabled !== false;
    const originalTokens = estimateTotalTokens(request.messages);

    if (!isEnabled) {
      const complexity = this.analyzeComplexity(request.messages);
      return {
        messages: request.messages,
        originalTokens,
        optimizedTokens: originalTokens,
        tokensSaved: 0,
        savingsRatio: 0,
        complexity,
        tools: request.tools,
        thinkingBudget: request.thinkingBudget,
      };
    }

    let messages = [...request.messages];
    const shouldMinify =
      overrideOptions?.minify ?? this.options.minifyPrompts ?? true;
    const mode =
      overrideOptions?.mode ?? this.options.minificationMode ?? 'lossless';

    // 1. Deduplicate system instructions
    if (this.options.deduplicateSystem) {
      messages = deduplicateSystemInstructions(messages);
    }

    // 2. Minify prose while preserving code blocks
    if (shouldMinify) {
      messages = messages.map((m) => {
        if (typeof m.content === 'string') {
          return {
            ...m,
            content: minifyProsePreservingCode(m.content, mode),
          };
        }
        if (Array.isArray(m.content)) {
          return {
            ...m,
            content: m.content.map((part) => {
              if (part.type === 'text') {
                return {
                  ...part,
                  text: minifyProsePreservingCode(
                    (part as TextContentPart).text,
                    mode,
                  ),
                };
              }
              return part;
            }) as ContentPart[],
          };
        }
        return m;
      });
    }

    // 3. Align KV-Cache Prefix by canonicalizing tools
    let tools = request.tools;
    if (this.options.alignKvCachePrefix && tools) {
      tools = canonicalizeTools(tools);
    }

    // 4. Complexity & Dynamic Cascading
    const complexity = this.analyzeComplexity(messages);
    let cascadeModel: string | undefined;

    const shouldCascade =
      overrideOptions?.cascade ??
      (this.options.autoCascadeModel || request.model === 'auto');

    if (shouldCascade && complexity.recommendedModel) {
      cascadeModel = complexity.recommendedModel;
    }

    // 5. Dynamic Thinking Budget
    let thinkingBudget = request.thinkingBudget;
    if (this.options.dynamicThinking && thinkingBudget === undefined) {
      if (complexity.recommendedThinkingBudget !== undefined) {
        thinkingBudget = complexity.recommendedThinkingBudget;
      }
    }

    const optimizedTokens = estimateTotalTokens(messages);
    const tokensSaved = Math.max(0, originalTokens - optimizedTokens);
    const savingsRatio =
      originalTokens > 0
        ? Number((tokensSaved / originalTokens).toFixed(4))
        : 0;

    // FinOps savings telemetry update
    this.recordMetrics(
      tokensSaved,
      originalTokens,
      optimizedTokens,
      !!cascadeModel,
    );

    return {
      messages,
      originalTokens,
      optimizedTokens,
      tokensSaved,
      savingsRatio,
      complexity,
      cascadeModel,
      tools,
      thinkingBudget,
    };
  }

  private recordMetrics(
    tokensSaved: number,
    originalTokens: number,
    optimizedTokens: number,
    cascaded: boolean,
  ): void {
    this.metrics.totalOptimizedRequests++;
    this.metrics.totalTokensSaved += tokensSaved;

    // Approximate FinOps USD savings ($0.003 per 1k input tokens average)
    this.metrics.totalEstimatedUsdSaved += (tokensSaved / 1000) * 0.003;

    if (cascaded) {
      this.metrics.cascadedRequestsCount++;
    }

    const ratio = originalTokens > 0 ? optimizedTokens / originalTokens : 1.0;
    const n = this.metrics.totalOptimizedRequests;
    this.metrics.averageCompressionRatio = Number(
      ((this.metrics.averageCompressionRatio * (n - 1) + ratio) / n).toFixed(4),
    );
  }

  public getMetrics(): LlmOptimizationMetrics {
    return { ...this.metrics };
  }

  public resetMetrics(): void {
    this.metrics = {
      totalOptimizedRequests: 0,
      totalTokensSaved: 0,
      totalEstimatedUsdSaved: 0,
      averageCompressionRatio: 1.0,
      cascadedRequestsCount: 0,
    };
  }
}
