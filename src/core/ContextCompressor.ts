/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, TextContentPart } from '../types/index.js';

export interface ContextCompressionOptions {
  /**
   * Maximum allowed estimated tokens for the prompt messages.
   */
  maxPromptTokens: number;
  /**
   * Strategy when messages exceed maxPromptTokens:
   * - 'sliding-window': Drops oldest non-system conversation turns first.
   * - 'middle-out': Preserves system messages, the first user message, and the most recent turns.
   * Default: 'sliding-window'
   */
  strategy?: 'sliding-window' | 'middle-out';
  /**
   * Always preserve all 'system' role messages. Default: true
   */
  preserveSystemMessages?: boolean;
}

export interface CompressionResult {
  messages: ChatMessage[];
  originalTokens: number;
  compressedTokens: number;
  droppedCount: number;
}

/**
 * Fast, zero-dependency heuristic token estimator (~4 chars per token for Latin/code,
 * adjusted for whitespace and punctuation).
 */
export function estimateMessageTokens(msg: ChatMessage): number {
  let chars = 16; // Role & message framing overhead
  if (typeof msg.content === 'string') {
    chars += msg.content.length;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') {
        chars += (part as TextContentPart).text.length;
      } else {
        chars += 1024; // Heuristic token weight for image/audio content block
      }
    }
  }
  if (msg.reasoning_content) {
    chars += msg.reasoning_content.length;
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      chars += tc.function.name.length + tc.function.arguments.length + 24;
    }
  }
  return Math.ceil(chars / 4);
}

export function estimateTotalTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageTokens(m);
  }
  return total;
}

/**
 * Groups messages into atomic conversational units so that an assistant's `tool_calls`
 * message and its subsequent `role: 'tool'` responses are never split apart.
 */
function groupAtomicUnits(messages: ChatMessage[]): ChatMessage[][] {
  const units: ChatMessage[][] = [];
  let i = 0;
  while (i < messages.length) {
    const current = messages[i];
    if (
      current.role === 'assistant' &&
      current.tool_calls &&
      current.tool_calls.length > 0
    ) {
      const group: ChatMessage[] = [current];
      i++;
      while (i < messages.length && messages[i].role === 'tool') {
        group.push(messages[i]);
        i++;
      }
      units.push(group);
    } else {
      units.push([current]);
      i++;
    }
  }
  return units;
}

export class ContextCompressor {
  private options: Required<ContextCompressionOptions>;

  constructor(options: ContextCompressionOptions) {
    this.options = {
      maxPromptTokens: options.maxPromptTokens,
      strategy: options.strategy ?? 'sliding-window',
      preserveSystemMessages: options.preserveSystemMessages ?? true,
    };
  }

  public compress(messages: ChatMessage[]): CompressionResult {
    const originalTokens = estimateTotalTokens(messages);
    if (
      originalTokens <= this.options.maxPromptTokens ||
      messages.length <= 1
    ) {
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        droppedCount: 0,
      };
    }

    const systemMsgs: ChatMessage[] = [];
    const conversationMsgs: ChatMessage[] = [];

    for (const m of messages) {
      if (this.options.preserveSystemMessages && m.role === 'system') {
        systemMsgs.push(m);
      } else {
        conversationMsgs.push(m);
      }
    }

    const systemTokens = estimateTotalTokens(systemMsgs);
    const availableBudget = Math.max(
      0,
      this.options.maxPromptTokens - systemTokens,
    );

    const units = groupAtomicUnits(conversationMsgs);
    const unitTokens = units.map((u) => estimateTotalTokens(u));

    if (this.options.strategy === 'middle-out' && units.length > 2) {
      const firstUnit = units[0];
      const firstUnitCost = unitTokens[0];
      const keptTailUnits: ChatMessage[][] = [];
      let currentBudget = availableBudget - firstUnitCost;

      for (let idx = units.length - 1; idx >= 1; idx--) {
        if (currentBudget >= unitTokens[idx] || keptTailUnits.length === 0) {
          keptTailUnits.unshift(units[idx]);
          currentBudget -= unitTokens[idx];
        } else {
          break;
        }
      }

      const finalMessages = [
        ...systemMsgs,
        ...(firstUnitCost <= availableBudget ? firstUnit : []),
        ...keptTailUnits.flat(),
      ];
      return {
        messages: finalMessages,
        originalTokens,
        compressedTokens: estimateTotalTokens(finalMessages),
        droppedCount: messages.length - finalMessages.length,
      };
    }

    // Default: 'sliding-window' (keep newest atomic units from the end)
    const keptUnits: ChatMessage[][] = [];
    let usedTokens = 0;

    for (let idx = units.length - 1; idx >= 0; idx--) {
      const cost = unitTokens[idx];
      // Always keep at least the latest conversational turn
      if (usedTokens + cost <= availableBudget || keptUnits.length === 0) {
        keptUnits.unshift(units[idx]);
        usedTokens += cost;
      } else {
        break;
      }
    }

    const finalMessages = [...systemMsgs, ...keptUnits.flat()];
    return {
      messages: finalMessages,
      originalTokens,
      compressedTokens: estimateTotalTokens(finalMessages),
      droppedCount: messages.length - finalMessages.length,
    };
  }
}
