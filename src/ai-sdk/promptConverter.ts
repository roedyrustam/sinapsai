/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Vercel AI SDK Prompt & Tool Converter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ChatMessage,
  ContentPart,
  ResponseFormat,
  ToolCall,
  ToolDefinition,
  UnifiedApiRequest,
} from '../types/index.js';
import type {
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1Prompt,
} from './types.js';

export function convertPromptToSinapsMessages(
  prompt: LanguageModelV1Prompt,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      messages.push({
        role: 'system',
        content: message.content,
      });
    } else if (message.role === 'user') {
      const parts: ContentPart[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({
            type: 'text',
            text: part.text,
          });
        } else if (part.type === 'image') {
          let urlStr: string;
          if (part.image instanceof URL) {
            urlStr = part.image.toString();
          } else if (typeof part.image === 'string') {
            urlStr = part.image;
          } else if (
            part.image instanceof Uint8Array ||
            (typeof Buffer !== 'undefined' && Buffer.isBuffer(part.image))
          ) {
            const base64 =
              typeof Buffer !== 'undefined'
                ? Buffer.from(part.image).toString('base64')
                : btoa(String.fromCharCode(...part.image));
            const mimeType = part.mimeType || 'image/jpeg';
            urlStr = `data:${mimeType};base64,${base64}`;
          } else {
            urlStr = String(part.image);
          }
          parts.push({
            type: 'image_url',
            image_url: { url: urlStr },
          });
        }
      }

      if (parts.length === 1 && parts[0].type === 'text') {
        messages.push({
          role: 'user',
          content: parts[0].text,
        });
      } else {
        messages.push({
          role: 'user',
          content: parts,
        });
      }
    } else if (message.role === 'assistant') {
      let textContent = '';
      const toolCalls: ToolCall[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          textContent += part.text;
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments:
                typeof part.args === 'string'
                  ? part.args
                  : JSON.stringify(part.args),
            },
          });
        }
      }

      messages.push({
        role: 'assistant',
        content: textContent.length > 0 ? textContent : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else if (message.role === 'tool') {
      for (const part of message.content) {
        messages.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          name: part.toolName,
          content:
            typeof part.result === 'string'
              ? part.result
              : JSON.stringify(part.result),
        });
      }
    }
  }

  return messages;
}

export function convertToolsAndMode(mode: LanguageModelV1CallOptions['mode']): {
  tools?: ToolDefinition[];
  toolChoice?: UnifiedApiRequest['toolChoice'];
  responseFormat?: ResponseFormat;
} {
  if (!mode) {
    return {};
  }

  if (mode.type === 'regular') {
    let tools: ToolDefinition[] | undefined;
    if (mode.tools && mode.tools.length > 0) {
      tools = mode.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: (t.parameters as Record<string, unknown>) ?? undefined,
        },
      }));
    }

    let toolChoice: UnifiedApiRequest['toolChoice'];
    if (mode.toolChoice) {
      if (mode.toolChoice.type === 'auto') {
        toolChoice = 'auto';
      } else if (mode.toolChoice.type === 'none') {
        toolChoice = 'none';
      } else if (mode.toolChoice.type === 'required') {
        toolChoice = 'required';
      } else if (mode.toolChoice.type === 'tool') {
        toolChoice = {
          type: 'function',
          function: { name: mode.toolChoice.toolName },
        };
      }
    }

    return { tools, toolChoice };
  }

  if (mode.type === 'object-json') {
    return {
      responseFormat: {
        type: 'json_object',
        json_schema: mode.schema
          ? {
              name: mode.name || 'response',
              description: mode.description,
              schema: mode.schema as Record<string, unknown>,
            }
          : undefined,
      },
    };
  }

  if (mode.type === 'object-tool') {
    return {
      tools: [
        {
          type: 'function',
          function: {
            name: mode.tool.name,
            description: mode.tool.description,
            parameters:
              (mode.tool.parameters as Record<string, unknown>) ?? undefined,
          },
        },
      ],
      toolChoice: {
        type: 'function',
        function: { name: mode.tool.name },
      },
    };
  }

  return {};
}

export function mapFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV1FinishReason {
  if (!finishReason) {
    return 'stop';
  }
  const normalized = finishReason.toLowerCase();
  switch (normalized) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_calls':
    case 'tool_use':
    case 'function_call':
      return 'tool-calls';
    case 'content_filter':
    case 'safety':
      return 'content-filter';
    case 'error':
      return 'error';
    default:
      return 'other';
  }
}
