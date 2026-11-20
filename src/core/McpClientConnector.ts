/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Universal Model Context Protocol (MCP) Client Ingestion Connector
 *
 * Implements:
 * 1. External MCP Server discovery and tool ingestion via JSON-RPC 2.0.
 * 2. Multi-transport support:
 *    - 'http' / 'sse': Standard Web-compliant JSON-RPC over HTTP/SSE (Edge & Serverless compatible).
 *    - 'stdio': Subprocess transport over stdin/stdout for Node.js / Bun / Desktop environments.
 * 3. Automatic bidirectional conversion from external MCP tool definitions into
 *    SinapsAI / OpenAI ToolDefinition instances.
 * 4. Automatic tool name namespace prefixing (e.g. `github_create_issue` or `postgres_query`).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { parseSSE } from '../utils/stream.js';
import { SINAPSAI_VERSION } from '../version.js';
import { AutonomousDriftHealer } from './AutonomousDriftHealer.js';
import {
  MCP_PROTOCOL_VERSION,
  type McpContent,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpTool,
  type McpToolContext,
  type McpToolDefinition,
  type McpToolResult,
} from './McpBridge.js';

export interface ExternalMcpServerConfig {
  /**
   * Unique namespace name for this server (e.g. 'github', 'postgres', 'brave_search').
   */
  name: string;
  /**
   * Transport mechanism:
   * - 'streamable-http': Modern MCP Streamable HTTP (`2025-06-18`) with session ID & SSE support.
   * - 'http' | 'sse': Standard Web-compliant JSON-RPC over HTTP/SSE (Edge & Serverless compatible).
   * - 'stdio': Command line subprocess via stdin/stdout (Node.js & Bun only).
   */
  transport: 'http' | 'streamable-http' | 'sse' | 'stdio';
  /**
   * Command to execute for stdio transport (e.g. 'npx', 'node', 'python').
   */
  command?: string;
  /**
   * Command arguments for stdio transport (e.g. ['-y', '@modelcontextprotocol/server-postgres']).
   */
  args?: string[];
  /**
   * Optional environment variables for the stdio process.
   */
  env?: Record<string, string>;
  /**
   * URL for 'http', 'streamable-http', or 'sse' transport.
   */
  url?: string;
  /**
   * Optional HTTP headers (e.g. Authorization tokens).
   */
  headers?: Record<string, string>;
  /**
   * When true, automatically prefixes tool names with `${name}_<tool_name>` to avoid collisions.
   * Default: true
   */
  prefixTools?: boolean;
  /**
   * Default execution timeout in milliseconds.
   */
  timeoutMs?: number;
}

export class McpClientConnector {
  /**
   * Connects to an external MCP server, completes the initialize handshake,
   * fetches available tools, and returns registered McpToolDefinition instances.
   */
  public async connect(
    config: ExternalMcpServerConfig,
  ): Promise<McpToolDefinition[]> {
    return McpClientConnector.ingestServer(config);
  }

  /**
   * Connects to an external MCP server, completes the initialize handshake,
   * fetches available tools, and returns registered McpToolDefinition instances.
   */
  public static async ingestServer(
    config: ExternalMcpServerConfig,
  ): Promise<McpToolDefinition[]> {
    if (config.transport === 'stdio') {
      return McpClientConnector.ingestStdioServer(config);
    }
    return McpClientConnector.ingestHttpServer(config);
  }

  /**
   * Ingests tools from an HTTP / Streamable-HTTP / SSE MCP server using standard fetch.
   */
  private static async ingestHttpServer(
    config: ExternalMcpServerConfig,
  ): Promise<McpToolDefinition[]> {
    if (!config.url) {
      throw new Error(
        `MCP HTTP transport for "${config.name}" requires a valid "url".`,
      );
    }

    const endpoint = config.url;
    let rpcId = 1;
    let sessionId: string | undefined;
    let negotiatedProtocolVersion = MCP_PROTOCOL_VERSION;

    const parseJsonRpcHttpResponse = async (
      res: Response,
      targetId?: number | string,
    ): Promise<McpJsonRpcResponse> => {
      const incomingSessionId = res.headers?.get?.('mcp-session-id');
      if (incomingSessionId) {
        sessionId = incomingSessionId;
      }

      const contentType = res.headers?.get?.('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        let fallbackResponse: McpJsonRpcResponse | undefined;
        for await (const evt of parseSSE(res)) {
          if (!evt.data || evt.data.trim() === '[DONE]') continue;
          try {
            const parsed = JSON.parse(evt.data) as McpJsonRpcResponse;
            if (targetId !== undefined && parsed.id === targetId) {
              return parsed;
            }
            if (parsed.result !== undefined || parsed.error !== undefined) {
              fallbackResponse = parsed;
            }
          } catch {
            // ignore non-JSON SSE keepalives
          }
        }
        if (fallbackResponse) {
          return fallbackResponse;
        }
        throw new Error(
          `MCP server "${config.name}" returned an empty SSE stream.`,
        );
      }

      return (await res.json()) as McpJsonRpcResponse;
    };

    const callRpc = async (
      method: string,
      params?: Record<string, unknown>,
    ): Promise<unknown> => {
      const id = rpcId++;
      const payload: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': negotiatedProtocolVersion,
        ...(config.headers || {}),
      };
      if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(
          `MCP server "${config.name}" HTTP error: ${res.status} ${res.statusText}`,
        );
      }

