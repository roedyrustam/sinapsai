/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * KV-Cache Prefix Pinning & Partitioning Optimizer
 *
 * Implements deterministic prompt partitioning and canonicalization to guarantee
 * byte-identical KV-cache prefix hits across subsequent turns and sessions.
 * Preserves 75%-90% prompt caching discounts on Anthropic, Gemini, OpenAI, and Groq
 * by isolating volatile timestamps and dynamic variables into the tail of the request.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type { ChatMessage, ToolDefinition } from '../types/index.js';

export interface KvPartitionOptions {
  /**
   * Minimum token length required for prompt caching eligibility (default: 1024)
   */
  minCacheTokens?: number;
  /**
   * Automatically detect and relocate ISO timestamps from system messages to the volatile tail
   * Default: true
   */
  relocateVolatileTimestamps?: boolean;
  /**
   * Canonicalize and lexicographically sort tools schema for deterministic byte identity
   * Default: true
   */
  canonicalizeTools?: boolean;
}

export interface PartitionedPrompt {
  /**
   * Reconstructed messages optimized for maximum byte-prefix cache hits
   */
  messages: ChatMessage[];
  /**
   * Lexicographically canonicalized tool definitions
   */
  tools?: ToolDefinition[];
  /**
   * Estimated token volume of the static byte-identical prefix
   */
  staticPrefixTokens: number;
  /**
   * Estimated token volume of stable session memory
   */
  stableMemoryTokens: number;
  /**
   * Estimated token volume of the dynamic volatile tail
   */
  volatileTailTokens: number;
  /**
   * Total estimated token volume
   */
  totalEstimatedTokens: number;
  /**
   * Whether the static prefix meets or exceeds provider cache thresholds
   */
  cacheEligible: boolean;
  /**
   * Deterministic 64-bit FNV-1a hex hash of the static byte prefix
   */
  prefixHash: string;
  /**
   * Extracted volatile runtime metadata relocated from prefix to tail
   */
  relocatedMetadata?: string[];
}

export interface CacheSavingsPrediction {
  /**
   * Predicted prompt cache hit rate (0.0 to 0.95)
   */
  predictedHitRate: number;
  /**
   * Estimated cached prompt tokens
   */
  estimatedCachedTokens: number;
  /**
   * Estimated un-cached / full-price tokens
   */
  estimatedUncachedTokens: number;
  /**
   * Estimated USD saved per request under standard provider pricing
   */
  estimatedSavingsUsd: number;
  /**
   * Cost discount percentage (e.g. 75.0 = 75% savings)
   */
  discountPercentage: number;
}

/**
 * 64-bit FNV-1a non-cryptographic fast hashing for byte prefix identification.
 */
function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return hex1 + hex2;
}

/**
 * Fast approximate token estimator (~4 chars per token).
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Recursively canonicalizes an object by sorting all its keys alphabetically.
 */
function canonicalizeObject<T>(val: T): T {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeObject) as unknown as T;
  }
  const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    result[k] = canonicalizeObject((val as Record<string, unknown>)[k]);
  }
  return result as T;
}

export class KvCacheOptimizer {
  private minCacheTokens: number;
  private knownPrefixHashes: Map<string, number> = new Map(); // hash -> hits count

  constructor(options: { minCacheTokens?: number } = {}) {
    this.minCacheTokens = Math.max(10, options.minCacheTokens ?? 1024);
  }

  /**
   * Partitions an incoming conversation turn into:
   * 1. Static Prefix: System rules, canonical tools, fixed system exemplars.
   * 2. Stable Memory: Episodic facts and session history.
   * 3. Volatile Tail: Latest user turn and relocated dynamic timestamps.
   */
  public partition(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options: KvPartitionOptions = {},
  ): PartitionedPrompt {
    if (!messages || messages.length === 0) {
      return {
        messages: [],
        staticPrefixTokens: 0,
        stableMemoryTokens: 0,
        volatileTailTokens: 0,
        totalEstimatedTokens: 0,
        cacheEligible: false,
        prefixHash: '0000000000000000',
      };
    }

    const minTokens = options.minCacheTokens ?? this.minCacheTokens;
    const shouldRelocate = options.relocateVolatileTimestamps !== false;
    const shouldCanonicalizeTools = options.canonicalizeTools !== false;

    // Step 1: Canonicalize Tools Schema
    let canonicalTools: ToolDefinition[] | undefined;
    if (tools && tools.length > 0) {
      canonicalTools = shouldCanonicalizeTools
        ? this.canonicalizeTools(tools)
        : [...tools];
    }

    // Step 2: Extract System Messages (Static Prefix Candidate)
    const systemMessages: ChatMessage[] = [];
    const conversationMessages: ChatMessage[] = [];
    const relocatedMetadata: string[] = [];

    // Timestamp regex for ISO timestamps, e.g. "Current time: 2026-11-11T16:32:25.000Z" or "Date: 2026-11-11"
    const timestampRegex =
      /(?:current\s*(?:time|date|timestamp)|date|today(?:\s*is)?):\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?)\.?/gi;

