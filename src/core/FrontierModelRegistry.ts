/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Unified Late-2026 Frontier Model Taxonomy, Pricing, Capabilities & Availability Fallbacks
 *
 * Implements the 4-Tier Frontier Execution Matrix:
 * - `high-fast`: Sub-100ms / sub-second TTFT, AST scans, triage, fast test loops
 * - `fast`: Diff-specialized / lightweight rapid mutation models
 * - `medium`: 2M+ monolithic context, balanced reasoning, strict JSON contracts
 * - `high`: Deep System-2 adaptive/extended thinking, flagship synthesis, spatial/multimodal
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ApiUsage, FrontierModelTier } from '../types/index.js';

export interface FrontierModelCapabilities {
  tools: boolean;
  jsonSchema: boolean;
  reasoning: boolean;
  adaptiveThinking?: boolean;
  thinkingLevel?: boolean;
  vision: boolean;
  audio: boolean;
  video?: boolean;
  promptCaching: boolean;
  liveApi?: boolean;
  responsesApi?: boolean;
  webSearch?: boolean;
  usesMaxCompletionTokens?: boolean;
}

export interface FrontierModelProfile {
  id: string;
  name: string;
  provider:
    | 'gemini'
    | 'anthropic'
    | 'openai'
    | 'xai'
    | 'deepseek'
    | 'mistral'
    | 'cohere'
    | 'groq'
    | 'cursor'
    | 'muse'
    | string;
  tier: FrontierModelTier;
  contextWindow: number;
  maxOutputTokens: number;
  /** USD per 1,000 input tokens */
  promptCostPer1k: number;
  /** USD per 1,000 output tokens */
  completionCostPer1k: number;
  /** Multiplier applied to cached input tokens (e.g. 0.1 = 90% discount, 0.25 = 75% discount) */
  cachedPromptDiscount?: number;
  fallbacks?: string[];
  capabilities: FrontierModelCapabilities;
  aliases?: string[];
}

export const FRONTIER_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  // Google Gemini 4 -> Gemini 3.8 Flash
  'gemini-4-carbon': ['gemini-3.8-flash'],
  'gemini-4-neon': ['gemini-3.8-flash'],
  'gemini-4-hydrogen': ['gemini-3.8-flash'],
  'gemini-4-argon': ['gemini-3.8-flash'],
  'gemini-4-pro': ['gemini-3.8-flash'],
  'gemini-4-flash': ['gemini-3.8-flash'],
  'gemini-3.1-pro': ['gemini-3.8-flash'],
  // Anthropic Claude 5.5 / 5.1 / 4.7 -> Claude 4.6 family
  'claude-opus-5-5': ['claude-opus-4-6'],
  'claude-opus-5.5': ['claude-opus-4-6'],
  'claude-opus-4-7': ['claude-opus-4-6'],
  'claude-sonnet-5-5': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-sonnet-5.5': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-fable-5-1': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-fable-5.1': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  // xAI Grok 4.7 -> Grok 4.6 High Fast / Grok 4.3
  'grok-4-7-high-fast': ['grok-4-6-high-fast', 'grok-4.3'],
  'grok-4.7': ['grok-4-6-high-fast', 'grok-4.3'],
  // OpenAI GPT-5.6 / 5.5 / 5.4 -> GPT-5 Mini
  'gpt-5.6-sol-medium': ['gpt-5-mini'],
  'gpt-5.5': ['gpt-5-mini'],
  'gpt-5.4': ['gpt-5-mini'],
  // DeepSeek V4 Pro -> DeepSeek Reasoner / V3.2
  'deepseek-v4-pro': ['deepseek-reasoner', 'deepseek-v3.2'],
  // Mistral Large 4 -> Mistral Small 4 / Large Latest
  'mistral-large-4': ['mistral-small-4', 'mistral-large-latest'],
};

