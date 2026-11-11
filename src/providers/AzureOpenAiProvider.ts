/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Azure OpenAI Service Provider
 *
 * Implements:
 * 1. Microsoft Azure OpenAI custom deployment endpoint resolution.
 * 2. Dual authentication support: Azure `api-key` header and Microsoft Entra ID (Bearer token).
 * 3. Chat Completions with tool calls, structured outputs, and streaming SSE.
 * 4. Text Embeddings API.
 * 5. Rate limit telemetry and zero external runtime dependencies.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export interface AzureOpenAiProviderConfig extends ProviderConfig {
  /**
   * Azure OpenAI Resource Name (e.g. 'my-corp-azure-openai').
   * Used to construct endpoint: https://{resourceName}.openai.azure.com
   * Default: process.env.AZURE_OPENAI_RESOURCE_NAME
   */
  resourceName?: string;
  /**
   * Deployment Name or Deployment ID in Azure OpenAI Studio.
   * If not specified, request.model is used as the deployment name.
   * Default: process.env.AZURE_OPENAI_DEPLOYMENT_NAME
   */
  deploymentName?: string;
  /**
   * API Version query parameter.
   * Default: '2024-10-21'
   */
  apiVersion?: string;
  /**
   * API Key for `api-key` header authentication.
   * Default: process.env.AZURE_OPENAI_API_KEY
   */
  apiKey?: string;
  /**
   * Optional Bearer Token for Microsoft Entra ID / Azure AD authentication.
   * Sent as `Authorization: Bearer {bearerToken}`.
   */
  bearerToken?: string;
}

export class AzureOpenAiProvider implements Provider {
  public readonly id: string;
  public readonly name = 'Azure OpenAI';
  private readonly config: AzureOpenAiProviderConfig;
  private readonly resourceName?: string;
  private readonly deploymentName?: string;
  private readonly apiVersion: string;
  private readonly apiKey?: string;
  private readonly bearerToken?: string;

