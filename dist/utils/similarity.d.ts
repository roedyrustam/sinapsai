/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ChatMessage } from '../types/index.js';
/**
 * Computes cosine similarity between two numeric vectors.
 * Returns a value between -1.0 and 1.0 (or 0 if dimensions mismatch or vector norm is zero).
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Normalizes chat messages into a canonical string representation for semantic embedding.
 */
export declare function extractPromptText(messages: ChatMessage[]): string;
//# sourceMappingURL=similarity.d.ts.map