export const FRONTIER_MODELS: Record<string, FrontierModelProfile> = {
  // ── Google DeepMind ──────────────────────────────────────────────────────
  'gemini-4-carbon': {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    provider: 'gemini',
    tier: 'high-fast',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.0001,
    completionCostPer1k: 0.0004,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-4-neon': {
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon Medium',
    provider: 'gemini',
    tier: 'medium',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.0004,
    completionCostPer1k: 0.0016,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-4-hydrogen': {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen Medium',
    provider: 'gemini',
    tier: 'medium',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.0003,
    completionCostPer1k: 0.0012,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon Medium',
    provider: 'gemini',
    tier: 'medium',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.0005,
    completionCostPer1k: 0.002,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      liveApi: true,
      webSearch: true,
    },
  },
  'gemini-4-pro': {
    id: 'gemini-4-pro',
    name: 'Gemini 4 Pro',
    provider: 'gemini',
    tier: 'high',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00125,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-4-flash': {
    id: 'gemini-4-flash',
    name: 'Gemini 4 Flash',
    provider: 'gemini',
    tier: 'high-fast',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      liveApi: true,
      webSearch: true,
    },
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'gemini',
    tier: 'high-fast',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      liveApi: true,
      webSearch: true,
    },
  },
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    provider: 'gemini',
    tier: 'high',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00125,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gemini-3.8-flash'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-3.1-flash-live-preview': {
    id: 'gemini-3.1-flash-live-preview',
    name: 'Gemini 3.1 Flash Live Preview',
    provider: 'gemini',
    tier: 'high-fast',
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0001,
    completionCostPer1k: 0.0004,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: false,
      liveApi: true,
    },
  },
  'gemini-3.8-live': {
    id: 'gemini-3.8-live',
    name: 'Gemini 3.8 Live',
    provider: 'gemini',
    tier: 'medium',
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.00015,
    completionCostPer1k: 0.0006,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      thinkingLevel: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: false,
      liveApi: true,
    },
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    tier: 'fast',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.000075,
    completionCostPer1k: 0.0003,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    tier: 'high',
    contextWindow: 2_097_152,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00125,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      video: true,
      promptCaching: true,
      webSearch: true,
    },
  },

  // ── Anthropic Claude ─────────────────────────────────────────────────────
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    tier: 'high',
    contextWindow: 500_000,
    maxOutputTokens: 64_000,
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
    cachedPromptDiscount: 0.1,
    fallbacks: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    aliases: ['claude-sonnet-5.5', 'claude-sonnet-5.5-20261022'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'anthropic',
    tier: 'medium',
    contextWindow: 500_000,
    maxOutputTokens: 64_000,
    promptCostPer1k: 0.005,
    completionCostPer1k: 0.025,
    cachedPromptDiscount: 0.1,
    fallbacks: ['claude-opus-4-6'],
    aliases: ['claude-opus-5.5'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-fable-5-1': {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    provider: 'anthropic',
    tier: 'high',
    contextWindow: 500_000,
    maxOutputTokens: 64_000,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.0125,
    cachedPromptDiscount: 0.055,
    fallbacks: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    aliases: ['claude-fable-5.1'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-opus-4-7': {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'anthropic',
    tier: 'high',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    promptCostPer1k: 0.005,
    completionCostPer1k: 0.025,
    cachedPromptDiscount: 0.1,
    fallbacks: ['claude-opus-4-6'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    tier: 'high',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-opus-4-6': {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    tier: 'medium',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    promptCostPer1k: 0.005,
    completionCostPer1k: 0.025,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      adaptiveThinking: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'high-fast',
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    promptCostPer1k: 0.001,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  'gpt-5.6-sol-medium': {
    id: 'gpt-5.6-sol-medium',
    name: 'GPT-5.6 Sol Medium',
    provider: 'openai',
    tier: 'medium',
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.008,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gpt-5-mini'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      promptCaching: true,
      responsesApi: true,
      webSearch: true,
      usesMaxCompletionTokens: true,
    },
  },
  'gpt-5.5': {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    tier: 'high',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.015,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gpt-5-mini'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      promptCaching: true,
      responsesApi: true,
      webSearch: true,
      usesMaxCompletionTokens: true,
    },
  },
  'gpt-5.4': {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    tier: 'high',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.015,
    cachedPromptDiscount: 0.1,
    fallbacks: ['gpt-5-mini'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      promptCaching: true,
      responsesApi: true,
      webSearch: true,
      usesMaxCompletionTokens: true,
    },
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'openai',
    tier: 'high-fast',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    promptCostPer1k: 0.00025,
    completionCostPer1k: 0.002,
    cachedPromptDiscount: 0.1,
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
  },
  'gpt-5-nano': {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'openai',
    tier: 'high-fast',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    promptCostPer1k: 0.00005,
    completionCostPer1k: 0.0004,
    cachedPromptDiscount: 0.1,
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
  },
  'o4-mini': {
    id: 'o4-mini',
    name: 'OpenAI o4-mini',
    provider: 'openai',
    tier: 'medium',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    promptCostPer1k: 0.0011,
    completionCostPer1k: 0.0044,
    cachedPromptDiscount: 0.25,
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
  },
  o3: {
    id: 'o3',
    name: 'OpenAI o3',
    provider: 'openai',
    tier: 'high',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.008,
    cachedPromptDiscount: 0.25,
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
  },
  'gpt-realtime': {
    id: 'gpt-realtime',
    name: 'GPT Realtime',
    provider: 'openai',
    tier: 'high-fast',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    promptCostPer1k: 0.004,
    completionCostPer1k: 0.016,
    cachedPromptDiscount: 0.5,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: true,
      audio: true,
      promptCaching: true,
      liveApi: true,
    },
  },

  // ── xAI Grok ─────────────────────────────────────────────────────────────
  'grok-4-7-high-fast': {
    id: 'grok-4-7-high-fast',
    name: 'Grok 4.7 High Fast',
    provider: 'xai',
    tier: 'high-fast',
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.001,
    completionCostPer1k: 0.003,
    cachedPromptDiscount: 0.25,
    fallbacks: ['grok-4-6-high-fast', 'grok-4.3'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
      webSearch: true,
    },
  },
  'grok-4-6-high-fast': {
    id: 'grok-4-6-high-fast',
    name: 'Grok 4.6 High Fast',
    provider: 'xai',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0005,
    completionCostPer1k: 0.0015,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
      webSearch: true,
    },
  },
  'grok-4.7': {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    provider: 'xai',
    tier: 'high',
    contextWindow: 500_000,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.006,
    cachedPromptDiscount: 0.25,
    fallbacks: ['grok-4-6-high-fast', 'grok-4.3'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: true,
      promptCaching: true,
      webSearch: true,
    },
  },
  'grok-4.3': {
    id: 'grok-4.3',
    name: 'Grok 4.3',
    provider: 'xai',
    tier: 'medium',
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.0015,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
      webSearch: true,
    },
  },
  'grok-4-mini': {
    id: 'grok-4-mini',
    name: 'Grok 4 Mini',
    provider: 'xai',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0003,
    completionCostPer1k: 0.0005,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
      webSearch: true,
    },
  },

  // ── DeepSeek ─────────────────────────────────────────────────────────────
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    tier: 'high',
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00055,
    completionCostPer1k: 0.00219,
    cachedPromptDiscount: 0.1,
    fallbacks: ['deepseek-reasoner', 'deepseek-v3.2'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },
  'deepseek-v4.1-flash': {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    provider: 'deepseek',
    tier: 'high-fast',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.00014,
    completionCostPer1k: 0.00055,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'deepseek-v3.2': {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    provider: 'deepseek',
    tier: 'medium',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    promptCostPer1k: 0.00027,
    completionCostPer1k: 0.0011,
    cachedPromptDiscount: 0.1,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (R1)',
    provider: 'deepseek',
    tier: 'high',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00055,
    completionCostPer1k: 0.00219,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },
  'deepseek-chat': {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    promptCostPer1k: 0.00027,
    completionCostPer1k: 0.0011,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },

  // ── Mistral AI ───────────────────────────────────────────────────────────
  'mistral-large-4': {
    id: 'mistral-large-4',
    name: 'Mistral Large 4',
    provider: 'mistral',
    tier: 'high',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.006,
    cachedPromptDiscount: 0.25,
    fallbacks: ['mistral-small-4', 'mistral-large-latest'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'mistral-small-4': {
    id: 'mistral-small-4',
    name: 'Mistral Small 4',
    provider: 'mistral',
    tier: 'high-fast',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0001,
    completionCostPer1k: 0.0003,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
  'magistral-medium-latest': {
    id: 'magistral-medium-latest',
    name: 'Magistral Medium',
    provider: 'mistral',
    tier: 'medium',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.005,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },
  'codestral-latest': {
    id: 'codestral-latest',
    name: 'Codestral',
    provider: 'mistral',
    tier: 'fast',
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0003,
    completionCostPer1k: 0.0009,
    cachedPromptDiscount: 0.25,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: false,
      audio: false,
      promptCaching: false,
    },
  },

  // ── Cohere ───────────────────────────────────────────────────────────────
  'command-a-03-2025': {
    id: 'command-a-03-2025',
    name: 'Cohere Command A',
    provider: 'cohere',
    tier: 'medium',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.01,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: false,
      audio: false,
      promptCaching: false,
    },
  },
  'command-a-reasoning-08-2025': {
    id: 'command-a-reasoning-08-2025',
    name: 'Cohere Command A Reasoning',
    provider: 'cohere',
    tier: 'high',
    contextWindow: 256_000,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: false,
    },
  },
  'command-a-vision-07-2025': {
    id: 'command-a-vision-07-2025',
    name: 'Cohere Command A Vision',
    provider: 'cohere',
    tier: 'medium',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.01,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: true,
      audio: false,
      promptCaching: false,
    },
  },

  // ── Groq LPU ─────────────────────────────────────────────────────────────
  'openai/gpt-oss-120b': {
    id: 'openai/gpt-oss-120b',
    name: 'OpenAI GPT-OSS 120B (Groq)',
    provider: 'groq',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    promptCostPer1k: 0.00015,
    completionCostPer1k: 0.0006,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: false,
    },
  },
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B (Groq)',
    provider: 'groq',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 131_072,
    promptCostPer1k: 0.0001,
    completionCostPer1k: 0.0003,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: false,
      audio: false,
      promptCaching: false,
    },
  },
  'meta-llama/llama-4-maverick-17b-128e-instruct': {
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick 17B 128E (Groq)',
    provider: 'groq',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    promptCostPer1k: 0.0002,
    completionCostPer1k: 0.0006,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: true,
      audio: false,
      promptCaching: false,
    },
  },
  'meta-llama/llama-4-scout-17b-16e-instruct': {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B 16E (Groq)',
    provider: 'groq',
    tier: 'high-fast',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    promptCostPer1k: 0.00011,
    completionCostPer1k: 0.00034,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: true,
      audio: false,
      promptCaching: false,
    },
  },

  // ── Specialized Frontier Tiers ───────────────────────────────────────────
  'composer-2.5-fast': {
    id: 'composer-2.5-fast',
    name: 'Composer 2.5 Fast',
    provider: 'cursor',
    tier: 'fast',
    contextWindow: 200_000,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.0004,
    completionCostPer1k: 0.0012,
    fallbacks: ['grok-4-6-high-fast'],
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: false,
      vision: false,
      audio: false,
      promptCaching: true,
    },
  },
  'muse-wonder-high': {
    id: 'muse-wonder-high',
    name: 'Muse Wonder High',
    provider: 'muse',
    tier: 'high',
    contextWindow: 300_000,
    maxOutputTokens: 32_768,
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.008,
    capabilities: {
      tools: true,
      jsonSchema: true,
      reasoning: true,
      vision: true,
      audio: false,
      promptCaching: true,
    },
  },
};

