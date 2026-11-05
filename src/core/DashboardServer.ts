/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Embedded Local Metrics & Telemetry Web UI Dashboard
 *
 * Implements:
 * 1. Zero-dependency in-process HTTP server (node:http).
 * 2. Ultra-lightweight, responsive dark-mode Single Page Web UI.
 * 3. Real-time KPI metrics (RPM, Latency P50/Avg, Tokens, FinOps savings).
 * 4. Visual Provider & Circuit Breaker status monitor (CLOSED/HALF_OPEN/OPEN).
 * 5. Active Canary Prober health status inspection.
 * 6. Rolling request history and REST API endpoints (/api/metrics, /api/health, /api/history).
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import http from 'node:http';
import type { SinapsMetrics } from '../types/index.js';
import type { CanaryProviderHealth } from './CanaryProber.js';
import type { SinapsClient } from './SinapsClient.js';

export interface DashboardRequestLog {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cached: boolean;
  costUsd: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface DashboardServerOptions {
  client: SinapsClient;
  port?: number;
  host?: string;
  authKey?: string;
  title?: string;
  maxHistory?: number;
}

export class DashboardServer {
  private readonly client: SinapsClient;
  public readonly port: number;
  public readonly host: string;
  private readonly authKey?: string;
  private readonly title: string;
  private readonly maxHistory: number;
  private server: http.Server | null = null;
  private readonly history: DashboardRequestLog[] = [];
  private readonly startTime = Date.now();

  constructor(options: DashboardServerOptions) {
    this.client = options.client;
    this.port = options.port ?? 3140;
    this.host = options.host ?? '127.0.0.1';
    this.authKey = options.authKey;
    this.title = options.title ?? 'SinapsAI Control Plane';
    this.maxHistory = options.maxHistory ?? 100;
  }

  public get isRunning(): boolean {
    return Boolean(this.server?.listening);
  }

  public getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  public recordRequest(log: DashboardRequestLog): void {
    this.history.unshift(log);
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
  }

  public getHistory(): DashboardRequestLog[] {
    return [...this.history];
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve, reject) => {
      this.server?.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private isAuthorized(req: http.IncomingMessage, parsedUrl: URL): boolean {
    if (!this.authKey) return true;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.replace(/^Bearer\s+/i, '') === this.authKey) {
      return true;
    }

    const tokenParam = parsedUrl.searchParams.get('token');
    if (tokenParam === this.authKey) {
      return true;
    }

    return false;
  }

  private handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const parsedUrl = new URL(
      req.url || '/',
      `http://${req.headers.host || `${this.host}:${this.port}`}`,
    );

