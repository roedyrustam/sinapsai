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
export declare function extractBalancedJson(text: string, openChar: '{' | '[', closeChar: '}' | ']'): string | null;
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
export declare function extractJsonFromText<T = unknown>(text: string): T;
/**
 * Validates whether an LLM response choice contains parsable JSON,
 * returning the parsed object or null if invalid.
 */
export declare function tryExtractJson<T = unknown>(text: string): T | null;
//# sourceMappingURL=structuredOutput.d.ts.map