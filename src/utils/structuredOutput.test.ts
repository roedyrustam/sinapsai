/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import {
  extractBalancedJson,
  extractJsonFromText,
  tryExtractJson,
} from './structuredOutput.js';

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

  it('correctly handles conversational text with braces in strings and trailing braces', () => {
    const input =
      'Sure! Here is the config: {"title": "Hello {world}", "items": [1, 2]}. Hope {this} helps!';
    const parsed = extractJsonFromText<{ title: string; items: number[] }>(
      input,
    );
    expect(parsed).toEqual({
      title: 'Hello {world}',
      items: [1, 2],
    });
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

describe('extractBalancedJson', () => {
  it('extracts balanced object with nested braces and escaped quotes', () => {
    const text = 'prefix {"a": {"b": "c \\"with } braces\\""}, "d": 1} suffix';
    const extracted = extractBalancedJson(text, '{', '}');
    expect(extracted).toBe('{"a": {"b": "c \\"with } braces\\""}, "d": 1}');
    expect(JSON.parse(extracted || '{}')).toEqual({
      a: { b: 'c "with } braces"' },
      d: 1,
    });
  });

  it('extracts balanced array with nested brackets', () => {
    const text = 'Items: [[1, 2], ["nested [bracket]"]] done';
    const extracted = extractBalancedJson(text, '[', ']');
    expect(extracted).toBe('[[1, 2], ["nested [bracket]"]]');
    expect(JSON.parse(extracted || '[]')).toEqual([
      [1, 2],
      ['nested [bracket]'],
    ]);
  });

  it('returns null if start character not found or unbalanced', () => {
    expect(extractBalancedJson('no brackets here', '{', '}')).toBeNull();
    expect(extractBalancedJson('unclosed { foo: 1', '{', '}')).toBeNull();
  });
});