    // CORS headers for local tooling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this.isAuthorized(req, parsedUrl)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Unauthorized: invalid or missing auth token',
        }),
      );
      return;
    }

    const pathname = parsedUrl.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      this.serveDashboardHtml(res);
      return;
    }

    if (pathname === '/api/summary') {
      this.serveSummaryJson(res);
      return;
    }

    if (pathname === '/api/metrics') {
      this.serveMetricsJson(res);
      return;
    }

    if (pathname === '/api/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getHistory()));
      return;
    }

    if (pathname === '/api/health') {
      this.serveHealthJson(res);
      return;
    }

    if (pathname === '/api/prometheus') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(this.client.exportPrometheusMetrics());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
  }

  private serveSummaryJson(res: http.ServerResponse): void {
    const metrics: SinapsMetrics = this.client.getMetrics();
    const canaryHealth: Record<string, CanaryProviderHealth> =
      this.client.canary?.getAllHealth() ?? {};

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const summary = {
      title: this.title,
      version: '2.13.8',
      uptimeSeconds,
      strategy: this.client.getStrategy(),
      metrics: {
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        cachedRequests: metrics.cachedRequests,
        successRate:
          metrics.totalRequests > 0
            ? Number(
                (
                  (metrics.successfulRequests / metrics.totalRequests) *
                  100
                ).toFixed(1),
              )
            : 100,
        totalTokens: metrics.totalTokens,
        totalPromptTokens: metrics.totalPromptTokens,
        totalCompletionTokens: metrics.totalCompletionTokens,
        totalCachedPromptTokens: metrics.totalCachedPromptTokens ?? 0,
        estimatedCostUsd: metrics.estimatedCostUsd,
        llmoSavingsUsd: metrics.llmoMetrics?.totalEstimatedUsdSaved ?? 0,
        llmoTokensSaved: metrics.llmoMetrics?.totalTokensSaved ?? 0,
        providerMetrics: metrics.providerMetrics,
      },
      canary: canaryHealth,
      recentHistory: this.history.slice(0, 20),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  }

  private serveMetricsJson(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.client.getMetrics()));
  }

  private async serveHealthJson(res: http.ServerResponse): Promise<void> {
    try {
      const health = await this.client.checkHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message }));
    }
  }

  private serveDashboardHtml(res: http.ServerResponse): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.title}</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f293d;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --cyan: #06b6d4;
      --green: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
      --purple: #8b5cf6;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-online { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid var(--green); }
    .badge-degraded { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid var(--amber); }
    .badge-down { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid var(--red); }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      position: relative;
    }
    .card-title {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .card-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-main);
      font-family: var(--font-mono);
    }
    .card-sub {
      font-size: 12px;
      color: var(--cyan);
      margin-top: 4px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .providers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .provider-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .provider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .provider-name {
      font-size: 15px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--text-muted);
    }
    .stat-row span:last-child {
      color: var(--text-main);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th {
      background: rgba(31, 41, 61, 0.5);
      color: var(--text-muted);
      padding: 10px 12px;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-family: var(--font-mono);
    }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow-x: auto;
    }
    .tag {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .tag-success { background: rgba(16, 185, 129, 0.2); color: var(--green); }
    .tag-error { background: rgba(239, 68, 68, 0.2); color: var(--red); }
    .tag-cached { background: rgba(6, 182, 212, 0.2); color: var(--cyan); }
    .refresh-btn {
      background: var(--border);
      color: var(--text-main);
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .refresh-btn:hover { background: #2d3748; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1 style="font-size: 20px; font-weight: 700;">SinapsAI Gateway</h1>
      <span class="badge badge-online" id="status-badge">● ONLINE</span>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <span style="font-size: 12px; color: var(--text-muted);" id="uptime-text">Uptime: 0s</span>
      <button class="refresh-btn" onclick="fetchSummary()">↻ Refresh</button>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="card">
      <div class="card-title">Total Requests</div>
      <div class="card-value" id="kpi-requests">0</div>
      <div class="card-sub" id="kpi-success-rate">100% Success Rate</div>
    </div>
    <div class="card">
      <div class="card-title">Total Tokens</div>
      <div class="card-value" id="kpi-tokens">0</div>
      <div class="card-sub" id="kpi-cached-tokens">0 Cached</div>
    </div>
    <div class="card">
      <div class="card-title">Estimated Cost</div>
      <div class="card-value" id="kpi-cost">$0.0000</div>
      <div class="card-sub" id="kpi-savings">$0.0000 Saved (FinOps)</div>
    </div>
    <div class="card">
      <div class="card-title">Routing Strategy</div>
      <div class="card-value" style="font-size: 20px;" id="kpi-strategy">-</div>
      <div class="card-sub" id="kpi-active-providers">0 Configured</div>
    </div>
  </div>

  <div class="section-title">
    <span>Configured Providers & Health</span>
    <span style="font-size: 12px; color: var(--text-muted);">Canary Prober Active</span>
  </div>
  <div class="providers-grid" id="providers-container">
    <div style="color: var(--text-muted); font-size: 13px;">Loading providers...</div>
  </div>

  <div class="section-title">
    <span>Recent Request History</span>
    <span style="font-size: 12px; color: var(--text-muted);">Real-time Activity Log</span>
  </div>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Model</th>
          <th>Provider</th>
          <th>Tokens</th>
          <th>Latency</th>
          <th>Cost</th>
          <th>Cache</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="history-tbody">
        <tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No requests recorded yet.</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    async function fetchSummary() {
      try {
        const res = await fetch('/api/summary');
        if (!res.ok) return;
        const data = await res.json();
        renderDashboard(data);
      } catch (err) {
        console.error('Failed to fetch summary:', err);
      }
    }

    function renderDashboard(data) {
      document.getElementById('uptime-text').textContent = 'Uptime: ' + data.uptimeSeconds + 's';
      document.getElementById('kpi-requests').textContent = data.metrics.totalRequests.toLocaleString();
      document.getElementById('kpi-success-rate').textContent = data.metrics.successRate + '% Success Rate';
      document.getElementById('kpi-tokens').textContent = data.metrics.totalTokens.toLocaleString();
      document.getElementById('kpi-cached-tokens').textContent = (data.metrics.totalCachedPromptTokens || 0).toLocaleString() + ' Cached';
      document.getElementById('kpi-cost').textContent = '$' + data.metrics.estimatedCostUsd.toFixed(4);
      document.getElementById('kpi-savings').textContent = '$' + (data.metrics.llmoSavingsUsd || 0).toFixed(4) + ' Saved (FinOps)';
      document.getElementById('kpi-strategy').textContent = (data.strategy || 'adaptive').toUpperCase();

      const providers = Object.entries(data.metrics.providerMetrics || {});
      document.getElementById('kpi-active-providers').textContent = providers.length + ' Providers';

      const provContainer = document.getElementById('providers-container');
      if (providers.length === 0) {
        provContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">No active provider metrics yet.</div>';
      } else {
        provContainer.innerHTML = providers.map(([id, p]) => {
          const canary = (data.canary && data.canary[id]) ? data.canary[id].status : 'HEALTHY';
          const badgeClass = canary === 'HEALTHY' ? 'badge-online' : (canary === 'DEGRADED' ? 'badge-degraded' : 'badge-down');
          return \`
            <div class="provider-card">
              <div class="provider-header">
                <span class="provider-name">\${id}</span>
                <span class="badge \${badgeClass}">\${canary}</span>
              </div>
              <div class="stat-row">
                <span>Requests</span>
                <span>\${p.requests}</span>
              </div>
              <div class="stat-row">
                <span>Success / Failed</span>
                <span>\${p.successes} / \${p.failures}</span>
              </div>
              <div class="stat-row">
                <span>Avg Latency</span>
                <span>\${Math.round(p.averageLatencyMs || 0)}ms</span>
              </div>
              <div class="stat-row">
                <span>Total Tokens</span>
                <span>\${(p.totalTokens || 0).toLocaleString()}</span>
              </div>
            </div>
          \`;
        }).join('');
      }

      const historyTbody = document.getElementById('history-tbody');
      if (!data.recentHistory || data.recentHistory.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No requests recorded yet.</td></tr>';
      } else {
        historyTbody.innerHTML = data.recentHistory.map(req => {
          const time = new Date(req.timestamp).toLocaleTimeString();
          const statusTag = req.status === 'success' ? '<span class="tag tag-success">200 OK</span>' : '<span class="tag tag-error">ERROR</span>';
          const cacheTag = req.cached ? '<span class="tag tag-cached">HIT</span>' : '<span style="color: var(--text-muted);">-</span>';
          return \`
            <tr>
              <td>\${time}</td>
              <td style="color: var(--cyan);">\${req.model}</td>
              <td style="text-transform: capitalize;">\${req.provider}</td>
              <td>\${req.totalTokens.toLocaleString()}</td>
              <td>\${Math.round(req.latencyMs)}ms</td>
              <td>$\${req.costUsd.toFixed(5)}</td>
              <td>\${cacheTag}</td>
              <td>\${statusTag}</td>
            </tr>
          \`;
        }).join('');
      }
    }

    fetchSummary();
    setInterval(fetchSummary, 2000);
  </script>
</body>
</html>`;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(html);
  }
}
