/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Integration & Provider Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { SinapsClient } from '../core/SinapsClient.js';
import { SinapsEmbeddingModel } from './SinapsEmbeddingModel.js';
import { SinapsLanguageModel } from './SinapsLanguageModel.js';
import type {
  SinapsAIProvider,
  SinapsAIProviderInput,
  SinapsEmbeddingSettings,
  SinapsModelSettings,
} from './types.js';

export * from './promptConverter.js';
export * from './SinapsEmbeddingModel.js';
export * from './SinapsLanguageModel.js';
export * from './types.js';

/**
 * Creates a Vercel AI SDK-compatible provider backed by SinapsAI's
 * resilient in-process control plane (Circuit Breaker, Failover, Latency Routing, and Semantic Cache).
 *
 * @example
 * ```typescript
 * import { createSinapsAI } from 'sinapsai/ai-sdk';
 * import { streamText } from 'ai';
 *
 * const sinaps = createSinapsAI({
 *   providers: [new GroqProvider({ apiKey: '...' }), new OpenAiProvider({ apiKey: '...' })],
 *   strategy: 'lowest-latency',
 * });
 *
 * const result = streamText({
 *   model: sinaps('llama-3.3-70b-versatile'),
 *   prompt: 'Explain quantum computing in one sentence.',
 * });
 * ```
 */
export function createSinapsAI(
  clientOrOptions: SinapsAIProviderInput,
): SinapsAIProvider {
  if (!clientOrOptions) {
    throw new Error(
      'createSinapsAI requires a SinapsClient instance or SinapsClientOptions with at least one configured provider.',
    );
  }

  const client =
    clientOrOptions instanceof SinapsClient
      ? clientOrOptions
      : new SinapsClient(clientOrOptions);

  const createLanguageModel = (
    modelId: string,
    settings?: SinapsModelSettings,
  ) => new SinapsLanguageModel(client, modelId, settings);

  const createEmbeddingModel = (
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ) => new SinapsEmbeddingModel(client, modelId, settings);

  const provider = ((modelId: string, settings?: SinapsModelSettings) =>
    createLanguageModel(modelId, settings)) as unknown as SinapsAIProvider;

  provider.languageModel = createLanguageModel;
  provider.chat = createLanguageModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.embedding = createEmbeddingModel;

  Object.defineProperty(provider, 'client', {
    get() {
      return client;
    },
    enumerable: true,
  });

  return provider;
}

/**
 * Alias for `createSinapsAI`.
 */
export const sinapsai = createSinapsAI;
