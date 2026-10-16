/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { extractJsonFromText, tryExtractJson } from './structuredOutput.js';

describe('structuredOutput', () => {
  it('extracts direct raw JSON object', () => {
    const raw = '{"name": "SinapsAI", "version": "2.2.0"}';
    const parsed = extractJsonFromText<{ name: string; version: string }>(raw);
    expect(parsed).toEqual({ name: 'SinapsAI', version: '2.2.0' });
  });

  it('extracts direct raw JSON array', () => {
    const raw = '[1, 2, 3, "apple"]';
    const parsed = extractJsonFromText<unknown[]>(raw);
    expect(parsed).toEqual([1, 2, 3, 'apple']);
  });

  it('extracts JSON enclosed within markdown ```json code block', () => {
    const input = `Here is your data:
\`\`\`json
{
  "status": "success",
  "data": {
    "count": 42
  }
}
\`\`\`
Let me know if you need more help!`;

    const parsed = extractJsonFromText<{
      status: string;
      data: { count: number };
    }>(input);
    expect(parsed).toEqual({
      status: 'success',
      data: { count: 42 },
    });
  });

  it('extracts JSON without markdown fences from conversational text', () => {
    const input =
      'Based on your inquiry, the answer is: {"valid": true, "code": 200}. Thank you.';
    const parsed = extractJsonFromText<{ valid: boolean; code: number }>(input);
    expect(parsed).toEqual({ valid: true, code: 200 });
  });

  it('tryExtractJson returns null on invalid text instead of throwing', () => {
    expect(tryExtractJson('just random plain text')).toBeNull();
    expect(tryExtractJson('')).toBeNull();
  });

  it('throws SyntaxError when input contains no parseable JSON', () => {
    expect(() => extractJsonFromText('Hello, this is just plain text')).toThrow(
      SyntaxError,
    );
  });
});
