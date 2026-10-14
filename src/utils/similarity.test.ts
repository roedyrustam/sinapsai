/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/index.js';
import { cosineSimilarity, extractPromptText } from './similarity.js';

describe('similarity utilities', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it('should return 1 for collinear positive vectors', () => {
      const a = [1, 2, 3];
      const b = [2, 4, 6];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('should return 0 when vectors have different lengths', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('should return 0 for zero or empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
      expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
    });
  });

  describe('extractPromptText', () => {
    it('should extract text from string messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'What is Paris?' },
      ];
      expect(extractPromptText(messages)).toBe(
        'system: You are helpful\nuser: What is Paris?',
      );
    });

    it('should extract text from ContentPart[] messages', () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,...' },
            },
          ],
        },
      ];
      expect(extractPromptText(messages)).toBe('user: Describe this');
    });

    it('should return empty string for empty messages', () => {
      expect(extractPromptText([])).toBe('');
    });
  });
});
