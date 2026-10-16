/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Zero-Dependency PII Guardrails Engine
 *
 * In-process automatic redaction of Personally Identifiable Information (PII)
 * from outgoing LLM payloads before they leave the network boundary.
 * No external dependencies, no data leaves the process unprotected.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { UnifiedApiResponse } from '../types/index.js';

export type PIICategory =
  | 'email'
  | 'phone'
  | 'credit_card'
  | 'ssn'
  | 'ip_address'
  | 'iban'
  | 'passport'
  | 'date_of_birth'
  | 'url'
  | 'jwt';

export interface PIIMatch {
  category: PIICategory;
  original: string;
  redacted: string;
  startIndex: number;
  endIndex: number;
}

export interface PIITokenizeResult {
  text: string;
  vault: Map<string, string>;
}

export interface PIIGuardrailsOptions {
  /**
   * Categories of PII to detect and redact.
   * Default: ['email', 'phone', 'credit_card', 'ssn', 'ip_address']
   */
  categories?: PIICategory[];

  /**
   * Redaction format. Use '[REDACTED]' or a custom template.
   * Supports `{category}` placeholder.
   * Default: '[{category}]'
   */
  redactionFormat?: string;

  /**
   * Format for surrogate tokens when using reversible tokenization.
   * Supports `{category}` and `{index}` placeholders.
   * Default: '{{PII_{category}_{index}}}'
   */
  tokenFormat?: string;

  /**
   * If true, PII detection is enabled on outgoing requests.
   * Default: true
   */
  enabled?: boolean;

  /**
   * Callback triggered when PII is detected and redacted.
   */
  onPIIDetected?: (matches: PIIMatch[]) => void;

  /**
   * Custom regex patterns for domain-specific PII.
   * Key is the category name, value is the regex pattern.
   */
  customPatterns?: Record<string, RegExp>;

  /**
   * Allowlist of specific values that should NOT be redacted.
   * Useful for whitelisting known safe email addresses, IPs, etc.
   */
  allowlist?: string[];
}

/**
 * Compiled pattern definition with regex and category label.
 */
interface PatternEntry {
  category: PIICategory | string;
  regex: RegExp;
}

// === PATTERN LIBRARY ===
// All patterns use non-capturing groups and word boundaries where applicable.
// Designed for high precision with acceptable recall tradeoffs.

