/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Finds and extracts the first balanced JSON substring matching openChar and closeChar,
 * properly respecting string literals and escape sequences.
 */
export function extractBalancedJson(
  text: string,
  openChar: '{' | '[',
  closeChar: '}' | ']',
): string | null {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  return null;
}

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

  // 3. Search for balanced JSON object { ... } or array [ ... ]
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');

  const checkObjectFirst =
    firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket);

  if (checkObjectFirst) {
    const balancedObj = extractBalancedJson(trimmed, '{', '}');
    if (balancedObj) {
      try {
        return JSON.parse(balancedObj) as T;
      } catch (_e) {}
    }
    if (firstBracket !== -1) {
      const balancedArr = extractBalancedJson(trimmed, '[', ']');
      if (balancedArr) {
        try {
          return JSON.parse(balancedArr) as T;
        } catch (_e) {}
      }
    }
  } else if (firstBracket !== -1) {
    const balancedArr = extractBalancedJson(trimmed, '[', ']');
    if (balancedArr) {
      try {
        return JSON.parse(balancedArr) as T;
      } catch (_e) {}
    }
    if (firstBrace !== -1) {
      const balancedObj = extractBalancedJson(trimmed, '{', '}');
      if (balancedObj) {
        try {
          return JSON.parse(balancedObj) as T;
        } catch (_e) {}
      }
    }
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