  constructor(config: AzureOpenAiProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `azure-openai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.resourceName =
      config.resourceName ||
      (typeof process !== 'undefined'
        ? process.env.AZURE_OPENAI_RESOURCE_NAME
        : undefined);
    this.deploymentName =
      config.deploymentName ||
      (typeof process !== 'undefined'
        ? process.env.AZURE_OPENAI_DEPLOYMENT_NAME
        : undefined);
    this.apiVersion = config.apiVersion || '2024-10-21';
    this.apiKey =
      config.apiKey ||
      (typeof process !== 'undefined'
        ? process.env.AZURE_OPENAI_API_KEY
        : undefined);
    this.bearerToken = config.bearerToken;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  get promptCostPer1k(): number | undefined {
    return this.config.promptCostPer1k;
  }

  get completionCostPer1k(): number | undefined {
    return this.config.completionCostPer1k;
  }

  get retries(): number | undefined {
    return this.config.retries;
  }

  get retryDelayMs(): number | undefined {
    return this.config.retryDelayMs;
  }

  get fallbackModels(): string[] | undefined {
    return this.config.fallbackModels;
  }

  get defaultModel(): string | undefined {
    return this.config.defaultModel || this.deploymentName || 'gpt-4o';
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.deploymentName || model || this.defaultModel || 'gpt-4o';
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    } else if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    } else {
      throw new Error(
        'Azure OpenAI error: apiKey or bearerToken must be provided via config or environment variables (AZURE_OPENAI_API_KEY).',
      );
    }

    return headers;
  }

  public formatRequest(request: UnifiedApiRequest) {
    const messages = request.messages.map((m) => {
      // biome-ignore lint/suspicious/noExplicitAny: OpenAI message format
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.name) msg.name = m.name;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

    const deployment = this.resolveModel(request.model);
    // biome-ignore lint/suspicious/noExplicitAny: request payload
    const payload: any = {
      messages,
    };

    const isReasoningModel =
      deployment.startsWith('o1') ||
      deployment.startsWith('o3') ||
      deployment.startsWith('o4');

    if (request.reasoningEffort) {
      payload.reasoning_effort = request.reasoningEffort;
    }
    if (request.temperature !== undefined && !isReasoningModel) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      if (isReasoningModel) {
        payload.max_completion_tokens = request.maxTokens;
      } else {
        payload.max_tokens = request.maxTokens;
      }
    }
    if (request.stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    if (request.tools) {
      payload.tools = request.tools;
    }
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice;
    }
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;
    }

    return { deployment, payload };
  }

  // biome-ignore lint/suspicious/noExplicitAny: Azure response structure
  public formatResponse(data: any, deployment: string): UnifiedApiResponse {
    const choice = data.choices?.[0];
    const reasoningContent =
      choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? null;

    return {
      id: data.id || `azure-${Date.now()}`,
      model: data.model || deployment,
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
            reasoning_content: reasoningContent,
            tool_calls: choice?.message?.tool_calls,
          },
          finishReason: choice?.finish_reason ?? 'stop',
        },
      ],
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cachedPromptTokens:
              data.usage.prompt_tokens_details?.cached_tokens ?? undefined,
          }
        : undefined,
    };
  }

  public async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    if (!this.resourceName && !this.config.baseUrl) {
      throw new Error(
        'Azure OpenAI error: resourceName (or baseUrl) must be configured.',
      );
    }

    const { deployment, payload } = this.formatRequest(request);
    const headers = this.getAuthHeaders();

    const baseUrl =
      this.config.baseUrl || `https://${this.resourceName}.openai.azure.com`;
    const url = `${baseUrl.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${this.apiVersion}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs || 60000);

    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Azure OpenAI API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          try {
            for await (const msg of parseSSE(response)) {
              try {
                const parsed = JSON.parse(msg.data);
                const chunk = parsed.choices?.[0];
                let chunkUsage: UnifiedApiStreamChunk['usage'] | undefined;
                if (parsed.usage) {
                  chunkUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cachedPromptTokens:
                      parsed.usage.prompt_tokens_details?.cached_tokens ??
                      undefined,
                  };
                }
                yield {
                  id: parsed.id || `azure-${Date.now()}`,
                  model: parsed.model || deployment,
                  choices: [
                    {
                      delta: {
                        role: chunk?.delta?.role,
                        content: chunk?.delta?.content,
                        reasoning_content:
                          chunk?.delta?.reasoning ??
                          chunk?.delta?.reasoning_content ??
                          null,
                        tool_calls: chunk?.delta?.tool_calls,
                      },
                      finishReason: chunk?.finish_reason || null,
                    },
                  ],
                  usage: chunkUsage,
                };
              } catch {
                // ignore parse errors for heartbeat or [DONE]
              }
            }
          } finally {
            cleanupSignal?.();
            clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }

      const data = await response.json();
      const res = this.formatResponse(data, deployment);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      clearTimeout(timeoutId);
      throw error;
    }
  }

  public async generateEmbedding(
    request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    if (!this.resourceName && !this.config.baseUrl) {
      throw new Error(
        'Azure OpenAI error: resourceName (or baseUrl) must be configured.',
      );
    }

    const deployment = this.resolveModel(request.model);
    const headers = this.getAuthHeaders();

    const baseUrl =
      this.config.baseUrl || `https://${this.resourceName}.openai.azure.com`;
    const url = `${baseUrl.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${this.apiVersion}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs || 30000);

    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: request.input,
          dimensions: request.dimensions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Azure OpenAI Embeddings API Error (${response.status}): ${errorText}`,
        );
      }

      // biome-ignore lint/suspicious/noExplicitAny: response JSON
      const data: any = await response.json();
      return {
        object: 'list',
        data: data.data,
        model: deployment,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } finally {
      cleanupSignal?.();
      clearTimeout(timeoutId);
    }
  }
}
