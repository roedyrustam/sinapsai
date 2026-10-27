/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Unit Tests for Universal LLM Optimization Engine (LLMO)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { OpenAiProvider } from '../providers/OpenAiProvider.js';
import type {
  ChatMessage,
  ToolDefinition,
  UnifiedApiRequest,
  UnifiedApiResponse,
} from '../types/index.js';
import {
  canonicalizeTools,
  deduplicateSystemInstructions,
  estimateTextTokens,
  estimateTotalTokens,
  LlmOptimizer,
  minifyProsePreservingCode,
} from './LlmOptimizer.js';
import { SinapsClient } from './SinapsClient.js';

describe('LlmOptimizer (LLMO)', () => {
  describe('minifyProsePreservingCode', () => {
    it('minifies redundant prose whitespace while strictly preserving code blocks', () => {
      const input = `
Here is a query:    with too    many spaces.



And 4 newlines above.

\`\`\`typescript
function calculate(x: number) {
    // Indentation must be preserved
    if (x > 0) {
        return x * 2;
    }
    return 0;
}
\`\`\`

Another    line    with   spaces.
`;

      const minified = minifyProsePreservingCode(input, 'lossless');

      // Prose is cleaned up
      expect(minified).toContain('Here is a query: with too many spaces.');
      expect(minified).not.toContain('\n\n\n');
      expect(minified).toContain('Another line with spaces.');

      // Code block indentation is 100% preserved
      expect(minified).toContain(
        'function calculate(x: number) {\n    // Indentation must be preserved',
      );
      expect(minified).toContain(
        '    if (x > 0) {\n        return x * 2;\n    }',
      );
    });

    it('strips polite conversational fluff in aggressive mode', () => {
      const input = 'Could you please help me to summarize this document?';
      const minified = minifyProsePreservingCode(input, 'aggressive');
      expect(minified).toBe('summarize this document?');

      const input2 = 'Please kindly provide the algorithm';
      const minified2 = minifyProsePreservingCode(input2, 'aggressive');
      expect(minified2).toBe('provide the algorithm');
    });

    it('handles empty or blank strings safely', () => {
      expect(minifyProsePreservingCode('', 'lossless')).toBe('');
      expect(minifyProsePreservingCode('   ', 'lossless')).toBe('');
    });
  });

  describe('deduplicateSystemInstructions', () => {
    it('leaves single system message unmodified', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];
      const result = deduplicateSystemInstructions(messages);
      expect(result).toEqual(messages);
    });

    it('merges and deduplicates multiple system messages and duplicate lines', () => {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are a TypeScript assistant.\nAlways return JSON.',
        },
        { role: 'user', content: 'Hi' },
        {
          role: 'system',
          content: 'Always return JSON.\nNever use any external deps.',
        },
      ];
      const result = deduplicateSystemInstructions(messages);
      expect(result.length).toBe(2);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe(
        'You are a TypeScript assistant.\nAlways return JSON.\nNever use any external deps.',
      );
      expect(result[1].role).toBe('user');
    });
  });

  describe('canonicalizeTools', () => {
    it('sorts tools alphabetically and recursively sorts parameters for deterministic KV-cache prefix hits', () => {
      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'zeta_tool',
            description: 'Zeta tool',
            parameters: {
              z_param: 'value',
              a_param: 123,
              b_param: {
                nested_z: true,
                nested_a: 'test',
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'alpha_tool',
            description: 'Alpha tool',
          },
        },
      ];

      const canonical = canonicalizeTools(tools);
      expect(canonical).toBeDefined();
      expect(canonical?.[0].function.name).toBe('alpha_tool');
      expect(canonical?.[1].function.name).toBe('zeta_tool');

      // Parameters key ordering
      const params = canonical?.[1].function.parameters as Record<
        string,
        unknown
      >;
      expect(Object.keys(params)).toEqual(['a_param', 'b_param', 'z_param']);
      const nested = params.b_param as Record<string, unknown>;
      expect(Object.keys(nested)).toEqual(['nested_a', 'nested_z']);
    });
  });

  describe('analyzeComplexity', () => {
    const optimizer = new LlmOptimizer();

    it('classifies simple greetings as Tier 1 (Light/Fast)', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello!' }];
      const analysis = optimizer.analyzeComplexity(messages);
      expect(analysis.tier).toBe('tier1');
      expect(analysis.score).toBeLessThanOrEqual(0.35);
      expect(analysis.recommendedThinkingBudget).toBe(0);
      expect(analysis.recommendedModel).toBe('gemini-2.5-flash-lite');
      expect(analysis.signals).toContain('simple_intent');
    });

    it('classifies complex algorithmic requests as Tier 3 (Deep Reasoning)', () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: `Please architect a zero-dependency distributed algorithm to solve deadlock and race conditions in concurrent raft consensus:
\`\`\`typescript
function verifyDeadlock() { ... }
\`\`\`
Perform a security audit, root cause analysis, and formal verification step-by-step.`,
        },
      ];
      const analysis = optimizer.analyzeComplexity(messages);
      expect(analysis.tier).toBe('tier3');
      expect(analysis.score).toBeGreaterThan(0.7);
      expect(analysis.recommendedThinkingBudget).toBe(8192);
      expect(analysis.recommendedModel).toBe('gemini-2.5-pro');
      expect(analysis.signals).toContain('code_or_math_blocks');
      expect(analysis.signals).toContain('complex_reasoning_keywords');
    });
  });

  describe('optimize and Metrics Tracking', () => {
    it('executes full pipeline, minifies prompt, and records FinOps metrics', () => {
      const optimizer = new LlmOptimizer({
        enabled: true,
        minifyPrompts: true,
        deduplicateSystem: true,
        alignKvCachePrefix: true,
        autoCascadeModel: true,
      });

      const request = {
        model: 'auto',
        messages: [
          {
            role: 'system' as const,
            content: 'You are an AI assistant.   \n\n\n\nFollow instructions.',
          },
          {
            role: 'user' as const,
            content: '   Hi   there!    How are you?   ',
          },
        ],
        tools: [
          {
            type: 'function' as const,
            function: { name: 'get_time' },
          },
        ],
      };

      const result = optimizer.optimize(request);
      expect(result.optimizedTokens).toBeLessThanOrEqual(result.originalTokens);
      expect(result.cascadeModel).toBe('gemini-2.5-flash-lite'); // Tier 1 cascade for greeting
      expect(result.messages[0].content).toBe(
        'You are an AI assistant.\n\nFollow instructions.',
      );
      expect(result.messages[1].content).toBe('Hi there! How are you?');

      const metrics = optimizer.getMetrics();
      expect(metrics.totalOptimizedRequests).toBe(1);
      expect(metrics.cascadedRequestsCount).toBe(1);
      expect(metrics.totalEstimatedUsdSaved).toBeGreaterThanOrEqual(0);

      optimizer.resetMetrics();
      expect(optimizer.getMetrics().totalOptimizedRequests).toBe(0);
    });
  });

  describe('SinapsClient LLMO Integration', () => {
    it('automatically minifies prompts, cascades models, and exports llmoMetrics', async () => {
      const provider = new OpenAiProvider({ apiKey: 'test-key' });
      let capturedRequest: UnifiedApiRequest | undefined;
      provider.generateContent = async (req) => {
        capturedRequest = req;
        const res: UnifiedApiResponse = {
          id: 'test-resp',
          model: req.model,
          choices: [
            {
              message: { role: 'assistant', content: 'Optimized response' },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
        return res;
      };

      const client = new SinapsClient({
        providers: [provider],
        llmo: {
          enabled: true,
          minifyPrompts: true,
          autoCascadeModel: true,
          cascadeTiers: {
            tier1: 'gpt-4o-mini',
            tier2: 'gpt-4o',
            tier3: 'o3-mini',
          },
        },
      });

      const response = await client.chat.completions.create({
        model: 'auto',
        messages: [
          {
            role: 'user',
            content: '   hello    world!    ',
          },
        ],
      });

      expect('choices' in response).toBe(true);
      // Verify prompt was minified
      expect(capturedRequest.messages[0].content).toBe('hello world!');
      // Verify auto-cascaded to tier1 model (gpt-4o-mini)
      expect(capturedRequest.model).toBe('gpt-4o-mini');

      // Verify metrics
      const metrics = client.getMetrics();
      expect(metrics.llmoMetrics).toBeDefined();
      expect(metrics.llmoMetrics?.totalOptimizedRequests).toBe(1);
      expect(metrics.llmoMetrics?.cascadedRequestsCount).toBe(1);

      // Verify direct client.optimizePrompt helper
      const directOpt = client.optimizePrompt({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: '  ping   ' }],
      });
      expect(directOpt.messages[0].content).toBe('ping');

      // Verify token estimation helpers
      expect(estimateTextTokens('Hello world')).toBeGreaterThan(0);
      expect(
        estimateTotalTokens([{ role: 'user', content: 'Test prompt' }]),
      ).toBeGreaterThan(0);
    });
  });
});
