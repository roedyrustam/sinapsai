/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 26: In-Process Gateway Rate Limiting & Prometheus/OTel Metrics Export
 *
 * Demonstrates:
 * 1. Setting up gateway-level in-process rate limiting (sliding-window RPM and TPM).
 * 2. Scoped rate limiting rules per-model or per-user.
 * 3. Exporting native Prometheus / OpenMetrics exposition format without dependencies.
 * 4. Exporting native OpenTelemetry (OTLP v1 JSON) metrics for Datadog, Grafana, or collector agents.
 */

import {
  AnthropicProvider,
  GatewayRateLimitError,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'sk-demo',
      }),
      new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-demo',
      }),
    ],
    // Gateway-level rate limiting
    rateLimiting: {
      defaultRule: {
        requestsPerMinute: 60, // 60 RPM global default
        tokensPerMinute: 100000, // 100k TPM
      },
      modelRules: {
        'claude-3-7-sonnet': {
          requestsPerMinute: 10, // stricter limit for flagship reasoning model
        },
      },
      action: 'block', // 'block' throws GatewayRateLimitError, 'warn' logs warning
      onRateLimitExceeded: (violation) => {
        console.warn(
          `[RateLimit Violation] Key=${violation.key} Limit=${violation.limit} Current=${violation.current} RetryAfter=${violation.retryAfterSec}s`,
        );
      },
    },
    hooks: {
      onSuccess: (provider, _res, latencyMs) => {
        console.log(`[Success] Provider: ${provider.name} in ${latencyMs}ms`);
      },
      onGatewayRateLimitWarning: (violation) => {
        console.warn(`[Gateway Warning] ${violation.limitType} limit reached!`);
      },
    },
  });

  console.log('Sending requests through rate-limited gateway...');
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Explain AI gateways in 1 sentence.' }],
      user: 'alice-tenant-1',
    });
    console.log('Response received:', res.choices[0].message.content);
  } catch (err) {
    if (err instanceof GatewayRateLimitError) {
      console.error(
        `Rate limit exceeded: retry after ${err.retryAfterSec} seconds`,
      );
    } else {
      console.error('Request failed:', (err as Error).message);
    }
  }

  // Export Prometheus / OpenMetrics format
  console.log('\n--- Prometheus Metrics Output ---');
  const prometheusText = client.exportPrometheusMetrics({
    prefix: 'sinaps_',
    labels: { env: 'production', region: 'us-east-1' },
  });
  console.log(prometheusText.slice(0, 500) + '...\n');

  // Export OpenTelemetry (OTLP v1 JSON) format
  console.log('--- OpenTelemetry OTLP JSON Output ---');
  const otelJson = client.exportOtelMetrics({
    serviceName: 'production-ai-gateway',
    serviceVersion: '2.7.0',
    resourceAttributes: { 'deployment.environment': 'production' },
  });
  console.log(
    JSON.stringify(otelJson, null, 2).slice(0, 600) + '...\n',
  );
}

main().catch(console.error);
