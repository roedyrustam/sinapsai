/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Gemini Agent Booster & KV-Cache Prefix Optimizer (2026 Frontier Edition)
 *
 * Implements:
 * 1. Dynamic Thinking Budget Allocation (`thinkingBudget: 'auto'`) based on multi-signal prompt complexity.
 * 2. Deterministic KV-Cache Prefix Pinning (canonical lexicographical tool & JSON schema sorting).
 * 3. Context Caching Eligibility & FinOps Savings Analyzer (>32k token static prefix detection).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ChatMessage,
  ToolDefinition,
  UnifiedApiRequest,
} from '../types/index.js';

export type ThinkingBudgetTier = 'none' | 'low' | 'medium' | 'high';

export interface ThinkingComplexityAnalysis {
  /**
   * Normalized complexity score in the range [0.0, 1.0].
   */
  score: number;
  /**
   * Resolved thinking tier corresponding to the complexity score.
   */
  tier: ThinkingBudgetTier;
  /**
   * Concrete thinking token budget recommended for Gemini thinkingConfig (0, 2048, 8192, or 32768).
   */
  recommendedBudget: number;
  /**
   * Diagnostic signals that contributed to the complexity score.
   */
  signals: string[];
}

export interface ContextCacheEligibility {
  /**
   * True when the estimated static prefix tokens (system instructions + tools) meet or exceed thresholdTokens.
   */
  eligible: boolean;
  /**
   * Estimated token count of the static prefix (system messages + tool schemas).
   */
  estimatedPrefixTokens: number;
  /**
   * Minimum token threshold required for context caching (default: 32768 for Gemini).
   */
  thresholdTokens: number;
  /**
   * Estimated prompt token cost reduction ratio (0.75 for cached tokens vs uncached).
   */
  estimatedSavingsRatio: number;
  /**
   * Combined static system instruction text extracted from the request.
   */
  systemText: string;
}

const COMPLEX_REASONING_REGEX =
  /\b(architect(?:ure)?|refactor|optimiz(?:e|ation)|vulnerabilit(?:y|ies)|security\s+audit|prove|theorem|algorithm|concurren(?:t|cy)|deadlock|race\s+condition|distributed|microkernel|step[\s-]by[\s-]step|root\s+cause|stack\s+trace|benchmark|formal\s+verification)\b/i;

const CODE_OR_MATH_REGEX =
  /```[\s\S]*?```|\b(?:function|class|interface|SELECT\s+.+\s+FROM|CREATE\s+TABLE|async\s+function|Promise\.all|TypeError:|ReferenceError:|Error:\s+at\s+)\b|\$\$[\s\S]+?\$\$/i;

const SIMPLE_INTENT_REGEX =
  /^(?:hi|hello|hey|halo|ping|ok|okay|thanks|thank\s+you|terima\s+kasih|yes|no|ya|tidak|translate\s+to\s+\w+:|classify\s*:)/i;

/**
 * Recursively sorts object keys in deterministic lexicographical order
 * to guarantee byte-identical JSON serialization for KV-Cache prefix pinning.
 */
export function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter(
      (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype',
    )
    .sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJsonValue(record[key]);
  }
  return result;
}

/**
 * Extracts plain text from a ChatMessage array.
 */
