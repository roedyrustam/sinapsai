/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * AWS Bedrock Provider (Converse API with pure Zero-Dependency AWS SigV4 Signer)
 *
 * Implements:
 * 1. Zero-dependency AWS SigV4 request signer using standard Web Crypto API (crypto.subtle).
 * 2. AWS Bedrock Converse API (`/model/{modelId}/converse`).
 * 3. Support for Claude 3.7/3.5, Amazon Nova (Pro/Lite/Micro), Meta Llama 3.3/3.1, and Mistral Large.
 * 4. Automatic tool calling and JSON Schema translation.
 * 5. Full TypeScript strict typing and error recovery.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  ProviderConfig,
  ToolCall,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { linkAbortSignal } from '../utils/signal.js';
import type { Provider } from './Provider.js';

export const BEDROCK_MODELS = {
  CLAUDE_3_7_SONNET: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  CLAUDE_3_5_SONNET: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  CLAUDE_3_5_HAIKU: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  NOVA_PRO: 'amazon.nova-pro-v1:0',
  NOVA_LITE: 'amazon.nova-lite-v1:0',
  NOVA_MICRO: 'amazon.nova-micro-v1:0',
  LLAMA_3_3_70B: 'meta.llama3-3-70b-instruct-v1:0',
  LLAMA_3_1_8B: 'meta.llama3-1-8b-instruct-v1:0',
  MISTRAL_LARGE: 'mistral.mistral-large-2407-v1:0',
} as const;

export interface AwsBedrockProviderConfig extends ProviderConfig {
  /**
   * AWS Region (e.g. 'us-east-1', 'us-west-2', 'eu-central-1').
   * Default: process.env.AWS_REGION || 'us-east-1'
   */
  region?: string;
  /**
   * AWS Access Key ID.
   * Default: process.env.AWS_ACCESS_KEY_ID
   */
  accessKeyId?: string;
  /**
   * AWS Secret Access Key.
   * Default: process.env.AWS_SECRET_ACCESS_KEY
   */
  secretAccessKey?: string;
  /**
   * Optional AWS Session Token (for temporary IAM/STS credentials).
   * Default: process.env.AWS_SESSION_TOKEN
   */
  sessionToken?: string;
}

/**
 * Calculates SHA-256 hash in hex representation using Web Crypto.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes HMAC-SHA256 using Web Crypto.
 */
export async function hmacSha256(
  key: Uint8Array | ArrayBuffer,
  data: string,
): Promise<ArrayBuffer> {
  const keyBuffer: ArrayBuffer =
    key instanceof Uint8Array
      ? (key.buffer.slice(
          key.byteOffset,
          key.byteOffset + key.byteLength,
        ) as ArrayBuffer)
      : (key as ArrayBuffer);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(data) as unknown as ArrayBuffer,
  );
}

/**
 * Derives the AWS SigV4 signing key.
 */
export async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Signs an HTTP request according to AWS SigV4 specifications.
 */
