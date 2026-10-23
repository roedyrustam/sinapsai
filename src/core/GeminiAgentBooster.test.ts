import { describe, expect, it } from 'vitest';
import { GeminiProvider } from '../providers/GeminiProvider.js';
import type { ToolDefinition, UnifiedApiRequest } from '../types/index.js';
import {
  canonicalizeJsonValue,
  GeminiAgentBooster,
} from './GeminiAgentBooster.js';

describe('GeminiAgentBooster & KV-Cache Prefix Optimizer', () => {
  describe('analyzeComplexity & computeDynamicThinkingBudget', () => {
    it('assigns tier "none" (0 tokens) for trivial greetings and simple prompts', () => {
      const analysis = GeminiAgentBooster.analyzeComplexity({
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      expect(analysis.tier).toBe('none');
      expect(analysis.recommendedBudget).toBe(0);
      expect(analysis.signals).toContain('simple_intent_short_prompt');
    });

    it('assigns tier "low" (2048 tokens) for standard queries or single tool call', () => {
      const analysis = GeminiAgentBooster.analyzeComplexity({
        messages: [
          {
            role: 'user',
            content:
              'Can you check the current weather in Jakarta and tell me what to wear today?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      });

      expect(analysis.tier).toBe('low');
      expect(analysis.recommendedBudget).toBe(2048);
    });

    it('assigns tier "medium" (8192 tokens) for code snippets with tool calling', () => {
      const analysis = GeminiAgentBooster.analyzeComplexity({
        messages: [
          {
            role: 'user',
            content:
              'Please review this function:\n```ts\nasync function fetchUser(id: string) { return db.query(id); }\n```\nand format the result as JSON.',
          },
        ],
        responseFormat: { type: 'json_object' },
      });

      expect(analysis.tier).toBe('medium');
      expect(analysis.recommendedBudget).toBe(8192);
      expect(analysis.signals).toContain('code_or_math_detected');
    });

    it('assigns tier "high" (32768 tokens) for deep architectural analysis, debugging, and multi-tool orchestration', () => {
      const tools: ToolDefinition[] = [1, 2, 3, 4].map((i) => ({
        type: 'function',
        function: {
          name: `tool_${i}`,
          parameters: { type: 'object' },
        },
      }));

      const analysis = GeminiAgentBooster.analyzeComplexity({
        messages: [
          {
            role: 'user',
            content:
              'Perform a full security audit and root cause analysis of this concurrency deadlock and race condition:\n```ts\nfunction lock() { throw new TypeError("deadlock"); }\n```',
          },
        ],
        tools,
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'AuditReport',
            schema: { type: 'object' },
          },
        },
      });

      expect(analysis.tier).toBe('high');
      expect(analysis.recommendedBudget).toBe(32768);
      expect(
        GeminiAgentBooster.computeDynamicThinkingBudget({
          messages: [
            {
              role: 'user',
              content:
                'Perform a full security audit and root cause analysis of this concurrency deadlock:\n```ts\nfunction lock() {}\n```',
            },
          ],
          tools,
        }),
      ).toBe(32768);
    });
  });

  describe('canonicalizeTools & canonicalizeJsonValue', () => {
    it('deterministically sorts tools by function.name and recursively sorts parameter keys', () => {
      const toolsA: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'zebra_search',
            description: 'Search zebra',
            parameters: {
              type: 'object',
              required: ['query'],
              properties: {
                zeta: { type: 'string' },
                alpha: { type: 'number' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'alpha_calc',
            description: 'Calculate alpha',
            parameters: {
              properties: {
                y: { type: 'number' },
                x: { type: 'number' },
              },
              type: 'object',
            },
          },
        },
      ];

      const toolsB: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'alpha_calc',
            description: 'Calculate alpha',
            parameters: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'zebra_search',
            description: 'Search zebra',
            parameters: {
              properties: {
                alpha: { type: 'number' },
                zeta: { type: 'string' },
              },
              required: ['query'],
              type: 'object',
            },
          },
        },
      ];

      const canonA = GeminiAgentBooster.canonicalizeTools(toolsA);
      const canonB = GeminiAgentBooster.canonicalizeTools(toolsB);

      expect(canonA.map((t) => t.function.name)).toEqual([
        'alpha_calc',
        'zebra_search',
      ]);
      expect(JSON.stringify(canonA)).toBe(JSON.stringify(canonB));
      expect(canonicalizeJsonValue({ b: 1, a: [2, { d: 4, c: 3 }] })).toEqual({
        a: [2, { c: 3, d: 4 }],
        b: 1,
      });
    });
  });

  describe('canonicalizeRequest & evaluateContextCacheEligibility', () => {
    it('pins system messages to the prefix and resolves thinkingBudget: "auto"', () => {
      const req: UnifiedApiRequest = {
        model: 'gemini-4-argon',
        messages: [
          { role: 'user', content: 'Hello there' },
          { role: 'system', content: 'You are a helpful architect.' },
        ],
        thinkingBudget: 'auto',
      };

      const canonical = GeminiAgentBooster.canonicalizeRequest(req);
      expect(canonical.messages[0].role).toBe('system');
      expect(canonical.messages[1].role).toBe('user');
      expect(typeof canonical.thinkingBudget).toBe('number');
    });

    it('detects context cache eligibility when static prefix exceeds threshold', () => {
      const shortRes = GeminiAgentBooster.evaluateContextCacheEligibility(
        {
          messages: [{ role: 'system', content: 'Short system prompt' }],
        },
        100,
      );
      expect(shortRes.eligible).toBe(false);
      expect(shortRes.estimatedSavingsRatio).toBe(0);

      const largeSystem = 'A'.repeat(2000);
      const eligibleRes = GeminiAgentBooster.evaluateContextCacheEligibility(
        {
          messages: [{ role: 'system', content: largeSystem }],
        },
        400,
      );
      expect(eligibleRes.eligible).toBe(true);
      expect(eligibleRes.estimatedPrefixTokens).toBeGreaterThanOrEqual(500);
      expect(eligibleRes.estimatedSavingsRatio).toBe(0.75);
    });
  });

  describe('GeminiProvider integration', () => {
    it('resolves thinkingBudget: "auto" and canonicalizes tools in GeminiProvider.formatRequest', () => {
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        thinkingBudget: 'auto',
      });

      const payload = provider.formatRequest({
        model: 'gemini-4-argon',
        messages: [
          {
            role: 'user',
            content:
              'Refactor this algorithm and prove deadlock freedom:\n```ts\nasync function run() {}\n```',
          },
        ],
        tools: [
          {
            type: 'function',
            function: { name: 'z_tool', parameters: { b: 1, a: 2 } },
          },
          {
            type: 'function',
            function: { name: 'a_tool', parameters: { d: 1, c: 2 } },
          },
        ],
      });

      expect(payload.generationConfig.thinkingConfig.thinkingBudget).toBe(
        32768,
      );
      expect(
        payload.tools[0].functionDeclarations.map(
          (f: { name: string }) => f.name,
        ),
      ).toEqual(['a_tool', 'z_tool']);
      expect(
        Object.keys(payload.tools[0].functionDeclarations[0].parameters),
      ).toEqual(['c', 'd']);
    });
  });
});
