export interface UnifiedApiRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface UnifiedApiStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    delta: {
      role?: 'assistant';
      content?: string;
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
      content: string;
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
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  costPer1kTokens?: number;
}

import type { Provider } from '../providers/Provider.js';

export interface SinapsEventHooks {
  onFallback?: (
    error: Error,
    fromProvider: Provider,
    toProvider: Provider,
  ) => void;
  onCircuitOpen?: (provider: Provider) => void;
  onCircuitClose?: (provider: Provider) => void;
  onRateLimit?: (provider: Provider, error: Error) => void;
}
