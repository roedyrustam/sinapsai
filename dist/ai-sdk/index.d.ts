/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Integration & Provider Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { SinapsAIProvider, SinapsAIProviderInput } from './types.js';
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
export declare function createSinapsAI(clientOrOptions: SinapsAIProviderInput): SinapsAIProvider;
/**
 * Alias for `createSinapsAI`.
 */
export declare const sinapsai: typeof createSinapsAI;
//# sourceMappingURL=index.d.ts.map