/**
 * Registry and lookup helper for late-2026 frontier AI models across providers and tiers.
 */
const customModels = new Map<string, FrontierModelProfile>();

/**
 * Registry and lookup helper for late-2026 frontier AI models across providers and tiers.
 */
export const FrontierModelRegistry = {
  /**
   * Registers or overrides a custom frontier model profile at runtime.
   */
  register(profile: FrontierModelProfile): void {
    customModels.set(profile.id, profile);
  },

  /**
   * Clears runtime-registered custom model profiles (primarily for isolated tests).
   */
  clearCustomModels(): void {
    customModels.clear();
  },

  /**
   * Retrieves a model profile by exact ID or registered alias.
   */
  get(modelId: string): FrontierModelProfile | undefined {
    const custom = customModels.get(modelId);
    if (custom) return custom;

    const direct = FRONTIER_MODELS[modelId];
    if (direct) return direct;

    for (const profile of customModels.values()) {
      if (profile.aliases?.includes(modelId)) {
        return profile;
      }
    }
    for (const profile of Object.values(FRONTIER_MODELS)) {
      if (profile.aliases?.includes(modelId)) {
        return profile;
      }
    }
    return undefined;
  },

  /**
   * Lists all built-in and custom registered frontier model profiles.
   */
  list(): FrontierModelProfile[] {
    const merged = new Map<string, FrontierModelProfile>(
      Object.entries(FRONTIER_MODELS),
    );
    for (const [id, profile] of customModels.entries()) {
      merged.set(id, profile);
    }
    return Array.from(merged.values());
  },

  /**
   * Filters frontier models by execution tier ('high-fast' | 'fast' | 'medium' | 'high').
   */
  getByTier(tier: FrontierModelTier): FrontierModelProfile[] {
    return FrontierModelRegistry.list().filter((m) => m.tier === tier);
  },

  /**
   * Filters frontier models by provider identifier (e.g. 'gemini', 'anthropic', 'openai', 'xai').
   */
  getByProvider(provider: string): FrontierModelProfile[] {
    const norm = provider.toLowerCase();
    return FrontierModelRegistry.list().filter(
      (m) => m.provider.toLowerCase() === norm,
    );
  },

  /**
   * Returns canonical availability fallback models for a given model ID.
   */
  getFallbacks(modelId: string): string[] {
    const profile = FrontierModelRegistry.get(modelId);
    if (profile?.fallbacks && profile.fallbacks.length > 0) {
      return [...profile.fallbacks];
    }
    const direct = FRONTIER_AVAILABILITY_FALLBACKS[modelId];
    return direct ? [...direct] : [];
  },

  /**
   * Estimates request USD cost using registered frontier pricing and cache read discounts.
   */
  estimateCost(
    modelId: string,
    usage: Pick<
      ApiUsage,
      'promptTokens' | 'completionTokens' | 'cachedPromptTokens'
    >,
  ): number {
    const profile = FrontierModelRegistry.get(modelId);
    if (!profile) return 0;

    const cached = Math.min(usage.promptTokens, usage.cachedPromptTokens ?? 0);
    const uncached = Math.max(0, usage.promptTokens - cached);
    const cacheMultiplier = profile.cachedPromptDiscount ?? 0.25;

    const promptCost =
      ((uncached + cached * cacheMultiplier) / 1000) * profile.promptCostPer1k;
    const completionCost =
      (usage.completionTokens / 1000) * profile.completionCostPer1k;

    return Number((promptCost + completionCost).toFixed(6));
  },

  /**
   * Checks whether a model supports Anthropic-style adaptive thinking (`thinking: { type: 'adaptive' }`).
   */
  isAdaptiveThinkingModel(modelId: string): boolean {
    const profile = FrontierModelRegistry.get(modelId);
    if (profile?.capabilities.adaptiveThinking) return true;
    const lower = modelId.toLowerCase();
    return (
      lower.includes('claude-opus-4-7') ||
      lower.includes('claude-opus-4.7') ||
      lower.includes('claude-sonnet-4-6') ||
      lower.includes('claude-sonnet-4.6') ||
      lower.includes('claude-opus-5') ||
      lower.includes('claude-sonnet-5') ||
      lower.includes('claude-fable-5')
    );
  },

  /**
   * Checks whether an OpenAI model requires `max_completion_tokens` instead of `max_tokens`.
   */
  usesMaxCompletionTokens(modelId: string): boolean {
    const profile = FrontierModelRegistry.get(modelId);
    if (profile?.capabilities.usesMaxCompletionTokens) return true;
    const lower = modelId.toLowerCase();
    return (
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.startsWith('o4') ||
      lower.startsWith('gpt-5') ||
      lower.startsWith('gpt-6') ||
      lower.includes('reasoner')
    );
  },
};
