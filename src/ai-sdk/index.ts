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
import {
  SinapsLanguageModelV2,
  SinapsLanguageModelV3,
} from './SinapsLanguageModelV2.js';
import type {
  LanguageModelV2,
  LanguageModelV3,
  SinapsAIProvider,
  SinapsAIProviderInput,
  SinapsEmbeddingSettings,
  SinapsModelSettings,
} from './types.js';

export * from './promptConverter.js';
export * from './SinapsEmbeddingModel.js';
export * from './SinapsLanguageModel.js';
export * from './SinapsLanguageModelV2.js';
export * from './types.js';

function resolveClient(clientOrOptions: SinapsAIProviderInput): SinapsClient {
  if (!clientOrOptions) {
    throw new Error(
      'createSinapsAI requires a SinapsClient instance or SinapsClientOptions with at least one configured provider.',
    );
  }
  return clientOrOptions instanceof SinapsClient
    ? clientOrOptions
    : new SinapsClient(clientOrOptions);
}

/**
 * Creates a Vercel AI SDK-compatible provider backed by SinapsAI's
 * resilient in-process control plane (Circuit Breaker, Failover, Latency Routing, and Semantic Cache).
 */
export function createSinapsAI(
  clientOrOptions: SinapsAIProviderInput,
): SinapsAIProvider {
  const client = resolveClient(clientOrOptions);

  const createLanguageModel = (
    modelId: string,
    settings?: SinapsModelSettings,
  ) => new SinapsLanguageModel(client, modelId, settings);

  const createLanguageModelV2 = (
    modelId: string,
    settings?: SinapsModelSettings,
  ) => new SinapsLanguageModelV2(client, modelId, settings);

  const createLanguageModelV3 = (
    modelId: string,
    settings?: SinapsModelSettings,
  ) => new SinapsLanguageModelV3(client, modelId, settings);

  const createEmbeddingModel = (
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ) => new SinapsEmbeddingModel(client, modelId, settings);

  const provider = ((modelId: string, settings?: SinapsModelSettings) =>
    createLanguageModel(modelId, settings)) as unknown as SinapsAIProvider;

  provider.languageModel = createLanguageModel;
  provider.languageModelV2 = createLanguageModelV2;
  provider.languageModelV3 = createLanguageModelV3;
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

export interface SinapsAIProviderV2 {
  (modelId: string, settings?: SinapsModelSettings): LanguageModelV2;
  languageModel(
    modelId: string,
    settings?: SinapsModelSettings,
  ): LanguageModelV2;
  chat(modelId: string, settings?: SinapsModelSettings): LanguageModelV2;
  textEmbeddingModel(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): SinapsEmbeddingModel;
  embedding(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): SinapsEmbeddingModel;
  readonly client: SinapsClient;
}

export interface SinapsAIProviderV3 {
  (modelId: string, settings?: SinapsModelSettings): LanguageModelV3;
  languageModel(
    modelId: string,
    settings?: SinapsModelSettings,
  ): LanguageModelV3;
  chat(modelId: string, settings?: SinapsModelSettings): LanguageModelV3;
  textEmbeddingModel(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): SinapsEmbeddingModel;
  embedding(
    modelId: string,
    settings?: SinapsEmbeddingSettings,
  ): SinapsEmbeddingModel;
  readonly client: SinapsClient;
}

/**
 * Creates a Vercel AI SDK v5 (`specificationVersion: 'v2'`) native provider backed by SinapsAI.
 */
export function createSinapsAIV2(
  clientOrOptions: SinapsAIProviderInput,
): SinapsAIProviderV2 {
  const client = resolveClient(clientOrOptions);
  const createModel = (modelId: string, settings?: SinapsModelSettings) =>
    new SinapsLanguageModelV2(client, modelId, settings);
  const createEmb = (modelId: string, settings?: SinapsEmbeddingSettings) =>
    new SinapsEmbeddingModel(client, modelId, settings);

  const provider = ((modelId: string, settings?: SinapsModelSettings) =>
    createModel(modelId, settings)) as unknown as SinapsAIProviderV2;
  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.textEmbeddingModel = createEmb;
  provider.embedding = createEmb;
  Object.defineProperty(provider, 'client', {
    get: () => client,
    enumerable: true,
  });
  return provider;
}

/**
 * Creates a Vercel AI SDK v6 (`specificationVersion: 'v3'`) native provider backed by SinapsAI.
 */
export function createSinapsAIV3(
  clientOrOptions: SinapsAIProviderInput,
): SinapsAIProviderV3 {
  const client = resolveClient(clientOrOptions);
  const createModel = (modelId: string, settings?: SinapsModelSettings) =>
    new SinapsLanguageModelV3(client, modelId, settings);
  const createEmb = (modelId: string, settings?: SinapsEmbeddingSettings) =>
    new SinapsEmbeddingModel(client, modelId, settings);

  const provider = ((modelId: string, settings?: SinapsModelSettings) =>
    createModel(modelId, settings)) as unknown as SinapsAIProviderV3;
  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.textEmbeddingModel = createEmb;
  provider.embedding = createEmb;
  Object.defineProperty(provider, 'client', {
    get: () => client,
    enumerable: true,
  });
  return provider;
}

/**
 * Alias for `createSinapsAI`.
 */
export const sinapsai = createSinapsAI;