const PATTERNS: Record<PIICategory, RegExp> = {
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,

  phone:
    /(?:\+?\d{1,4}[\s\-.]?)?\(?\d{1,4}\)?[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}(?:[\s\-.]?\d{1,4})?\b/g,

  credit_card:
    /\b(?:(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[\s\-.]?\d{4}[\s\-.]?\d{4}[\s\-.]?\d{4}|3[47]\d{2}[\s\-.]?\d{6}[\s\-.]?\d{5})\b/g,

  ssn: /\b\d{3}[\s\-.]?\d{2}[\s\-.]?\d{4}\b/g,

  ip_address:
    /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\b/g,

  iban: /\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?(?:[A-Z0-9]{4}[\s]?){1,7}[A-Z0-9]{1,4}\b/g,

  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,

  date_of_birth:
    /\b(?:0[1-9]|[12]\d|3[01])[/\-.](?:0[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g,

  url: /https?:\/\/[^\s<>"')\]]+/g,

  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
};

const CATEGORY_PRIORITY: Record<string, number> = {
  jwt: 100,
  credit_card: 90,
  iban: 85,
  passport: 80,
  ssn: 75,
  ip_address: 70,
  email: 65,
  date_of_birth: 60,
  url: 50,
  phone: 40,
  custom: 30,
};

/**
 * Validates a credit card number using the Luhn algorithm.
 * Used to reduce false positives on numeric sequences.
 */
function isValidLuhn(digits: string): boolean {
  const cleaned = digits.replace(/[\s\-.]/g, '');
  if (cleaned.length < 13 || cleaned.length > 19) return false;

  let sum = 0;
  let alternate = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = Number.parseInt(cleaned[i], 10);
    if (Number.isNaN(n)) return false;

    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/**
 * Zero-dependency in-process PII guardrails engine.
 *
 * Scans text content for personally identifiable information using
 * high-precision regex patterns and automatically redacts matches
 * before the payload leaves the process boundary.
 *
 * @example
 * ```typescript
 * import { PIIGuardrails } from 'sinapsai';
 *
 * const guardrails = new PIIGuardrails({
 *   categories: ['email', 'phone', 'credit_card'],
 *   onPIIDetected: (matches) => console.warn(`PII detected: ${matches.length} items`),
 * });
 *
 * const sanitized = guardrails.redact('Contact me at user@example.com or 555-1234');
 * // => 'Contact me at [email] or [phone]'
 * ```
 */
export class PIIGuardrails {
  private patterns: PatternEntry[];
  private redactionFormat: string;
  private tokenFormat: string;
  private enabled: boolean;
  private onPIIDetected?: (matches: PIIMatch[]) => void;
  private allowlist: Set<string>;

  constructor(options?: PIIGuardrailsOptions) {
    const categories = options?.categories ?? [
      'email',
      'phone',
      'credit_card',
      'ssn',
      'ip_address',
    ];

    this.redactionFormat = options?.redactionFormat ?? '[{category}]';
    this.tokenFormat = options?.tokenFormat ?? '{{PII_{category}_{index}}}';
    this.enabled = options?.enabled ?? true;
    this.onPIIDetected = options?.onPIIDetected;
    this.allowlist = new Set(options?.allowlist ?? []);

    // Build compiled pattern list
    this.patterns = [];

    for (const cat of categories) {
      const pattern = PATTERNS[cat];
      if (pattern) {
        this.patterns.push({
          category: cat,
          regex: new RegExp(pattern.source, pattern.flags),
        });
      }
    }

    // Append custom patterns
    if (options?.customPatterns) {
      for (const [category, regex] of Object.entries(options.customPatterns)) {
        this.patterns.push({
          category,
          regex: new RegExp(regex.source, regex.flags || 'g'),
        });
      }
    }
  }

  /**
   * Detects all PII matches in the given text without modifying it.
   */
  detect(text: string): PIIMatch[] {
    if (!this.enabled || !text) return [];

    const matches: PIIMatch[] = [];

    for (const entry of this.patterns) {
      const regex = new RegExp(entry.regex.source, entry.regex.flags);
      let match = regex.exec(text);

      while (match !== null) {
        const original = match[0];
        const matchIndex = match.index;
        match = regex.exec(text);

        // Skip allowlisted values
        if (this.allowlist.has(original)) continue;

        // Credit card Luhn validation to reduce false positives
        if (entry.category === 'credit_card' && !isValidLuhn(original)) {
          continue;
        }

        // Phone number minimum digit count filter (avoid matching years, IDs)
        if (entry.category === 'phone') {
          const digitCount = original.replace(/\D/g, '').length;
          if (digitCount < 7 || digitCount > 15) continue;
        }

        const redacted = this.formatRedaction(entry.category as PIICategory);

        matches.push({
          category: entry.category as PIICategory,
          original,
          redacted,
          startIndex: matchIndex,
          endIndex: matchIndex + original.length,
        });
      }
    }

    // Sort matches: longer matches first; if same length, higher category priority wins
    matches.sort((a, b) => {
      const lenDiff = b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
      if (lenDiff !== 0) return lenDiff;
      const prioA = CATEGORY_PRIORITY[a.category] ?? 30;
      const prioB = CATEGORY_PRIORITY[b.category] ?? 30;
      return prioB - prioA;
    });

    // De-duplicate overlapping matches (keep longer / higher-priority match)
    const deduped: PIIMatch[] = [];
    for (const m of matches) {
      const overlaps = deduped.some(
        (existing) =>
          m.startIndex < existing.endIndex && m.endIndex > existing.startIndex,
      );
      if (!overlaps) {
        deduped.push(m);
      }
    }

    // Sort by position (descending) for safe string replacement from back to front
    deduped.sort((a, b) => b.startIndex - a.startIndex);

    return deduped;
  }

  /**
   * Redacts all detected PII from the given text and returns
   * the sanitized string.
   */
  redact(text: string): string {
    if (!this.enabled || !text) return text;

    const matches = this.detect(text);
    if (matches.length === 0) return text;

    if (this.onPIIDetected) {
      this.onPIIDetected(matches);
    }

    // Matches are pre-sorted descending by startIndex
    let result = text;
    for (const match of matches) {
      result =
        result.slice(0, match.startIndex) +
        match.redacted +
        result.slice(match.endIndex);
    }

    return result;
  }

  /**
   * Redacts PII from all string content within a ChatMessage array.
   * Handles both string content and ContentPart[] arrays.
   */
  redactMessages<T extends { content: unknown; name?: string }>(
    messages: T[],
  ): T[] {
    if (!this.enabled) return messages;

    return messages.map((msg) => {
      const cleaned = { ...msg };

      if (typeof cleaned.content === 'string') {
        cleaned.content = this.redact(cleaned.content) as T['content'];
      } else if (Array.isArray(cleaned.content)) {
        cleaned.content = cleaned.content.map(
          (part: Record<string, unknown>) => {
            if (part.type === 'text' && typeof part.text === 'string') {
              return { ...part, text: this.redact(part.text as string) };
            }
            return part;
          },
        ) as T['content'];
      }

      return cleaned;
    });
  }

  /**
   * Returns the total count of PII instances detected in text.
   */
  count(text: string): number {
    return this.detect(text).length;
  }

  /**
   * Returns true if any PII is detected in the given text.
   */
  hasPII(text: string): boolean {
    return this.detect(text).length > 0;
  }

  /**
   * Reversibly tokenizes all detected PII in text using unique surrogate tokens.
   * Returns the tokenized text and a key-value vault map of tokens to original values.
   */
  tokenize(text: string, existingVault?: Map<string, string>): PIITokenizeResult {
    const vault = existingVault || new Map<string, string>();
    if (!this.enabled || !text) return { text, vault };

    const matches = this.detect(text);
    if (matches.length === 0) return { text, vault };

    if (this.onPIIDetected) {
      this.onPIIDetected(matches);
    }

    // Matches are pre-sorted descending by startIndex
    // Build reverse map from original to existing token to reuse tokens for identical values
    const originalToToken = new Map<string, string>();
    for (const [token, orig] of vault.entries()) {
      originalToToken.set(orig, token);
    }

    let result = text;
    let nextIndex = vault.size + 1;

    for (const match of matches) {
      let token = originalToToken.get(match.original);
      if (!token) {
        token = this.tokenFormat
          .replace('{category}', match.category.toUpperCase())
          .replace('{index}', String(nextIndex++));
        vault.set(token, match.original);
        originalToToken.set(match.original, token);
      }

      result =
        result.slice(0, match.startIndex) +
        token +
        result.slice(match.endIndex);
    }

    return { text: result, vault };
  }

  /**
   * Restores original PII values into text that contains surrogate tokens
   * generated by `tokenize()`.
   */
  restore(
    text: string,
    vault: Map<string, string> | Record<string, string>,
  ): string {
    if (!text || !vault) return text;
    let restored = text;

    const entries =
      vault instanceof Map ? vault.entries() : Object.entries(vault);

    for (const [token, original] of entries) {
      if (restored.includes(token)) {
        restored = restored.replaceAll(token, original);
      }
    }

    return restored;
  }

  /**
   * Reversibly tokenizes an array of chat messages, collecting all PII into a single vault.
   */
  tokenizeMessages<T extends { content: unknown; name?: string }>(
    messages: T[],
    existingVault?: Map<string, string>,
  ): { messages: T[]; vault: Map<string, string> } {
    const vault = existingVault || new Map<string, string>();
    if (!this.enabled) return { messages, vault };

    const tokenizedMessages = messages.map((msg) => {
      const cleaned = { ...msg };

      if (typeof cleaned.content === 'string') {
        const res = this.tokenize(cleaned.content, vault);
        cleaned.content = res.text as T['content'];
      } else if (Array.isArray(cleaned.content)) {
        cleaned.content = cleaned.content.map(
          (part: Record<string, unknown>) => {
            if (part.type === 'text' && typeof part.text === 'string') {
              const res = this.tokenize(part.text as string, vault);
              return { ...part, text: res.text };
            }
            return part;
          },
        ) as T['content'];
      }

      return cleaned;
    });

    return { messages: tokenizedMessages, vault };
  }

  /**
   * Restores original PII values in a UnifiedApiResponse (content, reasoning, and tool call arguments).
   */
  restoreResponse(
    response: UnifiedApiResponse,
    vault: Map<string, string> | Record<string, string>,
  ): UnifiedApiResponse {
    if (!response || !vault) return response;

    const restoredChoices = response.choices.map((choice) => {
      const msg = { ...choice.message };
      if (typeof msg.content === 'string') {
        msg.content = this.restore(msg.content, vault);
      }
      if (typeof msg.reasoning_content === 'string') {
        msg.reasoning_content = this.restore(msg.reasoning_content, vault);
      }
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            arguments: this.restore(tc.function.arguments, vault),
          },
        }));
      }

      return {
        ...choice,
        message: msg,
      };
    });

    return {
      ...response,
      choices: restoredChoices,
    };
  }

  private formatRedaction(category: PIICategory | string): string {
    return this.redactionFormat.replace('{category}', category.toUpperCase());
  }
}
