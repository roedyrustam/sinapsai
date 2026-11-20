import { describe, expect, it, vi } from 'vitest';
import { type McpTextContent, McpToolBridge } from './McpBridge.js';

describe('McpClientConnector (Universal External MCP Ingestion)', () => {
  it('ingests external tools over HTTP via JSON-RPC 2.0 handshake', async () => {
    // Mock global fetch for external MCP server
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);

      if (body.method === 'initialize') {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'mock-github-server', version: '1.0.0' },
            },
          }),
        };
      }

      if (body.method === 'tools/list') {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                {
                  name: 'create_issue',
                  description: 'Creates a GitHub issue.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      body: { type: 'string' },
                    },
                    required: ['title'],
                  },
                },
              ],
            },
          }),
        };
      }

      if (body.method === 'tools/call') {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Issue "${body.params.arguments.title}" created successfully with ID #42.`,
                },
              ],
            },
          }),
        };
      }

      return {
        ok: false,
        status: 400,
        statusText: 'Unknown RPC method',
      };
    });

    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    try {
      const bridge = new McpToolBridge();
      const ingested = await bridge.connectExternalServer({
        name: 'github',
        transport: 'http',
        url: 'http://localhost:8000/mcp',
      });

      expect(ingested.length).toBe(1);
      expect(ingested[0].name).toBe('github_create_issue');
      expect(bridge.hasTool('github_create_issue')).toBe(true);

      // Execute tool call through bridge
      const callResult = await bridge.executeToolCall({
        id: 'call_1',
        type: 'function',
        function: {
          name: 'github_create_issue',
          arguments: JSON.stringify({ title: 'Bug in authentication' }),
        },
      });

      expect(callResult.isError).toBe(false);
      expect(callResult.content[0].type).toBe('text');
      expect((callResult.content[0] as McpTextContent).text).toContain(
        'Issue "Bug in authentication" created successfully',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('supports MCP 2025-06-18 streamable-http transport with Mcp-Session-Id, notifications/initialized & SSE responses', async () => {
    const seenMethods: string[] = [];
    const seenHeaders: Array<Record<string, string>> = [];

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenHeaders.push(headers);
      const body = JSON.parse(init?.body as string);
      seenMethods.push(body.method);

      if (body.method === 'initialize') {
        return {
          ok: true,
          headers: new Headers({
            'content-type': 'application/json',
            'mcp-session-id': 'sess-2025-06-18',
          }),
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'streamable-srv', version: '2.0.0' },
            },
          }),
        };
      }

      if (body.method === 'notifications/initialized') {
        return { ok: true, headers: new Headers(), json: async () => ({}) };
      }

      // Return SSE stream response for tools/list and tools/call
      const ssePayload =
        body.method === 'tools/list'
          ? {
              jsonrpc: '2.0',
              id: body.id,
              result: {
                tools: [
                  {
                    name: 'search_docs',
                    description: 'Search docs',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            }
          : {
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{ type: 'text', text: 'Found 3 matches' }],
              },
            };

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(ssePayload)}\n\n`,
              ),
            );
            controller.close();
          },
        }),
      };
    });

    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    try {
      const bridge = new McpToolBridge();
      const ingested = await bridge.connectExternalServer({
        name: 'docs',
        transport: 'streamable-http',
        url: 'http://localhost:8080/mcp',
      });

      expect(ingested.map((t) => t.name)).toEqual(['docs_search_docs']);
      expect(seenMethods).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/list',
      ]);
      expect(seenHeaders[0].Accept).toContain('text/event-stream');
      expect(seenHeaders[0]['MCP-Protocol-Version']).toBe('2025-06-18');
      expect(seenHeaders[2]['Mcp-Session-Id']).toBe('sess-2025-06-18');

      const result = await bridge.executeToolCall({
        id: 'call_sse',
        type: 'function',
        function: { name: 'docs_search_docs', arguments: '{}' },
      });
      expect((result.content[0] as McpTextContent).text).toBe(
        'Found 3 matches',
      );
      expect(seenHeaders[3]['Mcp-Session-Id']).toBe('sess-2025-06-18');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
