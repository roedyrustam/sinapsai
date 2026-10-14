/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, TextContentPart } from '../types/index.js';

/**
 * Computes cosine similarity between two numeric vectors.
 * Returns a value between -1.0 and 1.0 (or 0 if dimensions mismatch or vector norm is zero).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return Math.min(1, Math.max(-1, dotProduct / denominator));
}

/**
 * Normalizes chat messages into a canonical string representation for semantic embedding.
 */
export function extractPromptText(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return '';
  }
  return messages
    .map((m) => {
      let contentStr = '';
      if (typeof m.content === 'string') {
        contentStr = m.content;
      } else if (Array.isArray(m.content)) {
        contentStr = m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as TextContentPart).text)
          .join(' ');
      }
      return `${m.role}: ${contentStr.trim()}`;
    })
    .join('\n');
}
