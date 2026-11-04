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
});
