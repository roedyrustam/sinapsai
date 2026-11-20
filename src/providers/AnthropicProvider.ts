/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Anthropic Claude Provider (Adaptive Thinking, Native Structured Outputs, 1h Prompt Cache TTL, 1M Context)
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { FrontierModelRegistry } from '../core/FrontierModelRegistry.js';
import { GeminiAgentBooster } from '../core/GeminiAgentBooster.js';
import type {
  ApiUsage,
  ContentPart,
  ProviderConfig,
  TextContentPart,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';
import { parseRateLimitHeaders } from '../utils/rateLimit.js';
import { linkAbortSignal } from '../utils/signal.js';
import { parseSSE } from '../utils/stream.js';
import type { Provider } from './Provider.js';

export const ANTHROPIC_MODELS = {
  CLAUDE_SONNET_5_5: 'claude-sonnet-5-5',
  CLAUDE_OPUS_5_5: 'claude-opus-5-5',
  CLAUDE_FABLE_5_1: 'claude-fable-5-1',
  CLAUDE_OPUS_4_7: 'claude-opus-4-7',
  CLAUDE_SONNET_4_6: 'claude-sonnet-4-6',
  CLAUDE_OPUS_4_6: 'claude-opus-4-6',
  CLAUDE_HAIKU_4_5: 'claude-haiku-4-5',
  CLAUDE_3_7_SONNET: 'claude-3-7-sonnet-20250219',
  CLAUDE_3_5_SONNET: 'claude-3-5-sonnet-20241022',
  CLAUDE_3_5_HAIKU: 'claude-3-5-haiku-20241022',
} as const;

export const ANTHROPIC_AVAILABILITY_FALLBACKS: Record<string, string[]> = {
  'claude-opus-5-5': ['claude-opus-4-6'],
  'claude-opus-5.5': ['claude-opus-4-6'],
  'claude-opus-4-7': ['claude-opus-4-6'],
  'claude-sonnet-5-5': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-sonnet-5.5': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-fable-5-1': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'claude-fable-5.1': ['claude-sonnet-4-6', 'claude-opus-4-6'],
};

export const ANTHROPIC_DEFAULT_PRICING: Record<
  string,
  { promptCostPer1k: number; completionCostPer1k: number }
> = {
  'claude-sonnet-5-5': { promptCostPer1k: 0.003, completionCostPer1k: 0.015 },
  'claude-sonnet-5.5': { promptCostPer1k: 0.003, completionCostPer1k: 0.015 },
  'claude-opus-5-5': { promptCostPer1k: 0.005, completionCostPer1k: 0.025 },
  'claude-opus-5.5': { promptCostPer1k: 0.005, completionCostPer1k: 0.025 },
  'claude-fable-5-1': { promptCostPer1k: 0.0025, completionCostPer1k: 0.0125 },
  'claude-opus-4-7': { promptCostPer1k: 0.005, completionCostPer1k: 0.025 },
  'claude-sonnet-4-6': { promptCostPer1k: 0.003, completionCostPer1k: 0.015 },
  'claude-opus-4-6': { promptCostPer1k: 0.005, completionCostPer1k: 0.025 },
  'claude-haiku-4-5': { promptCostPer1k: 0.001, completionCostPer1k: 0.005 },
  'claude-3-7-sonnet-20250219': {
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
  },
  'claude-3-5-sonnet-20241022': {
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
  },
  'claude-3-5-haiku-20241022': {
    promptCostPer1k: 0.0008,
    completionCostPer1k: 0.004,
  },
};

export interface AnthropicProviderConfig extends ProviderConfig {
  /**
   * Thinking configuration mode:
   * - 'auto' (default): Uses Adaptive Thinking (`thinking: { type: 'adaptive' }` + `output_config.effort`)
   *   on Claude 4.6 / 4.7 / 5.x models and `budget_tokens` on Claude 3.7 / 4.5 models.
   * - 'adaptive': Always emits `{ type: 'adaptive' }` + `output_config.effort`.
   * - 'budget': Always emits `{ type: 'enabled', budget_tokens }`.
   */
  thinkingMode?: 'auto' | 'adaptive' | 'budget';
  /**
   * Enable native constrained structured output (`output_config.format`).
   * Default: auto-enabled on Claude 4.5+ / 4.6 / 4.7 / 5.x models.
   */
  nativeStructuredOutput?: boolean;
  /**
   * Enable 1M-token context window beta header (`context-1m-2025-08-07`).
   */
  extendedContext?: boolean;
  /**
   * Automatically configure availability fallback models (e.g. Claude Opus 5.5 -> Claude Opus 4.6).
   */
  enableAvailabilityFallback?: boolean;
}

export class AnthropicProvider implements Provider {
  id: string;
  name = 'Anthropic';
  private config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
    this.id =
      config.id ||
      `anthropic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  get costPer1kTokens(): number | undefined {
    return this.config.costPer1kTokens;
  }

  get promptCostPer1k(): number | undefined {
    if (this.config.promptCostPer1k !== undefined) {
      return this.config.promptCostPer1k;
    }
    if (this.config.defaultModel) {
      return ANTHROPIC_DEFAULT_PRICING[this.config.defaultModel]
        ?.promptCostPer1k;
    }
    return undefined;
  }

  get completionCostPer1k(): number | undefined {
    if (this.config.completionCostPer1k !== undefined) {
      return this.config.completionCostPer1k;
    }
    if (this.config.defaultModel) {
      return ANTHROPIC_DEFAULT_PRICING[this.config.defaultModel]
        ?.completionCostPer1k;
    }
    return undefined;
  }

  get retries(): number | undefined {
    return this.config.retries;
  }

  get retryDelayMs(): number | undefined {
    return this.config.retryDelayMs;
  }

  get fallbackModels(): string[] | undefined {
    if (this.config.fallbackModels) {
      return this.config.fallbackModels;
    }
    if (this.config.enableAvailabilityFallback) {
      const target = this.config.defaultModel || 'claude-opus-5-5';
      return (
        ANTHROPIC_AVAILABILITY_FALLBACKS[target] || [
          ANTHROPIC_MODELS.CLAUDE_OPUS_4_6,
        ]
      );
    }
    return undefined;
  }

  get defaultModel(): string | undefined {
    return this.config.defaultModel;
  }

  public static isAdaptiveThinkingModel(modelId: string): boolean {
    return FrontierModelRegistry.isAdaptiveThinkingModel(modelId);
  }

  public static supportsNativeStructuredOutput(modelId: string): boolean {
    const lower = modelId.toLowerCase();
    return (
      lower.includes('claude-sonnet-4-5') ||
      lower.includes('claude-sonnet-4.5') ||
      lower.includes('claude-opus-4-5') ||
      lower.includes('claude-opus-4.5') ||
      lower.includes('claude-haiku-4-5') ||
      lower.includes('claude-haiku-4.5') ||
      lower.includes('claude-sonnet-4-6') ||
      lower.includes('claude-sonnet-4.6') ||
      lower.includes('claude-opus-4-6') ||
      lower.includes('claude-opus-4.6') ||
      lower.includes('claude-opus-4-7') ||
      lower.includes('claude-opus-4.7') ||
      lower.includes('claude-sonnet-5') ||
      lower.includes('claude-opus-5') ||
      lower.includes('claude-fable-5')
    );
  }

  public resolveModel(model: string): string {
    if (this.config.modelMap?.[model]) {
      return this.config.modelMap[model];
    }
    return this.config.defaultModel || model;
  }

  private mapAdaptiveEffort(
    effort?: UnifiedApiRequest['reasoningEffort'],
    budget?: number,
  ): 'low' | 'medium' | 'high' | 'max' {
    if (effort) {
      if (effort === 'minimal' || effort === 'low') return 'low';
      if (effort === 'medium') return 'medium';
      if (effort === 'xhigh' || effort === 'max') return 'max';
      return 'high';
    }
    if (budget !== undefined) {
      if (budget <= 2048) return 'low';
      if (budget <= 8192) return 'medium';
      if (budget <= 32768) return 'high';
      return 'max';
    }
    return 'medium';
  }

  private mapBudgetFromEffort(
    effort?: UnifiedApiRequest['reasoningEffort'],
  ): number | undefined {
    if (!effort || effort === 'none') return undefined;
    switch (effort) {
      case 'minimal':
        return 1024;
      case 'low':
        return 2048;
      case 'medium':
        return 8192;
      case 'high':
        return 16384;
      case 'xhigh':
      case 'max':
        return 32768;
      default:
        return undefined;
    }
  }

  public formatRequest(request: UnifiedApiRequest) {
    const resolvedModel = this.resolveModel(request.model);
    // biome-ignore lint/suspicious/noExplicitAny: request format varies by provider
    const payload: any = {
      model: resolvedModel,
      max_tokens: request.maxTokens || 4096,
      messages: [],
    };

    const resolvedThinkingBudget =
      request.thinkingBudget === 'auto'
        ? GeminiAgentBooster.computeDynamicThinkingBudget(request)
        : (request.thinkingBudget ??
          this.mapBudgetFromEffort(request.reasoningEffort));

    const useAdaptive =
      this.config.thinkingMode === 'adaptive' ||
      (this.config.thinkingMode !== 'budget' &&
        AnthropicProvider.isAdaptiveThinkingModel(resolvedModel));

    const thinkingExplicitlyRequested =
      request.thinkingBudget !== undefined ||
      request.reasoningEffort !== undefined;

    if (
      useAdaptive &&
      thinkingExplicitlyRequested &&
      request.reasoningEffort !== 'none' &&
      resolvedThinkingBudget !== 0
    ) {
      payload.thinking = { type: 'adaptive' };
      const effort = this.mapAdaptiveEffort(
        request.reasoningEffort,
        resolvedThinkingBudget,
      );
      payload.output_config = {
        ...(payload.output_config || {}),
        effort,
      };
      if (
        resolvedThinkingBudget !== undefined &&
        (!request.maxTokens || request.maxTokens <= resolvedThinkingBudget)
      ) {
        payload.max_tokens = Math.max(payload.max_tokens, 16000);
      }
    } else if (
      !useAdaptive &&
      resolvedThinkingBudget !== undefined &&
      resolvedThinkingBudget > 0
    ) {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: resolvedThinkingBudget,
      };
      if (!request.maxTokens || request.maxTokens <= resolvedThinkingBudget) {
        payload.max_tokens = resolvedThinkingBudget + 4096;
      }
      payload.temperature = 1.0;
    } else if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const systemMessages: string[] = [];

    const formatAnthropicContent = (content: string | ContentPart[] | null) => {
      if (content === null || content === undefined) return '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map((part) => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          }
          if (part.type === 'image_url') {
            const img = part.image_url ?? part.imageUrl;
            const url = img?.url ?? '';
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
            return {
              type: 'image',
              source: {
                type: 'url',
                url,
              },
            };
          }
          return { type: 'text', text: JSON.stringify(part) };
        });
      }
      return '';
    };

    for (const msg of request.messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        if (typeof msg.content === 'string') {
          systemMessages.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          const sysText = msg.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as TextContentPart).text)
            .join('\n');
          if (sysText) systemMessages.push(sysText);
        }
      } else if (msg.role === 'tool') {
        const toolContent =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content || '');
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: toolContent,
        };
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'user' &&
          Array.isArray(lastMsg.content)
        ) {
          lastMsg.content.push(toolResultBlock);
        } else {
          payload.messages.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
      } else if (
        msg.role === 'assistant' &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: anthropic content blocks
        const contentBlocks: any[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              contentBlocks.push({ type: 'text', text: part.text });
            }
          }
        }
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        payload.messages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        const lastMsg = payload.messages[payload.messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === msg.role &&
          typeof lastMsg.content === 'string' &&
          typeof msg.content === 'string'
        ) {
          lastMsg.content += `\n\n${msg.content}`;
        } else {
          payload.messages.push({
            role: msg.role,
            content: formatAnthropicContent(msg.content),
          });
        }
      }
    }

    const useNativeStructured =
      this.config.nativeStructuredOutput ??
      AnthropicProvider.supportsNativeStructuredOutput(resolvedModel);

    if (request.responseFormat?.type === 'json_object') {
      systemMessages.push(
        'Respond strictly with a valid JSON object without markdown wrappers.',
      );
    } else if (
      request.responseFormat?.type === 'json_schema' &&
      request.responseFormat.json_schema
    ) {
      if (useNativeStructured) {
        payload.output_config = {
          ...(payload.output_config || {}),
          format: {
            type: 'json_schema',
            schema: request.responseFormat.json_schema.schema,
          },
        };
      } else {
        systemMessages.push(
          `Respond strictly with valid JSON matching this schema:\n${JSON.stringify(request.responseFormat.json_schema.schema)}`,
        );
      }
    }

    if (systemMessages.length > 0) {
      const systemText = systemMessages.join('\n');
      const shouldCache =
        this.config.promptCaching === true ||
        (this.config.promptCaching !== false && systemText.length >= 2048);
      if (shouldCache) {
        const ttl = request.promptCacheTtl ?? this.config.promptCacheTtl;
        payload.system = [
          {
            type: 'text',
            text: systemText,
            cache_control:
              ttl === '1h'
                ? { type: 'ephemeral', ttl: '1h' }
                : { type: 'ephemeral' },
          },
        ];
      } else {
        payload.system = systemText;
      }
    }

    if (request.tools && request.toolChoice !== 'none') {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object' },
      }));
    }

    if (request.toolChoice && request.toolChoice !== 'none') {
      if (request.toolChoice === 'auto') {
        payload.tool_choice = { type: 'auto' };
      } else if (request.toolChoice === 'required') {
        payload.tool_choice = { type: 'any' };
      } else if (typeof request.toolChoice === 'object') {
        payload.tool_choice = {
          type: 'tool',
          name: request.toolChoice.function.name,
        };
      }
    }

    if (request.serviceTier) {
      payload.service_tier =
        request.serviceTier === 'flex' ? 'auto' : request.serviceTier;
    }

    if (request.stream) {
      payload.stream = true;
    }

    return payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: response format varies by provider
  public formatResponse(data: any): UnifiedApiResponse {
    let text = '';
    let reasoningContent = '';
    // biome-ignore lint/suspicious/noExplicitAny: anthropic tool calls
    const toolCalls: any[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'thinking') {
          reasoningContent += block.thinking;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
        }
      }
    }

    let finishReason = 'stop';
    if (data.stop_reason) {
      switch (data.stop_reason) {
        case 'tool_use':
          finishReason = 'tool_calls';
          break;
        case 'max_tokens':
          finishReason = 'length';
          break;
        case 'end_turn':
        case 'stop_sequence':
          finishReason = 'stop';
          break;
        default:
          finishReason = data.stop_reason;
      }
    }

    let usage: ApiUsage | undefined;
    if (data.usage) {
      usage = {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens:
          (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        cachedPromptTokens: data.usage.cache_read_input_tokens || undefined,
      };
      if (data.usage.cache_creation_input_tokens) {
        usage.cacheWriteTokens = data.usage.cache_creation_input_tokens;
      }
    }

    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: text || null,
            reasoning_content: reasoningContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason,
        },
      ],
      usage,
    };
  }

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>> {
    const payload = this.formatRequest(request);
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (this.config.timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    }

    const cleanupSignal = linkAbortSignal(controller, request.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
    };

    const betaFlags: string[] = [];
    if (this.config.promptCaching || Array.isArray(payload.system)) {
      betaFlags.push('prompt-caching-2024-07-31');
    }
    const uses1hTtl =
      Array.isArray(payload.system) &&
      payload.system.some(
        (s: { cache_control?: { ttl?: string } }) =>
          s.cache_control?.ttl === '1h',
      );
    if (uses1hTtl) {
      betaFlags.push('extended-cache-ttl-2025-04-11');
    }
    if (this.config.extendedContext) {
      betaFlags.push('context-1m-2025-08-07');
    }
    if (betaFlags.length > 0) {
      headers['anthropic-beta'] = betaFlags.join(',');
    }

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
          `Anthropic API Error (${response.status}): ${errorText}`,
        ) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (request.stream) {
        return (async function* () {
          let messageId = `anthropic-${Date.now()}`;
          let promptTokens = 0;
          let cachedPromptTokens: number | undefined;
          let cacheWriteTokens: number | undefined;
          try {
            for await (const msg of parseSSE(response)) {
              if (msg.event === 'message_start') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.message?.id) messageId = parsed.message.id;
                  if (parsed.message?.usage) {
                    promptTokens = parsed.message.usage.input_tokens || 0;
                    cachedPromptTokens =
                      parsed.message.usage.cache_read_input_tokens || undefined;
                    cacheWriteTokens =
                      parsed.message.usage.cache_creation_input_tokens ||
                      undefined;
                  }
                } catch (_e) {}
              } else if (msg.event === 'content_block_start') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.content_block?.type === 'tool_use') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: parsed.index,
                                id: parsed.content_block.id,
                                type: 'function',
                                function: {
                                  name: parsed.content_block.name,
                                  arguments: '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  }
                } catch (_e) {}
              } else if (msg.event === 'content_block_delta') {
                try {
                  const parsed = JSON.parse(msg.data);
                  if (parsed.delta?.type === 'text_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: parsed.delta.text || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (parsed.delta?.type === 'thinking_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            reasoning_content: parsed.delta.thinking || '',
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  } else if (parsed.delta?.type === 'input_json_delta') {
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                index: parsed.index,
                                function: {
                                  arguments: parsed.delta.partial_json || '',
                                },
                              },
                            ],
                          },
                          finishReason: null,
                        },
                      ],
                    };
                  }
                } catch (_e) {}
              } else if (msg.event === 'message_delta') {
                try {
                  const parsed = JSON.parse(msg.data);
                  const completionTokens = parsed.usage?.output_tokens || 0;
                  let chunkUsage: ApiUsage | undefined;
                  if (promptTokens || completionTokens) {
                    chunkUsage = {
                      promptTokens,
                      completionTokens,
                      totalTokens: promptTokens + completionTokens,
                      cachedPromptTokens,
                    };
                    if (cacheWriteTokens) {
                      chunkUsage.cacheWriteTokens = cacheWriteTokens;
                    }
                  }

                  if (parsed.delta?.stop_reason) {
                    let finishReason = 'stop';
                    switch (parsed.delta.stop_reason) {
                      case 'tool_use':
                        finishReason = 'tool_calls';
                        break;
                      case 'max_tokens':
                        finishReason = 'length';
                        break;
                      case 'end_turn':
                      case 'stop_sequence':
                        finishReason = 'stop';
                        break;
                      default:
                        finishReason = parsed.delta.stop_reason;
                    }
                    yield {
                      id: messageId,
                      model: payload.model,
                      choices: [
                        {
                          delta: {},
                          finishReason,
                        },
                      ],
                      usage: chunkUsage,
                    };
                  }
                } catch (_e) {}
              }
            }
          } finally {
            cleanupSignal?.();
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
          }
        })();
      }

      const data = await response.json();
      const res = this.formatResponse(data);
      const rl = parseRateLimitHeaders(response.headers);
      if (rl) {
        res.rateLimit = rl;
      }
      return res;
    } catch (error) {
      cleanupSignal?.();
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    } finally {
      if (!request.stream) {
        cleanupSignal?.();
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }
}
