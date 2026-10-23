/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * Model Context Protocol (MCP) In-Process Tool Bridge & JSON-RPC Protocol
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage, ToolCall, ToolDefinition } from '../types/index.js';
import { extractJsonFromText } from '../utils/structuredOutput.js';

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
}

export interface McpResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolInputSchema;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: raw handler result
  _raw?: any;
}

export interface McpToolContext {
  signal?: AbortSignal;
  user?: string;
  toolCallId?: string;
  /**
   * Optional execution timeout in milliseconds.
   */
  timeoutMs?: number;
  // biome-ignore lint/suspicious/noExplicitAny: custom context metadata
  meta?: Record<string, any>;
}

// biome-ignore lint/suspicious/noExplicitAny: generic handler args and result
export type McpToolHandler<TArgs = any, TResult = any> = (
  args: TArgs,
  context?: McpToolContext,
) => Promise<TResult> | TResult;

// biome-ignore lint/suspicious/noExplicitAny: tool definition wrapper
export interface McpToolDefinition<TArgs = any, TResult = any> extends McpTool {
  handler: McpToolHandler<TArgs, TResult>;
  /**
   * Optional execution timeout in milliseconds for this tool.
   */
  timeoutMs?: number;
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC parameters
  params?: Record<string, any>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC result
  result?: any;
  error?: {
    code: number;
    message: string;
    // biome-ignore lint/suspicious/noExplicitAny: error data
    data?: any;
  };
}

/**
 * In-process Model Context Protocol (MCP) tool bridge.
 *
 * Provides seamless registration of local tools, bi-directional schema conversion
 * to OpenAI/Unified format, error-resilient tool call execution, and standard
 * JSON-RPC 2.0 protocol dispatching for MCP clients.
 */
export class McpToolBridge {
  private tools = new Map<string, McpToolDefinition>();

  constructor(tools?: McpToolDefinition[]) {
    if (tools && Array.isArray(tools)) {
      for (const t of tools) {
        this.registerTool(t);
      }
    }
  }

  /**
   * Registers a new in-process MCP tool with its execution handler.
   */
  // biome-ignore lint/suspicious/noExplicitAny: generic registerTool
  public registerTool<TArgs = any, TResult = any>(
    tool: McpToolDefinition<TArgs, TResult>,
  ): this {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool definition must include a valid non-empty name.');
    }
    if (typeof tool.handler !== 'function') {
      throw new Error(
        `Tool '${tool.name}' must provide an executable handler function.`,
      );
    }
    const inputSchema: McpToolInputSchema = tool.inputSchema || {
      type: 'object',
      properties: {},
    };