    for (const msg of messages) {
      if (msg.role === 'system') {
        let textContent =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);

        if (shouldRelocate && timestampRegex.test(textContent)) {
          // Reset regex
          timestampRegex.lastIndex = 0;
          let match = timestampRegex.exec(textContent);
          while (match !== null) {
            // Trim trailing period from relocated metadata item if present
            const cleanMeta = match[0].replace(/\.$/, '');
            relocatedMetadata.push(cleanMeta);
            match = timestampRegex.exec(textContent);
          }
          // Remove timestamp from static system prompt to preserve byte prefix identity
          textContent = textContent
            .replace(timestampRegex, '')
            .replace(/\s+\./g, '.')
            .replace(/\s+/g, ' ')
            .trim();
        }

        systemMessages.push({
          ...msg,
          content: textContent,
        });
      } else {
        conversationMessages.push(msg);
      }
    }

    // Step 3: Partition Conversation into Stable History vs Volatile Tail
    const stableHistory: ChatMessage[] = [];
    let volatileUserMessage: ChatMessage | null = null;

    if (conversationMessages.length > 0) {
      const lastMsg = conversationMessages[conversationMessages.length - 1];
      if (lastMsg.role === 'user') {
        volatileUserMessage = { ...lastMsg };
        stableHistory.push(...conversationMessages.slice(0, -1));
      } else {
        stableHistory.push(...conversationMessages);
      }
    }

    // Step 4: Re-inject relocated volatile metadata into volatile tail (last user message)
    if (volatileUserMessage && relocatedMetadata.length > 0) {
      const metadataPrefix = `[RUNTIME_CONTEXT]: ${relocatedMetadata.join(' | ')}\n\n`;
      if (typeof volatileUserMessage.content === 'string') {
        volatileUserMessage.content =
          metadataPrefix + volatileUserMessage.content;
      }
    }

    // Assemble final optimized messages array
    const optimizedMessages: ChatMessage[] = [
      ...systemMessages,
      ...stableHistory,
    ];
    if (volatileUserMessage) {
      optimizedMessages.push(volatileUserMessage);
    }

    // Step 5: Calculate Segment Token Volumes & Prefix Hash
    let staticPrefixText = systemMessages
      .map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      )
      .join('\n');

    if (canonicalTools && canonicalTools.length > 0) {
      staticPrefixText += `\n[TOOLS]:\n${JSON.stringify(canonicalTools)}`;
    }

    const staticPrefixTokens = estimateTokens(staticPrefixText);
    const stableMemoryText = stableHistory
      .map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      )
      .join('\n');
    const stableMemoryTokens = estimateTokens(stableMemoryText);

    const volatileTailText = volatileUserMessage
      ? typeof volatileUserMessage.content === 'string'
        ? volatileUserMessage.content
        : JSON.stringify(volatileUserMessage.content)
      : '';
    const volatileTailTokens = estimateTokens(volatileTailText);

    const totalEstimatedTokens =
      staticPrefixTokens + stableMemoryTokens + volatileTailTokens;
    const cacheEligible = staticPrefixTokens >= minTokens;
    const prefixHash = fnv1a64(staticPrefixText);

    return {
      messages: optimizedMessages,
      tools: canonicalTools,
      staticPrefixTokens,
      stableMemoryTokens,
      volatileTailTokens,
      totalEstimatedTokens,
      cacheEligible,
      prefixHash,
      relocatedMetadata:
        relocatedMetadata.length > 0 ? relocatedMetadata : undefined,
    };
  }

  /**
   * Sorts tools lexicographically and standardizes JSON Schema properties
   * to guarantee deterministic byte identity.
   */
  public canonicalizeTools(tools: ToolDefinition[]): ToolDefinition[] {
    if (!tools || tools.length === 0) return [];
    // Sort tools by function name
    const sortedTools = [...tools].sort((a, b) => {
      const nameA = a.function?.name ?? '';
      const nameB = b.function?.name ?? '';
      return nameA.localeCompare(nameB);
    });

    return sortedTools.map((t) => {
      return {
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
            ? canonicalizeObject(t.function.parameters)
            : undefined,
        },
      };
    });
  }

  /**
   * Predicts prompt cache hit rate and token savings for a partitioned prompt.
   */
  public predictCacheSavings(
    partitioned: PartitionedPrompt,
    provider?: Provider,
  ): CacheSavingsPrediction {
    if (!partitioned.cacheEligible) {
      return {
        predictedHitRate: 0.0,
        estimatedCachedTokens: 0,
        estimatedUncachedTokens: partitioned.totalEstimatedTokens,
        estimatedSavingsUsd: 0.0,
        discountPercentage: 0.0,
      };
    }

    // Check if this prefix has been seen before
    const seenCount = this.knownPrefixHashes.get(partitioned.prefixHash) ?? 0;
    const predictedHitRate = seenCount > 0 ? 0.95 : 0.8;
    const estimatedCachedTokens = Math.floor(
      partitioned.staticPrefixTokens * predictedHitRate,
    );
    const estimatedUncachedTokens =
      partitioned.totalEstimatedTokens - estimatedCachedTokens;

    // Pricing estimation: Prompt caching typically discounts cached tokens by 75% to 90%
    const promptRate =
      provider?.promptCostPer1k ?? provider?.costPer1kTokens ?? 0.003;
    const standardCost = (partitioned.totalEstimatedTokens / 1000) * promptRate;
    const discountedCost =
      (estimatedUncachedTokens / 1000) * promptRate +
      (estimatedCachedTokens / 1000) * (promptRate * 0.15); // 85% discount on cached tokens
    const estimatedSavingsUsd = Number(
      Math.max(0, standardCost - discountedCost).toFixed(6),
    );
    const discountPercentage =
      standardCost > 0
        ? Number(
            (((standardCost - discountedCost) / standardCost) * 100).toFixed(1),
          )
        : 0;

    return {
      predictedHitRate,
      estimatedCachedTokens,
      estimatedUncachedTokens,
      estimatedSavingsUsd,
      discountPercentage,
    };
  }

  /**
   * Records a prefix hash observation to refine future hit rate predictions.
   */
  public recordPrefixHit(prefixHash: string): void {
    const count = this.knownPrefixHashes.get(prefixHash) ?? 0;
    this.knownPrefixHashes.set(prefixHash, count + 1);
  }

  /**
   * Clears all known prefix hash records.
   */
  public clear(): void {
    this.knownPrefixHashes.clear();
  }
}
