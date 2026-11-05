/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * DashboardServer Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { afterEach, describe, expect, it } from 'vitest';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { DashboardServer } from './DashboardServer.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { SinapsClient } from './SinapsClient.js';

describe('DashboardServer', () => {
  let server: DashboardServer | null = null;
  let client: SinapsClient | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (client) {
      client.stop();
      await client.stopDashboard();
      client = null;
    }
  });

  function createTestClient(): SinapsClient {
    return new SinapsClient({
      providers: [new OllamaProvider({ id: 'local-test' })],
      storage: new InMemoryStorage(),
    });
  }

  it('initializes with default options and starts/stops cleanly', async () => {
    client = createTestClient();
    // Use an ephemeral port e.g. 0 or a high test port to prevent collision
    const testPort = 13140;
    server = new DashboardServer({
      client,
      port: testPort,
      host: '127.0.0.1',
    });

    expect(server.isRunning).toBe(false);
    expect(server.getUrl()).toBe(`http://127.0.0.1:${testPort}`);

    await server.start();
    expect(server.isRunning).toBe(true);

    await server.stop();
    expect(server.isRunning).toBe(false);
  });

  it('serves dashboard HTML on GET /', async () => {
    client = createTestClient();
    const testPort = 13141;
    server = new DashboardServer({ client, port: testPort });
    await server.start();

    const res = await fetch(`http://127.0.0.1:${testPort}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('SinapsAI Gateway');
    expect(html).toContain('Total Requests');
    expect(html).toContain('fetchSummary()');
  });

  it('serves /api/summary JSON with metrics and canary status', async () => {
    client = createTestClient();
    const testPort = 13142;
    server = new DashboardServer({ client, port: testPort });
    await server.start();

    const res = await fetch(`http://127.0.0.1:${testPort}/api/summary`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.title).toBe('SinapsAI Control Plane');
    expect(data.version).toBeDefined();
    expect(typeof data.uptimeSeconds).toBe('number');
    expect(data.metrics).toBeDefined();
    expect(data.metrics.totalRequests).toBe(0);
  });

  it('serves /api/metrics and /api/prometheus', async () => {
    client = createTestClient();
    const testPort = 13143;
    server = new DashboardServer({ client, port: testPort });
    await server.start();

    const metricsRes = await fetch(`http://127.0.0.1:${testPort}/api/metrics`);
    expect(metricsRes.status).toBe(200);
    const metricsData = await metricsRes.json();
    expect(metricsData.totalRequests).toBe(0);

    const promRes = await fetch(`http://127.0.0.1:${testPort}/api/prometheus`);
    expect(promRes.status).toBe(200);
    const promText = await promRes.text();
    expect(promText).toContain('sinaps_requests_total');
  });

  it('records and returns request history on /api/history', async () => {
    client = createTestClient();
    const testPort = 13144;
    server = new DashboardServer({ client, port: testPort, maxHistory: 3 });
    await server.start();

    server.recordRequest({
      id: 'req_1',
      timestamp: Date.now(),
      model: 'qwen-2.5',
      provider: 'ollama',
      latencyMs: 120,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cached: false,
      costUsd: 0,
      status: 'success',
    });

    const res = await fetch(`http://127.0.0.1:${testPort}/api/history`);
    expect(res.status).toBe(200);
    const history = await res.json();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('req_1');
    expect(history[0].model).toBe('qwen-2.5');
  });

  it('enforces authKey when configured', async () => {
    client = createTestClient();
    const testPort = 13145;
    server = new DashboardServer({
      client,
      port: testPort,
      authKey: 'secret-token-123',
    });
    await server.start();

    // Unauthorized request
    const unauthRes = await fetch(`http://127.0.0.1:${testPort}/api/summary`);
    expect(unauthRes.status).toBe(401);

    // Authorized via Header
    const authHeaderRes = await fetch(
      `http://127.0.0.1:${testPort}/api/summary`,
      {
        headers: { Authorization: 'Bearer secret-token-123' },
      },
    );
    expect(authHeaderRes.status).toBe(200);

    // Authorized via Query Param
    const authParamRes = await fetch(
      `http://127.0.0.1:${testPort}/api/summary?token=secret-token-123`,
    );
    expect(authParamRes.status).toBe(200);
  });

  it('integrates seamlessly with client startDashboard and stopDashboard', async () => {
    client = createTestClient();
    const dash = await client.startDashboard({ port: 13146 });
    expect(dash.isRunning).toBe(true);
    expect(client.dashboard).toBe(dash);

    const res = await fetch('http://127.0.0.1:13146/api/summary');
    expect(res.status).toBe(200);

    await client.stopDashboard();
    expect(dash.isRunning).toBe(false);
  });
});
