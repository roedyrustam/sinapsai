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
import type { SinapsClient } from '../core/SinapsClient.js';
import type {
  CreateChatCompletionRequestNonStreaming,
  CreateChatCompletionRequestStreaming,
} from '../types/index.js';

export interface GatewayServerOptions {
  port?: number;
  host?: string;
  client: SinapsClient;
  apiKey?: string;
}

export function createGatewayServer(
  options: GatewayServerOptions,
): http.Server {
  const { client, apiKey } = options;

  return http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key',
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

    // Optional API key authorization
    if (apiKey) {
      const authHeader = req.headers.authorization || '';
      const providedKey =
        authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
      if (providedKey !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Unauthorized: Invalid API Key' },
          }),
        );
        return;
      }
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

    // List Models
    if (pathname === '/v1/models' && req.method === 'GET') {
      const models = [
        { id: 'gemini-2.5-flash', object: 'model', owned_by: 'google' },
        { id: 'gemini-2.5-pro', object: 'model', owned_by: 'google' },
        { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
        { id: 'claude-3-7-sonnet', object: 'model', owned_by: 'anthropic' },
        { id: 'llama-3.3-70b-versatile', object: 'model', owned_by: 'groq' },
        { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    // Chat Completions
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText);

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
          for await (const chunk of stream) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Non-streaming Response
        const response = await client.chat.completions.create(
          body as CreateChatCompletionRequestNonStreaming,
        );
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
        const response = await client.embeddings.create(body);
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
