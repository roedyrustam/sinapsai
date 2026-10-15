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

export * from './SinapsEmbeddingModel.js';
export * from './SinapsLanguageModel.js';
export * from './promptConverter.js';
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
  clientOrOptions?: SinapsAIProviderInput,
): SinapsAIProvider {
  let client: SinapsClient;
  if (clientOrOptions instanceof SinapsClient) {
    client = clientOrOptions;
  } else if (clientOrOptions && 'providers' in clientOrOptions) {
    client = new SinapsClient(clientOrOptions);
  } else {
    client = new SinapsClient({ providers: [] });
  }

  const createLanguageModel = (
    modelId: string,
    settings?: SinapsModelSettings,
  ) => new SinapsLanguageModel(client, modelId, settings);

  const createEmbeddingModel = (
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ) => new SinapsEmbeddingModel(client, modelId, settings);

  const provider = ((modelId: string, settings?: SinapsModelSettings) =>
    createLanguageModel(modelId, settings)) as SinapsAIProvider;

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
 * Pre-instantiated default SinapsAI provider wrapper.
 */
export const sinapsai = createSinapsAI();
