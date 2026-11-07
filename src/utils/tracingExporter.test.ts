import { describe, expect, it, vi } from 'vitest';
import {
  exportOtelTraces,
  type GenAiSpan,
  generateSpanId,
  generateTraceId,
  toOtelTracePayload,
} from './tracingExporter.js';

describe('OpenTelemetry GenAI Semantic Conventions Tracing Exporter', () => {
  it('generates 32-char traceId and 16-char spanId', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    expect(traceId).toHaveLength(32);
    expect(spanId).toHaveLength(16);
    expect(/^[0-9a-f]{32}$/.test(traceId)).toBe(true);
    expect(/^[0-9a-f]{16}$/.test(spanId)).toBe(true);
  });

  it('formats GenAiSpan array into compliant OTLP v1 JSON resourceSpans', () => {
    const spans: GenAiSpan[] = [
      {
        name: 'chat gemini-2.5-flash',
        startTimeMs: 1731000000000,
        endTimeMs: 1731000000500,
        attributes: {
          'gen_ai.system': 'gemini',
          'gen_ai.request.model': 'gemini-2.5-flash',
          'gen_ai.operation.name': 'chat',
          'gen_ai.usage.prompt_tokens': 45,
          'gen_ai.usage.completion_tokens': 120,
          'gen_ai.usage.total_tokens': 165,
          'sinaps.cache_hit': false,
        },
      },
    ];

    const payload = toOtelTracePayload(spans, {
      serviceName: 'my-ai-app',
      attributes: { environment: 'production' },
    });

    expect(payload.resourceSpans).toHaveLength(1);
    const res = payload.resourceSpans[0];
    const attrs = res.resource.attributes;
    expect(attrs.find((a) => a.key === 'service.name')?.value.stringValue).toBe(
      'my-ai-app',
    );
    expect(attrs.find((a) => a.key === 'environment')?.value.stringValue).toBe(
      'production',
    );

    const formattedSpan = res.scopeSpans[0].spans[0];
    expect(formattedSpan.name).toBe('chat gemini-2.5-flash');
    expect(formattedSpan.traceId).toHaveLength(32);
    expect(formattedSpan.spanId).toHaveLength(16);
    expect(
      formattedSpan.attributes.find((a) => a.key === 'gen_ai.system')?.value
        .stringValue,
    ).toBe('gemini');
    expect(
      formattedSpan.attributes.find(
        (a) => a.key === 'gen_ai.usage.prompt_tokens',
      )?.value.intValue,
    ).toBe('45');
    expect(
      formattedSpan.attributes.find((a) => a.key === 'sinaps.cache_hit')?.value
        .boolValue,
    ).toBe(false);
  });

  it('dispatches traces to remote OTLP HTTP endpoint', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    try {
      const result = await exportOtelTraces([
        {
          name: 'tool_call calculate_cost',
          startTimeMs: Date.now() - 50,
          endTimeMs: Date.now(),
          attributes: { 'gen_ai.operation.name': 'tool_call' },
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
