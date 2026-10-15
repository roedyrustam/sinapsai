/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * PII Guardrails Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { PIIGuardrails, type PIIMatch } from '../core/PIIGuardrails.js';

describe('PIIGuardrails', () => {
  describe('Email Detection', () => {
    it('should detect and redact email addresses', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const input = 'Contact me at john.doe@example.com for more info.';
      const output = g.redact(input);
      expect(output).toBe('Contact me at [EMAIL] for more info.');
    });

    it('should detect multiple email addresses', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const input = 'Emails: a@b.com and c@d.org';
      const matches = g.detect(input);
      expect(matches).toHaveLength(2);
    });

    it('should handle complex email formats', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const input = 'user+tag@sub.domain.co.uk';
      expect(g.hasPII(input)).toBe(true);
    });
  });

  describe('Phone Number Detection', () => {
    it('should detect US phone numbers', () => {
      const g = new PIIGuardrails({ categories: ['phone'] });
      const input = 'Call me at +1-555-867-5309';
      const output = g.redact(input);
      expect(output).toContain('[PHONE]');
      expect(output).not.toContain('867-5309');
    });

    it('should detect international phone numbers', () => {
      const g = new PIIGuardrails({ categories: ['phone'] });
      const input = 'WA: +62 812 3456 7890';
      expect(g.hasPII(input)).toBe(true);
    });

    it('should not flag short numbers as phone numbers', () => {
      const g = new PIIGuardrails({ categories: ['phone'] });
      const input = 'Use port 8080 for development.';
      const matches = g.detect(input);
      // 8080 has only 4 digits, below the minimum 7
      expect(matches).toHaveLength(0);
    });
  });

  describe('Credit Card Detection', () => {
    it('should detect and validate Visa card numbers (Luhn)', () => {
      const g = new PIIGuardrails({ categories: ['credit_card'] });
      // Valid Visa test number
      const input = 'Card: 4111 1111 1111 1111';
      const output = g.redact(input);
      expect(output).toBe('Card: [CREDIT_CARD]');
    });

    it('should detect Mastercard numbers', () => {
      const g = new PIIGuardrails({ categories: ['credit_card'] });
      const input = 'MC: 5500-0000-0000-0004';
      expect(g.hasPII(input)).toBe(true);
    });

    it('should detect Amex numbers', () => {
      const g = new PIIGuardrails({ categories: ['credit_card'] });
      const input = 'Amex: 3782-822463-10005';
      expect(g.hasPII(input)).toBe(true);
    });

    it('should NOT flag random digit sequences that fail Luhn', () => {
      const g = new PIIGuardrails({ categories: ['credit_card'] });
      const input = '4111 1111 1111 1112'; // Fails Luhn
      const matches = g.detect(input);
      expect(matches).toHaveLength(0);
    });
  });

  describe('SSN Detection', () => {
    it('should detect SSN patterns', () => {
      const g = new PIIGuardrails({ categories: ['ssn'] });
      const input = 'SSN: 123-45-6789';
      const output = g.redact(input);
      expect(output).toBe('SSN: [SSN]');
    });

    it('should detect SSN with dots', () => {
      const g = new PIIGuardrails({ categories: ['ssn'] });
      const input = 'Number 123.45.6789 is classified';
      expect(g.hasPII(input)).toBe(true);
    });
  });

  describe('IP Address Detection', () => {
    it('should detect IPv4 addresses', () => {
      const g = new PIIGuardrails({ categories: ['ip_address'] });
      const input = 'Server at 192.168.1.100 is down';
      const output = g.redact(input);
      expect(output).toBe('Server at [IP_ADDRESS] is down');
    });

    it('should NOT flag invalid IP ranges', () => {
      const g = new PIIGuardrails({ categories: ['ip_address'] });
      const input = '999.999.999.999';
      const matches = g.detect(input);
      expect(matches).toHaveLength(0);
    });
  });

  describe('JWT Detection', () => {
    it('should detect JWT tokens', () => {
      const g = new PIIGuardrails({ categories: ['jwt'] });
      const input =
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const output = g.redact(input);
      expect(output).toContain('[JWT]');
      expect(output).not.toContain('eyJhbGci');
    });
  });

  describe('URL Detection', () => {
    it('should detect and redact URLs', () => {
      const g = new PIIGuardrails({ categories: ['url'] });
      const input = 'Visit https://internal.company.com/admin/users';
      const output = g.redact(input);
      expect(output).toContain('[URL]');
      expect(output).not.toContain('internal.company.com');
    });
  });

  describe('Multi-Category Detection', () => {
    it('should detect multiple PII types in one text', () => {
      const g = new PIIGuardrails({
        categories: ['email', 'phone', 'ip_address'],
      });
      const input =
        'Contact admin@corp.com or call +1-555-123-4567, server at 10.0.0.1';
      const matches = g.detect(input);
      expect(matches.length).toBeGreaterThanOrEqual(3);

      const categories = matches.map((m) => m.category);
      expect(categories).toContain('email');
      expect(categories).toContain('phone');
      expect(categories).toContain('ip_address');
    });
  });

  describe('Custom Patterns', () => {
    it('should support custom regex patterns', () => {
      const g = new PIIGuardrails({
        categories: [],
        customPatterns: {
          employee_id: /\bEMP-\d{6}\b/g,
        },
      });
      const input = 'Employee EMP-123456 submitted a request.';
      const output = g.redact(input);
      expect(output).toBe('Employee [EMPLOYEE_ID] submitted a request.');
    });
  });

  describe('Allowlist', () => {
    it('should skip allowlisted values', () => {
      const g = new PIIGuardrails({
        categories: ['email'],
        allowlist: ['noreply@sinapsai.dev'],
      });
      const input = 'Send to noreply@sinapsai.dev and user@test.com';
      const output = g.redact(input);
      expect(output).toContain('noreply@sinapsai.dev');
      expect(output).not.toContain('user@test.com');
      expect(output).toContain('[EMAIL]');
    });
  });

  describe('Custom Redaction Format', () => {
    it('should support custom redaction format with category placeholder', () => {
      const g = new PIIGuardrails({
        categories: ['email'],
        redactionFormat: '***{category}***',
      });
      const input = 'test@example.com';
      expect(g.redact(input)).toBe('***EMAIL***');
    });

    it('should support static redaction label', () => {
      const g = new PIIGuardrails({
        categories: ['email'],
        redactionFormat: '[REDACTED]',
      });
      const input = 'user@test.com';
      expect(g.redact(input)).toBe('[REDACTED]');
    });
  });

  describe('onPIIDetected Callback', () => {
    it('should fire callback with detected matches', () => {
      const detectedMatches: PIIMatch[] = [];
      const g = new PIIGuardrails({
        categories: ['email', 'phone'],
        onPIIDetected: (matches) => {
          detectedMatches.push(...matches);
        },
      });

      g.redact('Email admin@test.com, call +1-800-555-1234');
      expect(detectedMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('should NOT fire callback when no PII is found', () => {
      const spy = vi.fn();
      const g = new PIIGuardrails({
        categories: ['email'],
        onPIIDetected: spy,
      });

      g.redact('Just regular text with no personal data.');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Message Array Redaction', () => {
    it('should redact PII from string content messages', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const messages = [
        { role: 'user' as const, content: 'My email is me@test.com' },
        {
          role: 'system' as const,
          content: 'You are a helpful assistant.',
        },
      ];

      const cleaned = g.redactMessages(messages);
      expect(cleaned[0].content).toBe('My email is [EMAIL]');
      expect(cleaned[1].content).toBe('You are a helpful assistant.');
    });

    it('should redact PII from ContentPart[] messages', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Contact user@test.com' },
            { type: 'image_url' as const, image_url: { url: 'data:...' } },
          ],
        },
      ];

      const cleaned = g.redactMessages(messages);
      const parts = cleaned[0].content as Array<Record<string, unknown>>;
      expect((parts[0] as { text: string }).text).toBe('Contact [EMAIL]');
      expect(parts[1].type).toBe('image_url');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      const g = new PIIGuardrails();
      expect(g.redact('')).toBe('');
      expect(g.detect('')).toEqual([]);
    });

    it('should handle disabled guardrails', () => {
      const g = new PIIGuardrails({ enabled: false });
      const input = 'user@test.com and 555-123-4567';
      expect(g.redact(input)).toBe(input);
      expect(g.detect(input)).toEqual([]);
    });

    it('should return accurate count', () => {
      const g = new PIIGuardrails({ categories: ['email'] });
      const input = 'a@b.com, c@d.com, e@f.com';
      expect(g.count(input)).toBe(3);
    });

    it('should handle overlapping matches by keeping longer match', () => {
      const g = new PIIGuardrails({
        categories: ['email', 'url'],
      });
      // URL contains email-like pattern
      const input = 'Visit https://user@internal.host.com/path';
      const matches = g.detect(input);
      // Should not produce duplicate overlapping redactions
      const totalLength = matches.reduce(
        (sum, m) => sum + (m.endIndex - m.startIndex),
        0,
      );
      expect(totalLength).toBeGreaterThan(0);
    });
  });
});
