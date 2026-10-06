export interface ToolFunctionDefinition {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
}
export interface ToolDefinition {
    type: 'function';
    function: ToolFunctionDefinition;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface ToolCallChunk {
    index?: number;
    id?: string;
    type?: 'function';
    function?: {
        name?: string;
        arguments?: string;
    };
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    reasoning_content?: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}
export interface ResponseFormat {
    type: 'text' | 'json_object';
}
export interface UnifiedApiRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    signal?: AbortSignal;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'none' | 'required' | {
        type: 'function';
        function: {
            name: string;
        };
    };
    responseFormat?: ResponseFormat;
}
export interface CreateChatCompletionRequestNonStreaming extends Omit<UnifiedApiRequest, 'model' | 'stream'> {
    model?: string;
    stream?: false;
}
export interface CreateChatCompletionRequestStreaming extends Omit<UnifiedApiRequest, 'model' | 'stream'> {
    model?: string;
    stream: true;
}
export type CreateChatCompletionRequest = CreateChatCompletionRequestNonStreaming | CreateChatCompletionRequestStreaming;
export interface UnifiedApiStreamChunk {
    id: string;
    model: string;
    choices: Array<{
        delta: {
            role?: 'assistant';
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: ToolCallChunk[];
        };
        finishReason: string | null;
    }>;
}
export interface UnifiedApiResponse {
    id: string;
    model: string;
    choices: Array<{
        message: {
            role: 'assistant';
            content: string | null;
            reasoning_content?: string | null;
            tool_calls?: ToolCall[];
        };
        finishReason: string;
    }>;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
export interface ProviderConfig {
    id?: string;
    apiKey?: string;
    baseUrl?: string;
    timeoutMs?: number;
    costPer1kTokens?: number;
    defaultModel?: string;
    modelMap?: Record<string, string>;
    retries?: number;
    retryDelayMs?: number;
}
export interface CreateEmbeddingRequest {
    model: string;
    input: string | string[];
    user?: string;
    signal?: AbortSignal;
}
export interface EmbeddingItem {
    index: number;
    embedding: number[];
    object: 'embedding';
}
export interface CreateEmbeddingResponse {
    object: 'list';
    data: EmbeddingItem[];
    model: string;
    usage?: {
        promptTokens: number;
        totalTokens: number;
    };
}
import type { Provider } from '../providers/Provider.js';
export interface SinapsEventHooks {
    onSuccess?: (provider: Provider, response: UnifiedApiResponse, latencyMs: number) => void;
    onEmbeddingSuccess?: (provider: Provider, response: CreateEmbeddingResponse, latencyMs: number) => void;
    onFallback?: (error: Error, fromProvider: Provider, toProvider: Provider) => void;
    onCircuitOpen?: (provider: Provider) => void;
    onCircuitClose?: (provider: Provider) => void;
    onRateLimit?: (provider: Provider, error: Error) => void;
    onRetry?: (provider: Provider, error: Error, attempt: number, delayMs: number) => void;
}
//# sourceMappingURL=index.d.ts.map