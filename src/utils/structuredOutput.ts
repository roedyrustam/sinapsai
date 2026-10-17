/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Resiliently extracts and parses JSON data from LLM text responses.
 *
 * Handles:
 * - Direct JSON string (`{"foo": "bar"}` or `[1, 2, 3]`)
 * - Markdown code blocks (```json ... ``` or ``` ... ```)
 * - Conversational text surrounding the JSON payload
 *
 * @throws {SyntaxError} If no valid JSON structure can be found and parsed.
 */
export function extractJsonFromText<T = unknown>(text: string): T {
  if (!text || typeof text !== 'string') {
    throw new SyntaxError('Cannot extract JSON from empty or non-string input');
  }

  const trimmed = text.trim();

  // 1. Try direct parse first
  try {
    return JSON.parse(trimmed) as T;
  } catch (_e) {
    // Continue with markdown / pattern extraction
  }

  // 2. Extract from markdown code fences: ```json ... ``` or ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = trimmed.match(codeBlockRegex);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim()) as T;
    } catch (_e) {
      // Continue to bracket search
    }
  }

  // 3. Search for outermost JSON object { ... } or array [ ... ]
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');

  // Determine whether object or array appears first
  const hasObject =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace;
  const hasArray =
    firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket;

  if (hasObject && (!hasArray || firstBrace < firstBracket)) {
    try {
      const candidate = trimmed.substring(firstBrace, lastBrace + 1);
      return JSON.parse(candidate) as T;
    } catch (_e) {}
  } else if (hasArray) {
    try {
      const candidate = trimmed.substring(firstBracket, lastBracket + 1);
      return JSON.parse(candidate) as T;
    } catch (_e) {}
  }

  throw new SyntaxError(
    `Failed to extract valid JSON from response text: "${trimmed.slice(0, 100)}${trimmed.length > 100 ? '...' : ''}"`,
  );
}

/**
 * Validates whether an LLM response choice contains parsable JSON,
 * returning the parsed object or null if invalid.
 */
export function tryExtractJson<T = unknown>(text: string): T | null {
  try {
    return extractJsonFromText<T>(text);
  } catch {
    return null;
  }
}