      const json = await parseJsonRpcHttpResponse(res, id);
      if (json.error) {
        throw new Error(
          `MCP RPC error [${json.error.code}]: ${json.error.message}`,
        );
      }

      return json.result;
    };

    const sendNotification = async (
      method: string,
      params?: Record<string, unknown>,
    ): Promise<void> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': negotiatedProtocolVersion,
        ...(config.headers || {}),
      };
      if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
      }
      await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          ...(params ? { params } : {}),
        }),
      });
    };

    // 1. Initialize Handshake
    const initResult = (await callRpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'SinapsAI', version: SINAPSAI_VERSION },
    })) as { protocolVersion?: string } | undefined;

    if (initResult?.protocolVersion) {
      negotiatedProtocolVersion = initResult.protocolVersion;
    }

    if (config.transport === 'streamable-http') {
      await sendNotification('notifications/initialized');
    }

    // 2. Discover Tools
    const listRes = (await callRpc('tools/list')) as { tools?: McpTool[] };
    const rawTools = listRes?.tools || [];

    // 3. Map into McpToolDefinition
    return rawTools.map((t): McpToolDefinition => {
      const toolName =
        config.prefixTools !== false ? `${config.name}_${t.name}` : t.name;

      return {
        name: toolName,
        description: t.description || `MCP Tool from ${config.name}`,
        inputSchema: t.inputSchema,
        timeoutMs: config.timeoutMs,
        handler: async (
          args: Record<string, unknown>,
          _context?: McpToolContext,
        ): Promise<McpToolResult> => {
          // Autonomous parameter healing before remote dispatch
          const healed = AutonomousDriftHealer.healToolArguments(
            args,
            t.inputSchema,
          );

          try {
            const result = (await callRpc('tools/call', {
              name: t.name, // call with remote tool's original name
              arguments: healed.healedArgs,
            })) as { content?: McpContent[]; isError?: boolean };

            return {
              content: result?.content || [
                { type: 'text', text: JSON.stringify(result) },
              ],
              isError: Boolean(result?.isError),
              selfHealingHint: healed.driftDetected
                ? `Note: Tool arguments were automatically healed from schema drift.`
                : undefined,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed executing remote tool "${t.name}" on MCP server "${config.name}": ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }
        },
      };
    });
  }

  /**
   * Ingests tools from a local subprocess MCP server communicating over stdio.
   */
  private static async ingestStdioServer(
    config: ExternalMcpServerConfig,
  ): Promise<McpToolDefinition[]> {
    if (typeof process === 'undefined' || !process.versions?.node) {
      throw new Error(
        `MCP Stdio transport is only supported in Node.js and Bun environments.`,
      );
    }

    if (!config.command) {
      throw new Error(
        `MCP Stdio transport for "${config.name}" requires a valid "command".`,
      );
    }

    // Dynamic import to avoid breaking edge runtimes
    const { spawn } = await import('node:child_process');
    const { createInterface } = await import('node:readline');

    const proc = spawn(config.command, config.args || [], {
      env: { ...process.env, ...(config.env || {}) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const pendingRequests = new Map<
      string | number,
      { resolve: (val: unknown) => void; reject: (err: Error) => void }
    >();

    let rpcId = 1;

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as McpJsonRpcResponse;
        if (
          msg.id !== undefined &&
          msg.id !== null &&
          pendingRequests.has(msg.id)
        ) {
          const handler = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          if (handler) {
            if (msg.error) {
              handler.reject(new Error(`MCP RPC error: ${msg.error.message}`));
            } else {
              handler.resolve(msg.result);
            }
          }
        }
      } catch {
        // Non-JSON stdout lines ignored
      }
    });

    const callRpc = (
      method: string,
      params?: Record<string, unknown>,
    ): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const id = rpcId++;
        pendingRequests.set(id, { resolve, reject });

        const req: McpJsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };

        proc.stdin.write(`${JSON.stringify(req)}\n`);
      });
    };

    // 1. Initialize
    await callRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'SinapsAI', version: SINAPSAI_VERSION },
    });

    // 2. Discover Tools
    const listRes = (await callRpc('tools/list')) as { tools?: McpTool[] };
    const rawTools = listRes?.tools || [];

    return rawTools.map((t): McpToolDefinition => {
      const toolName =
        config.prefixTools !== false ? `${config.name}_${t.name}` : t.name;

      return {
        name: toolName,
        description: t.description || `MCP Tool from ${config.name}`,
        inputSchema: t.inputSchema,
        timeoutMs: config.timeoutMs,
        handler: async (
          args: Record<string, unknown>,
        ): Promise<McpToolResult> => {
          const healed = AutonomousDriftHealer.healToolArguments(
            args,
            t.inputSchema,
          );

          try {
            const res = (await callRpc('tools/call', {
              name: t.name,
              arguments: healed.healedArgs,
            })) as { content?: McpContent[]; isError?: boolean };

            return {
              content: res?.content || [
                { type: 'text', text: JSON.stringify(res) },
              ],
              isError: Boolean(res?.isError),
              selfHealingHint: healed.driftDetected
                ? 'Tool arguments were automatically healed from schema drift.'
                : undefined,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Subprocess tool execution error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }
        },
      };
    });
  }
}
