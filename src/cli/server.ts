/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Standalone Local Gateway HTTP Server (OpenAI-Compatible)
 *
 * Implements:
 * 1. Zero-dependency native Node.js HTTP server.
 * 2. OpenAI-compatible endpoints: /v1/chat/completions (streaming & non-streaming), /v1/embeddings, /v1/models.
 * 3. Health check probe: /health.
 * 4. OpenMetrics / Prometheus exporter: /metrics.
 * 5. In-process circuit breaking, rate limiting, and multi-provider failover.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import http from 'node:http';
import { FrontierModelRegistry } from '../core/FrontierModelRegistry.js';
import { MCP_PROTOCOL_VERSION } from '../core/McpBridge.js';
import type { SinapsClient } from '../core/SinapsClient.js';
import type {
  ChatMessage,
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
  UnifiedApiResponse,
} from '../types/index.js';

export interface GatewayServerOptions {
  port?: number;
  host?: string;
  client: SinapsClient;
  apiKey?: string;
  /**
   * Enforces multi-tenant virtual API keys managed by `client.virtualKeys`.
   * Automatically enforces Model ACLs, FinOps USD budgets, and RPM/TPM limits.
   */
  enforceVirtualKeys?: boolean;
}

export function createGatewayServer(
  options: GatewayServerOptions,
): http.Server {
  const { client, apiKey, enforceVirtualKeys } = options;

  return http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key, MCP-Protocol-Version, Mcp-Session-Id',
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`,
    );
    const pathname = url.pathname;

    const authHeader = req.headers.authorization || '';
    const headerApiKey = req.headers['x-api-key'];
    const providedKey =
      authHeader.replace(/^Bearer\s+/i, '').trim() ||
      (typeof headerApiKey === 'string' ? headerApiKey.trim() : '');

    // Multi-tenant Virtual Key Admin API (/v1/keys)
    const isKeyAdminRoute =
      pathname === '/v1/keys' || pathname.startsWith('/v1/keys/');

    if (isKeyAdminRoute) {
      if (apiKey && providedKey !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Unauthorized: Master API Key required' },
          }),
        );
        return;
      }

      if (pathname === '/v1/keys' && req.method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') || undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: client.virtualKeys.listKeys(tenantId),
          }),
        );
        return;
      }

      if (pathname === '/v1/keys' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          const issued = await client.virtualKeys.issueKey(body);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(issued));
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message } }));
          return;
        }
      }

      const revokeMatch = pathname.match(/^\/v1\/keys\/([^/]+)\/revoke$/);
      if (revokeMatch && req.method === 'POST') {
        const revoked = client.virtualKeys.revokeKey(revokeMatch[1]);
        res.writeHead(revoked ? 200 : 404, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            revoked
              ? { revoked: true, id: revokeMatch[1] }
              : { error: { message: 'Virtual key not found' } },
          ),
        );
        return;
      }

      const rotateMatch = pathname.match(/^\/v1\/keys\/([^/]+)\/rotate$/);
      if (rotateMatch && req.method === 'POST') {
        const rotated = await client.virtualKeys.rotateKey(rotateMatch[1]);
        res.writeHead(rotated ? 200 : 404, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify(
            rotated ?? { error: { message: 'Virtual key not found' } },
          ),
        );
        return;
      }
    }

    // Helper for model-aware Virtual Key authorization on inference endpoints
    const isModelInferenceRoute =
      req.method === 'POST' &&
      (pathname === '/v1/chat/completions' ||
        pathname === '/v1/responses' ||
        pathname === '/v1/embeddings');

    const shouldCheckVirtualKey =
      (enforceVirtualKeys || client.virtualKeys.hasKeys()) &&
      pathname !== '/health' &&
      pathname !== '/metrics';

    let authorizedVirtualKeyId: string | undefined;

    const authorizeVirtualKey = async (model?: string): Promise<boolean> => {
      if (!shouldCheckVirtualKey) return true;
      if (apiKey && providedKey === apiKey) return true;
      const auth = await client.virtualKeys.authorizeRequest(providedKey, {
        model,
      });
      if (!auth.allowed) {
        res.writeHead(auth.statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: auth.reason || 'Unauthorized: Invalid Virtual API Key',
              code: auth.statusCode,
            },
          }),
        );
        return false;
      }
      authorizedVirtualKeyId = auth.keyId;
      return true;
    };

    if (!isModelInferenceRoute) {
      if (shouldCheckVirtualKey && (!apiKey || providedKey !== apiKey)) {
        const ok = await authorizeVirtualKey();
        if (!ok) return;
      } else if (apiKey && providedKey !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Unauthorized: Invalid API Key' },
          }),
        );
        return;
      }
    } else if (!shouldCheckVirtualKey && apiKey && providedKey !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Unauthorized: Invalid API Key' },
        }),
      );
      return;
    }

    // Health Probe
    if (pathname === '/health' && req.method === 'GET') {
      const health = await client.checkHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    // Prometheus / OpenMetrics Metrics
    if (pathname === '/metrics' && req.method === 'GET') {
      const metricsText = client.exportPrometheusMetrics();
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(metricsText);
      return;
    }

    // List Frontier Models
    if (pathname === '/v1/models' && req.method === 'GET') {
      const models = FrontierModelRegistry.list().map((m) => ({
        id: m.id,
        object: 'model',
        owned_by: m.provider,
        tier: m.tier,
        context_window: m.contextWindow,
        max_output_tokens: m.maxOutputTokens,
        capabilities: m.capabilities,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    // OpenAI Responses API (/v1/responses)
    if (pathname === '/v1/responses' && req.method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText) as Record<string, unknown>;
        const targetModel = String(body.model || 'gpt-5.6-sol-medium');
        if (!(await authorizeVirtualKey(targetModel))) return;
        const messages: ChatMessage[] = [];
        if (typeof body.instructions === 'string' && body.instructions) {
          messages.push({ role: 'system', content: body.instructions });
        }
        if (typeof body.input === 'string') {
          messages.push({ role: 'user', content: body.input });
        } else if (Array.isArray(body.input)) {
          for (const item of body.input) {
            if (typeof item === 'string') {
              messages.push({ role: 'user', content: item });
            } else if (item && typeof item === 'object') {
              const rec = item as Record<string, unknown>;
              messages.push({
                role: (rec.role as ChatMessage['role']) || 'user',
                content:
                  typeof rec.content === 'string'
                    ? rec.content
                    : JSON.stringify(rec.content ?? ''),
              });
            }
          }
        }

        const reasoning = body.reasoning as { effort?: string } | undefined;
        const textCfg = body.text as
          | { format?: Record<string, unknown>; verbosity?: string }
          | undefined;

        const baseReq = {
          model: String(body.model || 'gpt-5.6-sol-medium'),
          messages,
          maxTokens:
            typeof body.max_output_tokens === 'number'
              ? body.max_output_tokens
              : undefined,
          temperature:
            typeof body.temperature === 'number' ? body.temperature : undefined,
          reasoningEffort:
            reasoning?.effort as CreateChatCompletionRequestNonStreaming['reasoningEffort'],
          verbosity:
            textCfg?.verbosity as CreateChatCompletionRequestNonStreaming['verbosity'],
          responseFormat:
            textCfg?.format as CreateChatCompletionRequestNonStreaming['responseFormat'],
          tools: body.tools as CreateChatCompletionRequestNonStreaming['tools'],
        };

        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          const responseId = `resp_${Date.now()}`;
          res.write(
            `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: responseId, object: 'response', status: 'in_progress', model: baseReq.model } })}\n\n`,
          );

          const stream = await client.chat.completions.create({
            ...baseReq,
            stream: true,
          } as CreateChatCompletionRequestStreaming);

          let accumulatedText = '';
          let finalUsage: Record<string, unknown> | undefined;
          for await (const chunk of stream) {
            const deltaText = chunk.choices?.[0]?.delta?.content;
            if (deltaText) {
              accumulatedText += deltaText;
              res.write(
                `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', item_id: `msg_${responseId}`, output_index: 0, content_index: 0, delta: deltaText })}\n\n`,
              );
            }
            if (chunk.usage) {
              finalUsage = {
                input_tokens: chunk.usage.promptTokens,
                output_tokens: chunk.usage.completionTokens,
                total_tokens: chunk.usage.totalTokens,
                output_tokens_details: {
                  reasoning_tokens: chunk.usage.reasoningTokens ?? 0,
                },
              };
            }
          }

          res.write(
            `event: response.completed\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                id: responseId,
                object: 'response',
                status: 'completed',
                model: baseReq.model,
                output_text: accumulatedText,
                usage: finalUsage,
              },
            })}\n\n`,
          );
          res.end();
          return;
        }

        const apiRes = (await client.chat.completions.create({
          ...baseReq,
          stream: false,
        } as CreateChatCompletionRequestNonStreaming)) as UnifiedApiResponse;

        const msg = apiRes.choices?.[0]?.message;
        const outputText = msg?.content || '';
        const responseId = apiRes.id || `resp_${Date.now()}`;
        const output: Array<Record<string, unknown>> = [];
        if (msg?.reasoning_content) {
          output.push({
            id: `rs_${responseId}`,
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: msg.reasoning_content }],
          });
        }
        output.push({
          id: `msg_${responseId}`,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: outputText, annotations: [] }],
        });
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            output.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: responseId,
            object: 'response',
            status: 'completed',
            model: apiRes.model || baseReq.model,
            output_text: outputText,
            output,
            usage: apiRes.usage
              ? {
                  input_tokens: apiRes.usage.promptTokens,
                  output_tokens: apiRes.usage.completionTokens,
                  total_tokens: apiRes.usage.totalTokens,
                  input_tokens_details: {
                    cached_tokens: apiRes.usage.cachedPromptTokens ?? 0,
                  },
                  output_tokens_details: {
                    reasoning_tokens: apiRes.usage.reasoningTokens ?? 0,
                  },
                }
              : undefined,
          }),
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message, type: 'sinapsai_responses_error' },
          }),
        );
        return;
      }
    }

    // Streamable HTTP MCP Endpoint (POST /mcp)
    if (pathname === '/mcp' && req.method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const rpcRequest = JSON.parse(bodyText);
        const rpcResponse = await client.mcp.handleJsonRpc(rpcRequest);
        const sessionHeader =
          (req.headers['mcp-session-id'] as string | undefined) ||
          `sinaps-mcp-${Date.now()}`;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          'Mcp-Session-Id': sessionHeader,
        });
        res.end(JSON.stringify(rpcResponse));
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message },
          }),
        );
        return;
      }
    }

    // Chat Completions
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText);
        if (!(await authorizeVirtualKey(body.model))) return;

        if (body.stream) {
          // SSE Streaming Response
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          const stream = await client.chat.completions.create(
            body as CreateChatCompletionRequestStreaming,
          );
          let streamTokens = 0;
          let streamCostUsd = 0;
          for await (const chunk of stream) {
            if (chunk.usage) {
              streamTokens = chunk.usage.totalTokens || 0;
              streamCostUsd = FrontierModelRegistry.estimateCost(
                chunk.model || body.model || '',
                chunk.usage,
              );
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          if (
            authorizedVirtualKeyId &&
            (streamCostUsd > 0 || streamTokens > 0)
          ) {
            client.virtualKeys.recordSpend(
              authorizedVirtualKeyId,
              streamCostUsd,
              streamTokens,
            );
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Non-streaming Response
        const response = await client.chat.completions.create(
          body as CreateChatCompletionRequestNonStreaming,
        );
        if (authorizedVirtualKeyId && response.usage) {
          const costUsd = FrontierModelRegistry.estimateCost(
            response.model || body.model || '',
            response.usage,
          );
          client.virtualKeys.recordSpend(
            authorizedVirtualKeyId,
            costUsd,
            response.usage.totalTokens || 0,
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message, type: 'sinapsai_gateway_error' },
          }),
        );
        return;
      }
    }

    // Embeddings
    if (pathname === '/v1/embeddings' && req.method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText);
        if (!(await authorizeVirtualKey(body.model))) return;
        const response = await client.embeddings.create(body);
        if (authorizedVirtualKeyId && response.usage) {
          const costUsd = FrontierModelRegistry.estimateCost(
            response.model || body.model || '',
            {
              promptTokens: response.usage.promptTokens || 0,
              completionTokens: 0,
            },
          );
          client.virtualKeys.recordSpend(
            authorizedVirtualKeyId,
            costUsd,
            response.usage.totalTokens || 0,
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message, type: 'sinapsai_embeddings_error' },
          }),
        );
        return;
      }
    }

    // 404 Fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Not Found: ${pathname}` } }));
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