function extractMessagesText(messages: ChatMessage[]): {
  totalText: string;
  lastUserText: string;
  systemText: string;
  nonSystemTurnCount: number;
} {
  const allParts: string[] = [];
  const systemParts: string[] = [];
  let lastUserText = '';
  let nonSystemTurnCount = 0;

  for (const msg of messages) {
    let msgText = '';
    if (typeof msg.content === 'string') {
      msgText = msg.content;
    } else if (Array.isArray(msg.content)) {
      msgText = msg.content
        .map((p) => (p.type === 'text' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    }

    if (msg.role === 'system') {
      if (msgText) systemParts.push(msgText);
    } else {
      nonSystemTurnCount++;
      if (msg.role === 'user' && msgText) {
        lastUserText = msgText;
      }
    }

    if (msgText) {
      allParts.push(msgText);
    }
  }

  return {
    totalText: allParts.join('\n'),
    lastUserText,
    systemText: systemParts.join('\n'),
    nonSystemTurnCount,
  };
}

/**
 * GeminiAgentBooster provides zero-dependency frontier optimizations for Gemini 4 Argon/Pro/Flash
 * and cross-provider KV-cache prefix pinning.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: ergonomic namespace-style utility class matching SDK conventions
export class GeminiAgentBooster {
  /**
   * Analyzes a UnifiedApiRequest and computes a complexity score [0..1],
   * thinking tier ('none' | 'low' | 'medium' | 'high'), and recommended thinkingBudget.
   */
  public static analyzeComplexity(
    request: Pick<UnifiedApiRequest, 'messages' | 'tools' | 'responseFormat'>,
  ): ThinkingComplexityAnalysis {
    const signals: string[] = [];
    let score = 0;

    const { totalText, lastUserText, nonSystemTurnCount } = extractMessagesText(
      request.messages || [],
    );
    const trimmedLastUser = lastUserText.trim();
    const totalChars = totalText.length;
    const toolCount = request.tools?.length ?? 0;

    // Fast-path trivial greeting / simple classification with no tools
    if (
      toolCount === 0 &&
      !request.responseFormat &&
      totalChars < 80 &&
      (totalChars === 0 || SIMPLE_INTENT_REGEX.test(trimmedLastUser)) &&
      !CODE_OR_MATH_REGEX.test(totalText) &&
      !COMPLEX_REASONING_REGEX.test(totalText)
    ) {
      signals.push('simple_intent_short_prompt');
      return {
        score: 0.05,
        tier: 'none',
        recommendedBudget: 0,
        signals,
      };
    }

    // 1. Prompt length contribution
    if (totalChars > 8000) {
      score += 0.35;
      signals.push('long_context_8k+');
    } else if (totalChars > 2000) {
      score += 0.25;
      signals.push('medium_context_2k+');
    } else if (totalChars > 300) {
      score += 0.15;
      signals.push('standard_context_300+');
    } else if (totalChars > 60) {
      score += 0.1;
      signals.push('concise_prompt');
    }

    // 2. Code blocks, stack traces, SQL, or LaTeX math
    if (CODE_OR_MATH_REGEX.test(totalText)) {
      score += 0.3;
      signals.push('code_or_math_detected');
    }

    // 3. Deep architectural / debugging / formal reasoning keywords
    if (COMPLEX_REASONING_REGEX.test(totalText)) {
      score += 0.3;
      signals.push('complex_reasoning_keywords');
    }

    // 4. Tool calling complexity
    if (toolCount >= 4) {
      score += 0.3;
      signals.push(`multi_tool_orchestration(${toolCount})`);
    } else if (toolCount >= 1) {
      score += 0.2;
      signals.push(`tool_calling(${toolCount})`);
    }

    // 5. Structured output schema enforcement
    if (request.responseFormat?.type === 'json_schema') {
      score += 0.15;
      signals.push('strict_json_schema');
    } else if (request.responseFormat?.type === 'json_object') {
      score += 0.1;
      signals.push('json_object_mode');
    }

    // 6. Multi-turn conversation depth
    if (nonSystemTurnCount >= 6) {
      score += 0.15;
      signals.push(`deep_conversation(${nonSystemTurnCount}_turns)`);
    }

    const clampedScore = Math.min(1, Number(score.toFixed(2)));

    if (clampedScore < 0.15) {
      return {
        score: clampedScore,
        tier: 'none',
        recommendedBudget: 0,
        signals,
      };
    }

    if (clampedScore < 0.45) {
      return {
        score: clampedScore,
        tier: 'low',
        recommendedBudget: 2048,
        signals,
      };
    }

    if (clampedScore < 0.75) {
      return {
        score: clampedScore,
        tier: 'medium',
        recommendedBudget: 8192,
        signals,
      };
    }

    return {
      score: clampedScore,
      tier: 'high',
      recommendedBudget: 32768,
      signals,
    };
  }

  /**
   * Computes a concrete numerical thinking token budget for `thinkingBudget: 'auto'`.
   */
  public static computeDynamicThinkingBudget(
    request: Pick<UnifiedApiRequest, 'messages' | 'tools' | 'responseFormat'>,
  ): number {
    return GeminiAgentBooster.analyzeComplexity(request).recommendedBudget;
  }

  /**
   * Deterministically sorts tool definitions by `function.name` and recursively
   * canonicalizes `function.parameters` keys so identical tool sets always produce
   * byte-identical JSON prefixes for KV-Cache reuse.
   */
  public static canonicalizeTools(tools: ToolDefinition[]): ToolDefinition[] {
    if (!Array.isArray(tools) || tools.length === 0) {
      return tools;
    }

    return [...tools]
      .sort((a, b) => a.function.name.localeCompare(b.function.name))
      .map((tool) => ({
        ...tool,
        function: {
          ...tool.function,
          parameters: tool.function.parameters
            ? (canonicalizeJsonValue(tool.function.parameters) as Record<
                string,
                unknown
              >)
            : tool.function.parameters,
        },
      }));
  }

  /**
   * Canonicalizes a UnifiedApiRequest for optimal KV-Cache hit rates and resolves
   * `thinkingBudget: 'auto'` if specified.
   *
   * - Pins all `system` messages to the leading prefix in their relative order.
   * - Sorts `tools` and their JSON schema keys deterministically.
   * - Resolves `thinkingBudget: 'auto'` into a concrete numerical token budget.
   */
  public static canonicalizeRequest(
    request: UnifiedApiRequest,
  ): UnifiedApiRequest {
    const systemMessages: ChatMessage[] = [];
    const conversationMessages: ChatMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    const canonicalMessages =
      systemMessages.length > 0
        ? [...systemMessages, ...conversationMessages]
        : request.messages;

    const canonicalTools = request.tools
      ? GeminiAgentBooster.canonicalizeTools(request.tools)
      : undefined;

    const resolvedThinkingBudget =
      request.thinkingBudget === 'auto'
        ? GeminiAgentBooster.computeDynamicThinkingBudget(request)
        : request.thinkingBudget;

    return {
      ...request,
      messages: canonicalMessages,
      tools: canonicalTools,
      thinkingBudget: resolvedThinkingBudget,
    };
  }

  /**
   * Evaluates whether a request's static prefix (system instructions + tool definitions)
   * meets the token threshold for Google Context Caching (default: 32,768 tokens).
   */
  public static evaluateContextCacheEligibility(
    request: Pick<UnifiedApiRequest, 'messages' | 'tools'>,
    minTokenThreshold = 32768,
  ): ContextCacheEligibility {
    const { systemText } = extractMessagesText(request.messages || []);
    const toolsJson =
      request.tools && request.tools.length > 0
        ? JSON.stringify(GeminiAgentBooster.canonicalizeTools(request.tools))
        : '';

    const totalStaticChars = systemText.length + toolsJson.length;
    const estimatedPrefixTokens = Math.ceil(totalStaticChars / 4);
    const eligible = estimatedPrefixTokens >= minTokenThreshold;

    return {
      eligible,
      estimatedPrefixTokens,
      thresholdTokens: minTokenThreshold,
      estimatedSavingsRatio: eligible ? 0.75 : 0,
      systemText,
    };
  }
}
