/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK v1 Specification Types
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { SinapsClient, SinapsClientOptions } from '../core/SinapsClient.js';

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

  doGenerate(options: LanguageModelV1CallOptions): Promise<LanguageModelV1Result>;

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

  doEmbed(options: EmbeddingModelV1CallOptions): Promise<EmbeddingModelV1Result>;
}

export interface SinapsModelSettings {
  fallbackModels?: string[];
  thinkingBudget?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface SinapsEmbeddingSettings {
  dimensions?: number;
}

export interface SinapsAIProvider {
  (modelId: string, settings?: SinapsModelSettings): LanguageModelV1;
  languageModel(modelId: string, settings?: SinapsModelSettings): LanguageModelV1;
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