    this.tools.set(tool.name, {
      ...tool,
      inputSchema,
    });
    return this;
  }

  /**
   * Registers multiple MCP tools in bulk.
   */
  public registerTools(tools: McpToolDefinition[]): this {
    if (Array.isArray(tools)) {
      for (const t of tools) {
        this.registerTool(t);
      }
    }
    return this;
  }

  /**
   * Returns the count of registered tools.
   */
  public get size(): number {
    return this.tools.size;
  }

  /**
   * Unregisters a previously registered tool by name.
   */
  public unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Checks if a tool is registered.
   */
  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Gets a registered tool definition by name.
   */
  public getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns a list of all registered tools in MCP standard format.
   */
  public listTools(): McpTool[] {
    return Array.from(this.tools.values()).map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }),
    );
  }

  /**
   * Clears all registered tools from the bridge.
   */
  public clear(): void {
    this.tools.clear();
  }

  /**
   * Converts all registered tools into OpenAI / Unified standard ToolDefinition[] format.
   * Can be passed directly into client.chat.completions.create({ tools: bridge.getTools() }).
   */
  public toUnifiedTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) =>
      McpToolBridge.toToolDefinition(tool),
    );
  }

  /**
   * Alias for toUnifiedTools().
   */
  public getTools(): ToolDefinition[] {
    return this.toUnifiedTools();
  }

  /**
   * Static helper: converts an MCP Tool to an OpenAI / Unified ToolDefinition.
   */
  public static toToolDefinition(mcpTool: McpTool): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema as Record<string, unknown>,
      },
    };
  }

  /**
   * Static helper: converts an OpenAI / Unified ToolDefinition to an MCP Tool.
   */
  public static fromToolDefinition(tool: ToolDefinition): McpTool {
    return {
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: (tool.function.parameters as McpToolInputSchema) || {
        type: 'object',
        properties: {},
      },
    };
  }

  /**
   * Safely formats any raw handler return value into standard McpContent[].
   */
  // biome-ignore lint/suspicious/noExplicitAny: raw format helper
  private formatContentResult(rawResult: any): McpContent[] {
    if (rawResult === null || rawResult === undefined) {
      return [{ type: 'text', text: '' }];
    }
    if (typeof rawResult === 'string') {
      return [{ type: 'text', text: rawResult }];
    }
    if (
      typeof rawResult === 'object' &&
      Array.isArray(rawResult.content) &&
      rawResult.content.every(
        (c: { type?: string }) => typeof c?.type === 'string',
      )
    ) {
      return rawResult.content as McpContent[];
    }
    if (
      typeof rawResult === 'object' &&
      typeof rawResult.type === 'string' &&
      (rawResult.type === 'text' ||
        rawResult.type === 'image' ||
        rawResult.type === 'resource')
    ) {
      return [rawResult as McpContent];
    }
    return [{ type: 'text', text: JSON.stringify(rawResult, null, 2) }];
  }

  /**
   * Executes a single ToolCall returned by an LLM.
   * Handles JSON argument parsing, handler invocation, and catches errors gracefully.
   */
  public async executeToolCall(
    call: ToolCall,
    context?: McpToolContext,
  ): Promise<McpToolResult> {
    const toolName = call.function?.name;
    const rawArgs = call.function?.arguments;

    const toolDef = this.tools.get(toolName);
    if (!toolDef) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool '${toolName}' is not registered on this MCP bridge.`,
          },
        ],
        isError: true,
      };
    }

    // Parse arguments safely
    // biome-ignore lint/suspicious/noExplicitAny: parsed args
    let parsedArgs: any = {};
    if (rawArgs && typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
      try {
        parsedArgs = extractJsonFromText(rawArgs);
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid JSON arguments for tool '${toolName}': ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    } else if (typeof rawArgs === 'object' && rawArgs !== null) {
      parsedArgs = rawArgs;
    }

    if (context?.signal?.aborted) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool '${toolName}' execution aborted by client signal.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const mergedContext: McpToolContext = {
        ...context,
        toolCallId: call.id,
      };

      const timeoutMs = toolDef.timeoutMs ?? context?.timeoutMs;
      // biome-ignore lint/suspicious/noExplicitAny: raw handler result
      let rawResult: any;

      if (timeoutMs && timeoutMs > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms.`),
              );
            }, timeoutMs);
          });
          rawResult = await Promise.race([
            toolDef.handler(parsedArgs, mergedContext),
            timeoutPromise,
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        rawResult = await toolDef.handler(parsedArgs, mergedContext);
      }

      const isError =
        typeof rawResult === 'object' && rawResult !== null
          ? rawResult.isError === true
          : false;

      return {
        content: this.formatContentResult(rawResult),
        isError,
        _raw: rawResult,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool '${toolName}': ${(err as Error).message}`,
          },
        ],
        isError: true,
        _raw: err,
      };
    }
  }

  /**
   * Executes an array of ToolCalls concurrently and maps them directly into
   * standard OpenAI-compatible ChatMessage[] objects with role: 'tool'.
   */
  public async executeToolCalls(
    calls: ToolCall[],
    context?: McpToolContext,
  ): Promise<ChatMessage[]> {
    if (!calls || calls.length === 0) return [];

    const results = await Promise.all(
      calls.map(async (call) => {
        const result = await this.executeToolCall(call, context);
        const textContent = result.content
          .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'image') return `[Image: ${part.mimeType}]`;
            if (part.type === 'resource')
              return `[Resource: ${part.resource.uri}]`;
            return JSON.stringify(part);
          })
          .join('\n');

        const message: ChatMessage = {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function?.name,
          content: textContent,
        };
        return message;
      }),
    );

    return results;
  }

  /**
   * Processes a standard Model Context Protocol (MCP) JSON-RPC 2.0 request.
   * Supports:
   * - 'tools/list': lists registered tools
   * - 'tools/call': executes a tool by name with arguments
   * - 'ping': liveness probe
   */
  public async handleJsonRpc(
    request: McpJsonRpcRequest | string,
  ): Promise<McpJsonRpcResponse> {
    let req: McpJsonRpcRequest;
    if (typeof request === 'string') {
      try {
        req = JSON.parse(request);
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${(err as Error).message}`,
          },
        };
      }
    } else {
      req = request;
    }

    if (req?.jsonrpc !== '2.0' || !req?.method) {
      return {
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid Request: missing jsonrpc 2.0 or method.',
        },
      };
    }

    const { id, method, params } = req;

    switch (method) {
      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.listTools(),
          },
        };
      }

      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'sinapsai-mcp',
              version: '2.9.0',
            },
          },
        };
      }

      case 'notifications/initialized': {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {},
        };
      }

      case 'tools/call': {
        const name = params?.name;
        const toolDef = this.tools.get(name);
        if (!name || !toolDef) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method or tool not found: ${name}`,
            },
          };
        }

        const args = params?.arguments || {};
        const call: ToolCall = {
          id: String(id ?? Date.now()),
          type: 'function',
          function: {
            name,
            arguments: typeof args === 'string' ? args : JSON.stringify(args),
          },
        };

        const result = await this.executeToolCall(call, {
          meta: params?.meta,
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: result.content,
            isError: result.isError,
          },
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  }
}
