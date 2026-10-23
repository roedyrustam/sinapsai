/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import type { SinapsMetrics } from '../types/index.js';
import {
  formatOtelMetrics,
  formatPrometheusMetrics,
} from './metricsExporter.js';

describe('metricsExporter', () => {
  const sampleMetrics: SinapsMetrics = {
    totalRequests: 100,
    successfulRequests: 95,
    failedRequests: 3,
    cachedRequests: 2,
    totalPromptTokens: 50000,
    totalCompletionTokens: 15000,
    totalCachedPromptTokens: 20000,
    totalTokens: 65000,
    estimatedCostUsd: 0.125,
    providerMetrics: {
      openai: {
        requests: 60,
        successes: 58,
        failures: 2,
        promptTokens: 30000,
        completionTokens: 9000,
        cachedPromptTokens: 12000,
        latencySumMs: 15000,
        averageLatencyMs: 250,
      },
      anthropic: {
        requests: 40,
        successes: 37,
        failures: 1,
        promptTokens: 20000,
        completionTokens: 6000,
        cachedPromptTokens: 8000,
        latencySumMs: 12000,
        averageLatencyMs: 300,
      },
    },
  };

  describe('formatPrometheusMetrics', () => {
    it('should export valid Prometheus exposition format with standard metrics', () => {
      const output = formatPrometheusMetrics(sampleMetrics);

      expect(output).toContain('# HELP sinaps_requests_total');
      expect(output).toContain('# TYPE sinaps_requests_total counter');
      expect(output).toContain('sinaps_requests_total 100');

      expect(output).toContain(
        'sinaps_requests_by_status_total{status="success"} 95',
      );
      expect(output).toContain(
        'sinaps_requests_by_status_total{status="failure"} 3',
      );
      expect(output).toContain(
        'sinaps_requests_by_status_total{status="cached"} 2',
      );

      expect(output).toContain('sinaps_tokens_total{type="prompt"} 50000');
      expect(output).toContain('sinaps_tokens_total{type="completion"} 15000');
      expect(output).toContain(
        'sinaps_tokens_total{type="cached_prompt"} 20000',
      );
      expect(output).toContain('sinaps_tokens_total{type="total"} 65000');

      expect(output).toContain('sinaps_estimated_cost_usd 0.125');

      expect(output).toContain(
        'sinaps_provider_requests_total{provider="openai"} 60',
      );
      expect(output).toContain(
        'sinaps_provider_requests_total{provider="anthropic"} 40',
      );
      expect(output).toContain(
        'sinaps_provider_latency_avg_ms{provider="openai"} 250',
      );
      expect(output).toContain(
        'sinaps_provider_latency_avg_ms{provider="anthropic"} 300',
      );
    });

    it('should support custom prefix and static labels', () => {
      const output = formatPrometheusMetrics(sampleMetrics, {
        prefix: 'ai_gw_',
        labels: { env: 'production', cluster: 'us-east' },
      });

      expect(output).toContain('# HELP ai_gw_requests_total');
      expect(output).toContain(
        'ai_gw_requests_total{env="production",cluster="us-east"} 100',
      );
      expect(output).toContain(
        'ai_gw_requests_by_status_total{env="production",cluster="us-east",status="success"} 95',
      );
    });

    it('should properly escape label values with quotes or backslashes', () => {
      const output = formatPrometheusMetrics(sampleMetrics, {
        labels: { path: 'C:\\app\\node', quote: 'hello "world"' },
      });

      expect(output).toContain('path="C:\\\\app\\\\node"');
      expect(output).toContain('quote="hello \\"world\\""');
    });
  });

  describe('formatOtelMetrics', () => {
    it('should export valid OpenTelemetry v1 OTLP JSON structure', () => {
      const otel = formatOtelMetrics(sampleMetrics, {
        serviceName: 'my-ai-service',
        serviceVersion: '1.2.3',
        resourceAttributes: {
          'deployment.environment': 'staging',
          instances: 4,
          debug: false,
        },
      });

      expect(otel).toHaveProperty('resourceMetrics');
      expect(otel.resourceMetrics).toHaveLength(1);

      const rm = otel.resourceMetrics[0];
      const attrs = rm.resource.attributes;
      expect(attrs).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'my-ai-service' },
      });
      expect(attrs).toContainEqual({
        key: 'service.version',
        value: { stringValue: '1.2.3' },
      });
      expect(attrs).toContainEqual({
        key: 'deployment.environment',
        value: { stringValue: 'staging' },
      });
      expect(attrs).toContainEqual({
        key: 'instances',
        value: { intValue: 4 },
      });
      expect(attrs).toContainEqual({
        key: 'debug',
        value: { boolValue: false },
      });

      const sm = rm.scopeMetrics[0];
      expect(sm.scope.name).toBe('sinapsai');
      expect(sm.metrics.length).toBeGreaterThan(4);

      // Check requests sum metric
      const reqMetric = sm.metrics.find(
        (m) => m.name === 'sinaps.requests.total',
      );
      expect(reqMetric).toBeDefined();
      expect(reqMetric?.sum?.dataPoints[0].asInt).toBe(100);

      // Check provider latency gauge metric
      const latMetric = sm.metrics.find(
        (m) => m.name === 'sinaps.provider.latency.average',
      );
      expect(latMetric).toBeDefined();
      expect(latMetric?.gauge?.dataPoints).toHaveLength(2);
    });

    it('should use default serviceName and serviceVersion when omitted', () => {
      const otel = formatOtelMetrics(sampleMetrics);
      const attrs = otel.resourceMetrics[0].resource.attributes;
      expect(attrs).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'sinapsai-gateway' },
      });
      expect(attrs).toContainEqual({
        key: 'service.version',
        value: { stringValue: '2.8.1' },
      });
    });
  });
});
