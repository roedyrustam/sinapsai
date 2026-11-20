import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SinapsClient } from '../core/SinapsClient.js';
import type {
  Provider,
  UnifiedApiRequest,
  UnifiedApiResponse,
} from '../providers/Provider.js';
import { createGatewayServer } from './server.js';

class MockProvider implements Provider {
  id = 'mock-provider';
  name = 'Mock Provider';

  async generateContent(
    request: UnifiedApiRequest,
  ): Promise<UnifiedApiResponse> {
    return {
      id: 'chatcmpl-test',
      model: request.model || 'mock-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from SinapsAI Gateway Server!',
          },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    };
  }
}

describe('Standalone Gateway HTTP Server', () => {
  let server: http.Server;
  const port = 8999;
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    const client = new SinapsClient({
      providers: [new MockProvider()],
    });
    server = createGatewayServer({ client, port });
    await new Promise<void>((resolve) =>
      server.listen(port, '127.0.0.1', () => resolve()),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should respond to /health endpoint', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('healthy');
  });

  it('should respond to /metrics endpoint with Prometheus format', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('sinaps_requests_total');
  });

  it('should list models at /v1/models', async () => {
    const res = await fetch(`${baseUrl}/v1/models`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      object: string;
      data: Array<{ id: string }>;
    };
    expect(data.object).toBe('list');
    expect(data.data.length).toBeGreaterThan(0);
  });

  it('should process chat completions at /v1/chat/completions', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(data.choices[0].message.content).toBe(
      'Hello from SinapsAI Gateway Server!',
    );
  });

  it('serves FrontierModelRegistry models on /v1/models and supports POST /v1/responses and POST /mcp', async () => {
    const modelsRes = await fetch(`${baseUrl}/v1/models`);
    const modelsData = (await modelsRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(modelsData.data.some((m) => m.id === 'gemini-4-carbon')).toBe(true);
    expect(modelsData.data.some((m) => m.id === 'claude-sonnet-5-5')).toBe(
      true,
    );
    expect(modelsData.data.some((m) => m.id === 'gpt-5.6-sol-medium')).toBe(
      true,
    );

    const respRes = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-sol-medium',
        instructions: 'Be brief.',
        input: 'Ping responses',
        reasoning: { effort: 'high' },
      }),
    });
    expect(respRes.status).toBe(200);
    const respJson = (await respRes.json()) as {
      object: string;
      status: string;
      output_text: string;
    };
    expect(respJson.object).toBe('response');
    expect(respJson.status).toBe('completed');
    expect(respJson.output_text).toBe('Hello from SinapsAI Gateway Server!');

    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    });
    expect(mcpRes.status).toBe(200);
    expect(mcpRes.headers.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(mcpRes.headers.get('mcp-session-id')).toBeTruthy();
    const mcpJson = (await mcpRes.json()) as {
      result: { protocolVersion: string };
    };
    expect(mcpJson.result.protocolVersion).toBe('2025-06-18');
  });
});
