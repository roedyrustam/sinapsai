/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * FrontierModelRegistry Unit Tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  FRONTIER_AVAILABILITY_FALLBACKS,
  FRONTIER_MODELS,
  FrontierModelRegistry,
} from './FrontierModelRegistry.js';

describe('FrontierModelRegistry (Late-2026 Frontier Catalog)', () => {
  afterEach(() => {
    FrontierModelRegistry.clearCustomModels();
  });
  it('registers core 2026 frontier models across tiers and providers', () => {
    expect(FRONTIER_MODELS['gemini-4-carbon']?.tier).toBe('high-fast');
    expect(FRONTIER_MODELS['gemini-4-argon']?.contextWindow).toBe(2_097_152);
    expect(FRONTIER_MODELS['gemini-4-pro']?.tier).toBe('high');
    expect(
      FRONTIER_MODELS['claude-sonnet-5-5']?.capabilities.adaptiveThinking,
    ).toBe(true);
    expect(
      FRONTIER_MODELS['gpt-5.6-sol-medium']?.capabilities.responsesApi,
    ).toBe(true);
    expect(
      FRONTIER_MODELS['gpt-5.6-sol-medium']?.capabilities
        .usesMaxCompletionTokens,
    ).toBe(true);
    expect(FRONTIER_MODELS['grok-4-7-high-fast']?.capabilities.webSearch).toBe(
      true,
    );
    expect(FRONTIER_MODELS['deepseek-v4-pro']?.tier).toBe('high');
    expect(FRONTIER_MODELS['mistral-large-4']?.tier).toBe('high');
    expect(FRONTIER_MODELS['qwen3-max']?.tier).toBe('high');
    expect(FRONTIER_MODELS['qwq-plus']?.capabilities.reasoning).toBe(true);
    expect(FRONTIER_MODELS['qwen-vl-max']?.capabilities.vision).toBe(true);
    expect(FRONTIER_MODELS['kimi-k2-thinking']?.capabilities.reasoning).toBe(
      true,
    );
    expect(FRONTIER_MODELS['glm-4.5']?.tier).toBe('high');
  });

  it('resolves models by canonical ID and alias', () => {
    expect(FrontierModelRegistry.get('claude-sonnet-5-5')?.name).toBe(
      'Claude Sonnet 5.5',
    );
    expect(FrontierModelRegistry.get('claude-sonnet-5.5')?.id).toBe(
      'claude-sonnet-5-5',
    );
    expect(FrontierModelRegistry.get('claude-opus-5.5')?.id).toBe(
      'claude-opus-5-5',
    );
    expect(FrontierModelRegistry.get('non-existent-model')).toBeUndefined();
  });

  it('filters models by tier and provider', () => {
    const highFastModels = FrontierModelRegistry.getByTier('high-fast');
    expect(highFastModels.some((m) => m.id === 'gemini-4-carbon')).toBe(true);
    expect(highFastModels.some((m) => m.id === 'grok-4-7-high-fast')).toBe(
      true,
    );

    const anthropicModels = FrontierModelRegistry.getByProvider('anthropic');
    expect(anthropicModels.some((m) => m.id === 'claude-opus-4-7')).toBe(true);
    expect(anthropicModels.some((m) => m.id === 'claude-fable-5-1')).toBe(true);
  });

  it('enforces Availability Fallback Invariant across Gemini 4, Claude 5.5, Grok 4.7, and GPT-5.6', () => {
    expect(FRONTIER_AVAILABILITY_FALLBACKS['gemini-4-pro']).toEqual([
      'gemini-3.8-flash',
    ]);
    expect(FrontierModelRegistry.getFallbacks('gemini-4-carbon')).toEqual([
      'gemini-3.8-flash',
    ]);
    expect(FrontierModelRegistry.getFallbacks('claude-opus-5-5')).toEqual([
      'claude-opus-4-6',
    ]);
    expect(FrontierModelRegistry.getFallbacks('claude-sonnet-5-5')).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-6',
    ]);
    expect(FrontierModelRegistry.getFallbacks('grok-4-7-high-fast')).toEqual([
      'grok-4-6-high-fast',
      'grok-4.3',
    ]);
    expect(FrontierModelRegistry.getFallbacks('gpt-5.6-sol-medium')).toEqual([
      'gpt-5-mini',
    ]);
    expect(FrontierModelRegistry.getFallbacks('qwen3-max')).toEqual([
      'qwen3-plus',
      'qwen-2.5-max',
    ]);
    expect(FrontierModelRegistry.getFallbacks('qwq-plus')).toEqual([
      'qwq-32b',
      'qwen3-max',
    ]);
  });

  it('estimates USD cost accounting for cached prompt token discounts', () => {
    const uncachedCost = FrontierModelRegistry.estimateCost(
      'claude-sonnet-5-5',
      {
        promptTokens: 2000,
        completionTokens: 1000,
        cachedPromptTokens: 0,
      },
    );
    const cachedCost = FrontierModelRegistry.estimateCost('claude-sonnet-5-5', {
      promptTokens: 2000,
      completionTokens: 1000,
      cachedPromptTokens: 1500,
    });

    expect(uncachedCost).toBeCloseTo(0.021, 5);
    expect(cachedCost).toBeLessThan(uncachedCost);
  });

  it('identifies adaptive thinking and max_completion_tokens models accurately', () => {
    expect(
      FrontierModelRegistry.isAdaptiveThinkingModel('claude-sonnet-5-5'),
    ).toBe(true);
    expect(
      FrontierModelRegistry.isAdaptiveThinkingModel('claude-opus-4-7'),
    ).toBe(true);
    expect(
      FrontierModelRegistry.isAdaptiveThinkingModel(
        'claude-3-5-sonnet-20241022',
      ),
    ).toBe(false);

    expect(
      FrontierModelRegistry.usesMaxCompletionTokens('gpt-5.6-sol-medium'),
    ).toBe(true);
    expect(FrontierModelRegistry.usesMaxCompletionTokens('gpt-5-mini')).toBe(
      true,
    );
    expect(FrontierModelRegistry.usesMaxCompletionTokens('o3')).toBe(true);
    expect(FrontierModelRegistry.usesMaxCompletionTokens('gpt-4o')).toBe(false);
  });

  it('supports runtime registration of custom frontier profiles', () => {
    FrontierModelRegistry.register({
      id: 'custom-frontier-v1',
      name: 'Custom Frontier V1',
      provider: 'openai',
      tier: 'high',
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      promptCostPer1k: 0.001,
      completionCostPer1k: 0.004,
      fallbacks: ['gpt-5-mini'],
      capabilities: {
        tools: true,
        jsonSchema: true,
        reasoning: true,
        vision: true,
        audio: false,
        promptCaching: true,
        responsesApi: true,
        usesMaxCompletionTokens: true,
      },
    });

    const retrieved = FrontierModelRegistry.get('custom-frontier-v1');
    expect(retrieved?.name).toBe('Custom Frontier V1');
    expect(FrontierModelRegistry.getFallbacks('custom-frontier-v1')).toEqual([
      'gpt-5-mini',
    ]);
  });
});