export async function signAwsRequest(params: {
  method: string;
  url: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  date?: Date;
}): Promise<Record<string, string>> {
  const parsedUrl = new URL(params.url);
  const now = params.date || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const headersToSign: Record<string, string> = {
    'content-type': 'application/json',
    host: parsedUrl.host,
    'x-amz-date': amzDate,
  };

  if (params.sessionToken) {
    headersToSign['x-amz-security-token'] = params.sessionToken;
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${headersToSign[k].trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const payloadHash = await sha256Hex(params.body);

  const canonicalRequest = [
    params.method.toUpperCase(),
    parsedUrl.pathname,
    parsedUrl.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(
    params.secretAccessKey,
    dateStamp,
    params.region,
    params.service,
  );

  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorization = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headersToSign,
    authorization,
  };
}

export class AwsBedrockProvider implements Provider {
  public readonly id: string;
  public readonly name = 'AWS Bedrock';
  private readonly config: AwsBedrockProviderConfig;
  private readonly region: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly sessionToken?: string;

  constructor(config: AwsBedrockProviderConfig = {}) {
    this.config = config;
    this.id =
      config.id ||
      `bedrock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.region =
      config.region ||
      (typeof process !== 'undefined' ? process.env.AWS_REGION : undefined) ||
      'us-east-1';
    this.accessKeyId =
      config.accessKeyId ||
      (typeof process !== 'undefined'
        ? process.env.AWS_ACCESS_KEY_ID
        : undefined);
    this.secretAccessKey =
      config.secretAccessKey ||
      (typeof process !== 'undefined'
        ? process.env.AWS_SECRET_ACCESS_KEY
        : undefined);
    this.sessionToken =
      config.sessionToken ||
      (typeof process !== 'undefined'
        ? process.env.AWS_SESSION_TOKEN
        : undefined);
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
    return this.config.defaultModel || BEDROCK_MODELS.CLAUDE_3_5_SONNET;
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return model || this.defaultModel || BEDROCK_MODELS.CLAUDE_3_5_SONNET;
  }

  /**
   * Converts UnifiedApiRequest to AWS Bedrock Converse format
   */
  public formatRequest(request: UnifiedApiRequest): {
    modelId: string;
    payload: Record<string, unknown>;
  } {
    const modelId = this.resolveModel(request.model);

    // Extract system instructions if present
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const system =
      systemMessages.length > 0
        ? systemMessages.map((m) => ({
            text:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
          }))
        : undefined;

    // Convert chat messages to Bedrock converse messages
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';

        // Tool response message
        if (m.role === 'tool' && m.tool_call_id) {
          return {
            role: 'user',
            content: [
              {
                toolResult: {
                  toolUseId: m.tool_call_id,
                  content: [
                    {
                      text:
                        typeof m.content === 'string'
                          ? m.content
                          : JSON.stringify(m.content),
                    },
                  ],
                  status: 'success',
                },
              },
            ],
          };
        }

        // Assistant with tool calls
        if (
          m.role === 'assistant' &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls.length > 0
        ) {
          const contents: Array<Record<string, unknown>> = [];
          if (typeof m.content === 'string' && m.content) {
            contents.push({ text: m.content });
          }
          for (const tc of m.tool_calls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.function.arguments || '{}');
            } catch {
              input = { raw: tc.function.arguments };
            }
            contents.push({
              toolUse: {
                toolUseId: tc.id,
                name: tc.function.name,
                input,
              },
            });
          }
          return { role: 'assistant', content: contents };
        }

        // Standard text content
        if (typeof m.content === 'string') {
          return {
            role,
            content: [{ text: m.content }],
          };
        }

        // Multimodal parts
        if (Array.isArray(m.content)) {
          const contentParts: Array<Record<string, unknown>> = [];
          for (const part of m.content) {
            if (part.type === 'text') {
              contentParts.push({ text: part.text });
            }
          }
          return {
            role,
            content:
              contentParts.length > 0
                ? contentParts
                : [{ text: JSON.stringify(m.content) }],
          };
        }

        return {
          role,
          content: [{ text: String(m.content || '') }],
        };
      });

    const payload: Record<string, unknown> = {
      messages,
    };

    if (system && system.length > 0) {
      payload.system = system;
    }

    const inferenceConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      inferenceConfig.maxTokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      inferenceConfig.temperature = request.temperature;
    }
    if (Object.keys(inferenceConfig).length > 0) {
      payload.inferenceConfig = inferenceConfig;
    }

    // Tools
    if (Array.isArray(request.tools) && request.tools.length > 0) {
      payload.toolConfig = {
        tools: request.tools.map((t) => ({
          toolSpec: {
            name: t.function.name,
            description: t.function.description || t.function.name,
            inputSchema: {
              json: t.function.parameters || { type: 'object', properties: {} },
            },
          },
        })),
      };
    }

    return { modelId, payload };
  }

  /**
   * Formats Bedrock Converse response into UnifiedApiResponse
   */
  public formatResponse(
    // biome-ignore lint/suspicious/noExplicitAny: Bedrock converse response structure
    data: any,
    modelId: string,
  ): UnifiedApiResponse {
    const msg = data.output?.message;
    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    if (Array.isArray(msg?.content)) {
      for (const item of msg.content) {
        if (typeof item.text === 'string') {
          content = (content || '') + item.text;
        }
        if (item.toolUse) {
          toolCalls.push({
            id: item.toolUse.toolUseId || `tool_${Date.now()}`,
            type: 'function',
            function: {
              name: item.toolUse.name,
              arguments: JSON.stringify(item.toolUse.input || {}),
            },
          });
        }
      }
    }

    const finishReason =
      data.stopReason === 'tool_use'
        ? 'tool_calls'
        : data.stopReason === 'end_turn'
          ? 'stop'
          : data.stopReason === 'max_tokens'
            ? 'length'
            : data.stopReason || 'stop';

    return {
      id: `bedrock-${Date.now()}`,
      model: modelId,
      choices: [
        {
          message: {
            role: 'assistant',
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason,
        },
      ],
      usage: data.usage
        ? {
            promptTokens: data.usage.inputTokens || 0,
            completionTokens: data.usage.outputTokens || 0,
            totalTokens: data.usage.totalTokens || 0,
          }
        : undefined,
    };
  }

  public async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        'AWS Bedrock error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be provided via config or environment variables.',
      );
    }

    const { modelId, payload } = this.formatRequest(request);
    const bodyStr = JSON.stringify(payload);

    const baseUrl =
      this.config.baseUrl ||
      `https://bedrock-runtime.${this.region}.amazonaws.com`;
    const url = `${baseUrl.replace(/\/+$/, '')}/model/${encodeURIComponent(modelId)}/converse`;

    const signedHeaders = await signAwsRequest({
      method: 'POST',
      url,
      body: bodyStr,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
      service: 'bedrock',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs || 60000);

    const cleanupSignal = linkAbortSignal(controller, request.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: signedHeaders,
        body: bodyStr,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `AWS Bedrock HTTP ${response.status} (${response.statusText}): ${errorText}`,
        );
      }

      // biome-ignore lint/suspicious/noExplicitAny: response JSON
      const json: any = await response.json();
      const unifiedResponse = this.formatResponse(json, modelId);

      // If streaming was requested, emit formatted response as an async generator
      if (request.stream) {
        return (async function* () {
          yield {
            id: unifiedResponse.id,
            model: unifiedResponse.model,
            choices: [
              {
                delta: {
                  content: unifiedResponse.choices[0].message.content,
                  tool_calls:
                    unifiedResponse.choices[0].message.tool_calls?.map(
                      (tc, idx) => ({
                        index: idx,
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      }),
                    ),
                },
                finishReason: unifiedResponse.choices[0].finishReason,
              },
            ],
            usage: unifiedResponse.usage,
          };
        })();
      }

      return unifiedResponse;
    } finally {
      clearTimeout(timeout);
      cleanupSignal?.();
    }
  }

  public async generateEmbedding(
    _request: CreateEmbeddingRequest,
  ): Promise<CreateEmbeddingResponse> {
    throw new Error(
      'AWS Bedrock Embeddings should be configured via Titan or Cohere Embed models.',
    );
  }
}
