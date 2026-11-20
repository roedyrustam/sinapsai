/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK v1 Specification Types
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  SinapsClient,
  SinapsClientOptions,
} from '../core/SinapsClient.js';
import type { ReasoningEffort, ThinkingLevel } from '../types/index.js';

export type LanguageModelV1FinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error'
  | 'other'
  | 'unknown';

export interface LanguageModelV1FunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: unknown;
}

export type LanguageModelV1ToolChoice =
  | { type: 'auto' }
  | { type: 'none' }
  | { type: 'required' }
  | { type: 'tool'; toolName: string };

export interface LanguageModelV1TextPart {
  type: 'text';
  text: string;
}

export interface LanguageModelV1ImagePart {
  type: 'image';
  image: Uint8Array | URL | string;
  mimeType?: string;
}

export interface LanguageModelV1ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface LanguageModelV1ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface LanguageModelV1SystemMessage {
  role: 'system';
  content: string;
}

export interface LanguageModelV1UserMessage {
  role: 'user';
  content: Array<LanguageModelV1TextPart | LanguageModelV1ImagePart>;
}

export interface LanguageModelV1AssistantMessage {
  role: 'assistant';
  content: Array<LanguageModelV1TextPart | LanguageModelV1ToolCallPart>;
}

export interface LanguageModelV1ToolMessage {
  role: 'tool';
  content: Array<LanguageModelV1ToolResultPart>;
}

export type LanguageModelV1Prompt = Array<
  | LanguageModelV1SystemMessage
  | LanguageModelV1UserMessage
  | LanguageModelV1AssistantMessage
  | LanguageModelV1ToolMessage
>;

export interface LanguageModelV1CallOptions {
  inputFormat: 'messages' | 'prompt';
  mode:
    | {
        type: 'regular';
        tools?: Array<LanguageModelV1FunctionTool>;
        toolChoice?: LanguageModelV1ToolChoice;
      }
    | {
        type: 'object-json';
        schema?: unknown;
        name?: string;
        description?: string;
      }
    | {
        type: 'object-tool';
        tool: LanguageModelV1FunctionTool;
      };
  prompt: LanguageModelV1Prompt;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
}

export type LanguageModelV1CallWarning =
  | {
      type: 'unsupported-setting';
      setting: string;
      details?: string;
    }
  | {
      type: 'other';
      message: string;
    };

export interface LanguageModelV1FunctionToolCall {
  toolCallType: 'function';
  toolCallId: string;
  toolName: string;
  args: string;
}

export interface LanguageModelV1Result {
  text?: string;
  toolCalls?: Array<LanguageModelV1FunctionToolCall>;
  finishReason: LanguageModelV1FinishReason;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  rawCall: {
    rawPrompt: unknown;
    rawSettings: Record<string, unknown>;
  };
  rawResponse?: {
    headers?: Record<string, string>;
  };
  warnings?: LanguageModelV1CallWarning[];
  logprobs?: unknown;
}

export type LanguageModelV1StreamPart =
  | {
      type: 'text-delta';
      textDelta: string;
    }
  | {
      type: 'reasoning';
      textDelta: string;
    }
  | {
      type: 'tool-call';
      toolCallType: 'function';
      toolCallId: string;
      toolName: string;
      args: string;
    }
  | {
      type: 'tool-call-delta';
      toolCallType: 'function';
      toolCallId: string;
      toolName: string;
      argsTextDelta: string;
    }
  | {
      type: 'finish';
      finishReason: LanguageModelV1FinishReason;
      usage: {
        promptTokens: number;
        completionTokens: number;
      };
      logprobs?: unknown;
    }
  | {
      type: 'error';
      error: unknown;
    };

export interface LanguageModelV1 {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode?: 'json' | 'tool';
  readonly supportsImageUrls?: boolean;

  doGenerate(
    options: LanguageModelV1CallOptions,
  ): Promise<LanguageModelV1Result>;

  doStream(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: {
      rawPrompt: unknown;
      rawSettings: Record<string, unknown>;
    };
    rawResponse?: {
      headers?: Record<string, string>;
    };
    warnings?: LanguageModelV1CallWarning[];
  }>;
}

export interface EmbeddingModelV1CallOptions {
  values: string[];
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
}

export interface EmbeddingModelV1Result {
  embeddings: Array<number[]>;
  usage?: {
    tokens: number;
  };
  rawResponse?: {
    headers?: Record<string, string>;
  };
}

export interface EmbeddingModelV1 {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly modelId: string;
  readonly maxEmbeddingsPerCall?: number;
  readonly supportsParallelCalls?: boolean;

  doEmbed(
    options: EmbeddingModelV1CallOptions,
  ): Promise<EmbeddingModelV1Result>;
}

export interface SinapsModelSettings {
  fallbackModels?: string[];
  thinkingBudget?: number | 'auto';
  thinkingLevel?: ThinkingLevel;
  includeThoughts?: boolean;
  reasoningEffort?: ReasoningEffort;
  cachedContent?: string;
  googleSearch?: boolean;
  webSearch?: boolean;
  codeExecution?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
  serviceTier?: 'auto' | 'default' | 'flex' | 'priority';
  promptCacheTtl?: '5m' | '1h';
  user?: string;
}

export interface SinapsEmbeddingSettings {
  dimensions?: number;
}

// ── Vercel AI SDK v5 (LanguageModelV2) Specification Types ─────────────────

export interface LanguageModelV2FunctionTool {
  type: 'function';
  name: string;
  description?: string;
  inputSchema: unknown;
}

