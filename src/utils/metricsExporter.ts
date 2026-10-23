/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  OtelExportOptions,
  OtelMetricItem,
  OtelResourceMetrics,
  PrometheusExportOptions,
  SinapsMetrics,
} from '../types/index.js';

function escapePrometheusLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function formatPrometheusLabels(
  labels: Record<string, string>,
  extraLabels?: Record<string, string>,
): string {
  const merged = { ...labels, ...extraLabels };
  const entries = Object.entries(merged);
  if (entries.length === 0) return '';
  const formatted = entries
    .map(([k, v]) => `${k}="${escapePrometheusLabelValue(String(v))}"`)
    .join(',');
  return `{${formatted}}`;
}

/**
 * Formats SinapsMetrics into standard Prometheus / OpenMetrics text exposition format.
 * Compatible with Prometheus scraper, Grafana Agent, VictoriaMetrics, and Datadog.
 */
export function formatPrometheusMetrics(
  metrics: SinapsMetrics,
  options: PrometheusExportOptions = {},
): string {
  const prefix = options.prefix ?? 'sinaps_';
  const baseLabels = options.labels || {};
  const timestampSuffix = options.includeTimestamps ? ` ${Date.now()}` : '';

  const lines: string[] = [];

  // Total requests counter
  lines.push(
    `# HELP ${prefix}requests_total Total number of LLM requests handled by SinapsAI gateway`,
    `# TYPE ${prefix}requests_total counter`,
    `${prefix}requests_total${formatPrometheusLabels(baseLabels)} ${metrics.totalRequests}${timestampSuffix}`,
  );

  // Requests by status counter
  lines.push(
    `# HELP ${prefix}requests_by_status_total Requests broken down by status`,
    `# TYPE ${prefix}requests_by_status_total counter`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: 'success' })} ${metrics.successfulRequests}${timestampSuffix}`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: 'failure' })} ${metrics.failedRequests}${timestampSuffix}`,
    `${prefix}requests_by_status_total${formatPrometheusLabels(baseLabels, { status: 'cached' })} ${metrics.cachedRequests}${timestampSuffix}`,
  );

  // Tokens breakdown counter
  lines.push(
    `# HELP ${prefix}tokens_total Total tokens processed across all requests`,
    `# TYPE ${prefix}tokens_total counter`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: 'prompt' })} ${metrics.totalPromptTokens}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: 'completion' })} ${metrics.totalCompletionTokens}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: 'cached_prompt' })} ${metrics.totalCachedPromptTokens ?? 0}${timestampSuffix}`,
    `${prefix}tokens_total${formatPrometheusLabels(baseLabels, { type: 'total' })} ${metrics.totalTokens}${timestampSuffix}`,
  );

  // Estimated Cost USD
  lines.push(
    `# HELP ${prefix}estimated_cost_usd Cumulative estimated LLM provider cost in USD`,
    `# TYPE ${prefix}estimated_cost_usd counter`,
    `${prefix}estimated_cost_usd${formatPrometheusLabels(baseLabels)} ${Number(metrics.estimatedCostUsd.toFixed(6))}${timestampSuffix}`,
  );

  // Provider breakdown metrics
  const providers = Object.entries(metrics.providerMetrics || {});
  if (providers.length > 0) {
    // Provider Requests
    lines.push(
      `# HELP ${prefix}provider_requests_total Total requests dispatched per provider`,
      `# TYPE ${prefix}provider_requests_total counter`,
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_requests_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.requests}${timestampSuffix}`,
      );
    }

    // Provider Successes
    lines.push(
      `# HELP ${prefix}provider_successes_total Total successful requests per provider`,
      `# TYPE ${prefix}provider_successes_total counter`,
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_successes_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.successes}${timestampSuffix}`,
      );
    }

    // Provider Failures
    lines.push(
      `# HELP ${prefix}provider_failures_total Total failed requests per provider`,
      `# TYPE ${prefix}provider_failures_total counter`,
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_failures_total${formatPrometheusLabels(baseLabels, { provider: id })} ${pm.failures}${timestampSuffix}`,
      );
    }

    // Provider Tokens
    lines.push(
      `# HELP ${prefix}provider_tokens_total Total tokens processed per provider by type`,
      `# TYPE ${prefix}provider_tokens_total counter`,
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: 'prompt' })} ${pm.promptTokens}${timestampSuffix}`,
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: 'completion' })} ${pm.completionTokens}${timestampSuffix}`,
        `${prefix}provider_tokens_total${formatPrometheusLabels(baseLabels, { provider: id, type: 'cached_prompt' })} ${pm.cachedPromptTokens ?? 0}${timestampSuffix}`,
      );
    }

    // Provider Average Latency Gauge
    lines.push(
      `# HELP ${prefix}provider_latency_avg_ms Running average latency per provider in milliseconds`,
      `# TYPE ${prefix}provider_latency_avg_ms gauge`,
    );
    for (const [id, pm] of providers) {
      lines.push(
        `${prefix}provider_latency_avg_ms${formatPrometheusLabels(baseLabels, { provider: id })} ${Number(pm.averageLatencyMs.toFixed(2))}${timestampSuffix}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Formats SinapsMetrics into OpenTelemetry (OTLP v1 JSON) ResourceMetrics structure.
 * Standard format directly sendable to any OTLP/HTTP metric collector endpoint (/v1/metrics).
 */
export function formatOtelMetrics(
  metrics: SinapsMetrics,
  options: OtelExportOptions = {},
): OtelResourceMetrics {
  const serviceName = options.serviceName || 'sinapsai-gateway';
  const serviceVersion = options.serviceVersion || '2.8.1';
  const nowNano = `${Date.now()}000000`;

  const resourceAttrs: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: number;
      boolValue?: boolean;
      doubleValue?: number;
    };
  }> = [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'service.version', value: { stringValue: serviceVersion } },
  ];

  if (options.resourceAttributes) {
    for (const [k, v] of Object.entries(options.resourceAttributes)) {
      if (typeof v === 'string') {
        resourceAttrs.push({ key: k, value: { stringValue: v } });
      } else if (typeof v === 'number') {
        if (Number.isInteger(v)) {
          resourceAttrs.push({ key: k, value: { intValue: v } });
        } else {
          resourceAttrs.push({ key: k, value: { doubleValue: v } });
        }
      } else if (typeof v === 'boolean') {
        resourceAttrs.push({ key: k, value: { boolValue: v } });
      }
    }
  }

  // Helper to build OTLP Sum metric
  const createSumMetric = (
    name: string,
    description: string,
    unit: string,
    dataPoints: Array<{
      asInt?: number;
      asDouble?: number;
      attributes?: Record<string, string>;
    }>,
  ) => ({
    name,
    description,
    unit,
    sum: {
      aggregationTemporality: 2, // CUMULATIVE
      isMonotonic: true,
      dataPoints: dataPoints.map((dp) => ({
        asInt: dp.asInt,
        asDouble: dp.asDouble,
        timeUnixNano: nowNano,
        attributes: Object.entries(dp.attributes || {}).map(([k, v]) => ({
          key: k,
          value: { stringValue: v },
        })),
      })),
    },
  });

  // Helper to build OTLP Gauge metric
  const createGaugeMetric = (
    name: string,
    description: string,
    unit: string,
    dataPoints: Array<{
      asDouble: number;
      attributes?: Record<string, string>;
    }>,
  ) => ({
    name,
    description,
    unit,
    gauge: {
      dataPoints: dataPoints.map((dp) => ({
        asDouble: dp.asDouble,
        timeUnixNano: nowNano,
        attributes: Object.entries(dp.attributes || {}).map(([k, v]) => ({
          key: k,
          value: { stringValue: v },
        })),
      })),
    },
  });

  const otelMetrics: OtelMetricItem[] = [
    createSumMetric(
      'sinaps.requests.total',
      'Total number of LLM requests handled by SinapsAI gateway',
      '{requests}',
      [{ asInt: metrics.totalRequests }],
    ),
    createSumMetric(
      'sinaps.requests.by_status',
      'Requests broken down by completion status',
      '{requests}',
      [
        {
          asInt: metrics.successfulRequests,
          attributes: { status: 'success' },
        },
        { asInt: metrics.failedRequests, attributes: { status: 'failure' } },
        { asInt: metrics.cachedRequests, attributes: { status: 'cached' } },
      ],
    ),
    createSumMetric(
      'sinaps.tokens.total',
      'Total tokens processed across all requests',
      '{tokens}',
      [
        { asInt: metrics.totalPromptTokens, attributes: { type: 'prompt' } },
        {
          asInt: metrics.totalCompletionTokens,
          attributes: { type: 'completion' },
        },
        {
          asInt: metrics.totalCachedPromptTokens ?? 0,
          attributes: { type: 'cached_prompt' },
        },
        { asInt: metrics.totalTokens, attributes: { type: 'total' } },
      ],
    ),
    createSumMetric(
      'sinaps.cost.usd',
      'Cumulative estimated LLM provider cost in USD',
      'USD',
      [{ asDouble: Number(metrics.estimatedCostUsd.toFixed(6)) }],
    ),
  ];

  // Provider metrics
  const providers = Object.entries(metrics.providerMetrics || {});
  if (providers.length > 0) {
    otelMetrics.push(
      createSumMetric(
        'sinaps.provider.requests',
        'Total requests dispatched per provider',
        '{requests}',
        providers.map(([id, pm]) => ({
          asInt: pm.requests,
          attributes: { provider: id },
        })),
      ),
      createSumMetric(
        'sinaps.provider.successes',
        'Total successful requests per provider',
        '{requests}',
        providers.map(([id, pm]) => ({
          asInt: pm.successes,
          attributes: { provider: id },
        })),
      ),
      createSumMetric(
        'sinaps.provider.failures',
        'Total failed requests per provider',
        '{requests}',
        providers.map(([id, pm]) => ({
          asInt: pm.failures,
          attributes: { provider: id },
        })),
      ),
      createGaugeMetric(
        'sinaps.provider.latency.average',
        'Running average latency per provider in milliseconds',
        'ms',
        providers.map(([id, pm]) => ({
          asDouble: Number(pm.averageLatencyMs.toFixed(2)),
          attributes: { provider: id },
        })),
      ),
    );
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: resourceAttrs,
        },
        scopeMetrics: [
          {
            scope: {
              name: 'sinapsai',
              version: serviceVersion,
            },
            metrics: otelMetrics,
          },
        ],
      },
    ],
  };
}