export type LanguageModelV2ToolChoice = LanguageModelV1ToolChoice;

export interface LanguageModelV2TextPart {
  type: 'text';
  text: string;
}

export interface LanguageModelV2ReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface LanguageModelV2FilePart {
  type: 'file';
  filename?: string;
  data: Uint8Array | URL | string;
  mediaType: string;
}

export interface LanguageModelV2ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface LanguageModelV2ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output:
    | { type: 'text'; value: string }
    | { type: 'json'; value: unknown }
    | { type: 'error-text'; value: string }
    | { type: 'error-json'; value: unknown }
    | unknown;
}

export type LanguageModelV2Prompt = Array<
  | { role: 'system'; content: string }
  | {
      role: 'user';
      content: Array<LanguageModelV2TextPart | LanguageModelV2FilePart>;
    }
  | {
      role: 'assistant';
      content: Array<
        | LanguageModelV2TextPart
        | LanguageModelV2ReasoningPart
        | LanguageModelV2ToolCallPart
      >;
    }
  | {
      role: 'tool';
      content: Array<LanguageModelV2ToolResultPart>;
    }
>;

export interface LanguageModelV2CallOptions {
  prompt: LanguageModelV2Prompt;
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseFormat?:
    | { type: 'text' }
    | {
        type: 'json';
        schema?: unknown;
        name?: string;
        description?: string;
      };
  seed?: number;
  tools?: Array<LanguageModelV2FunctionTool>;
  toolChoice?: LanguageModelV2ToolChoice;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export type LanguageModelV2CallWarning = LanguageModelV1CallWarning;

export type LanguageModelV2Content =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: string;
    };

export interface LanguageModelV2Usage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface LanguageModelV2Result {
  content: Array<LanguageModelV2Content>;
  finishReason: LanguageModelV1FinishReason;
  usage: LanguageModelV2Usage;
  warnings: Array<LanguageModelV2CallWarning>;
  request?: { body?: unknown };
  response?: {
    id?: string;
    timestamp?: Date;
    modelId?: string;
    headers?: Record<string, string>;
  };
}

export type LanguageModelV2StreamPart =
  | { type: 'stream-start'; warnings: Array<LanguageModelV2CallWarning> }
  | {
      type: 'response-metadata';
      id?: string;
      timestamp?: Date;
      modelId?: string;
    }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; id: string; toolName: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'tool-input-end'; id: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: string;
    }
  | {
      type: 'finish';
      finishReason: LanguageModelV1FinishReason;
      usage: LanguageModelV2Usage;
    }
  | { type: 'error'; error: unknown };

export interface LanguageModelV2 {
  readonly specificationVersion: 'v2';
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls:
    | Promise<Record<string, RegExp[]>>
    | Record<string, RegExp[]>;

  doGenerate(
    options: LanguageModelV2CallOptions,
  ): Promise<LanguageModelV2Result>;

  doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    request?: { body?: unknown };
    response?: { headers?: Record<string, string> };
    warnings?: Array<LanguageModelV2CallWarning>;
  }>;
}

// ── Vercel AI SDK v6 (LanguageModelV3) Specification Types ─────────────────

export type LanguageModelV3Prompt = LanguageModelV2Prompt;
export type LanguageModelV3CallOptions = LanguageModelV2CallOptions;
export type LanguageModelV3CallWarning = LanguageModelV2CallWarning;
export type LanguageModelV3Content = LanguageModelV2Content;

export interface LanguageModelV3FinishReason {
  unified:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other';
  raw?: string;
}

export interface LanguageModelV3Usage {
  inputTokens: {
    total: number | undefined;
    noCache?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  outputTokens: {
    total: number | undefined;
    text?: number;
    reasoning?: number;
  };
}

export interface LanguageModelV3Result {
  content: Array<LanguageModelV3Content>;
  finishReason: LanguageModelV3FinishReason;
  usage: LanguageModelV3Usage;
  warnings: Array<LanguageModelV3CallWarning>;
  request?: { body?: unknown };
  response?: {
    id?: string;
    timestamp?: Date;
    modelId?: string;
    headers?: Record<string, string>;
  };
}

export type LanguageModelV3StreamPart =
  | Exclude<LanguageModelV2StreamPart, { type: 'finish' }>
  | {
      type: 'finish';
      finishReason: LanguageModelV3FinishReason;
      usage: LanguageModelV3Usage;
    };

export interface LanguageModelV3 {
  readonly specificationVersion: 'v3';
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls:
    | Promise<Record<string, RegExp[]>>
    | Record<string, RegExp[]>;

  doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3Result>;

  doStream(options: LanguageModelV3CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>;
    request?: { body?: unknown };
    response?: { headers?: Record<string, string> };
    warnings?: Array<LanguageModelV3CallWarning>;
  }>;
}

export interface SinapsAIProvider {
  (modelId: string, settings?: SinapsModelSettings): LanguageModelV1;
  languageModel(
    modelId: string,
    settings?: SinapsModelSettings,
  ): LanguageModelV1;
  languageModelV2(
    modelId: string,
    settings?: SinapsModelSettings,
  ): LanguageModelV2;
  languageModelV3(
    modelId: string,
    settings?: SinapsModelSettings,
  ): LanguageModelV3;
  chat(modelId: string, settings?: SinapsModelSettings): LanguageModelV1;
  textEmbeddingModel(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): EmbeddingModelV1;
  embedding(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): EmbeddingModelV1;
  readonly client: SinapsClient;
}

export type SinapsAIProviderInput = SinapsClient | SinapsClientOptions;
