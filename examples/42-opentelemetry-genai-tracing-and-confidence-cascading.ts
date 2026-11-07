/**
 * Example 42: OpenTelemetry GenAI Distributed Tracing & Confidence Cascading
 *
 * Demonstrates:
 * 1. Generating compliant OpenTelemetry GenAI Semantic Conventions v1.30+ trace spans.
 * 2. Evaluating response confidence with uncertainty detection for early-exit cascading.
 * 3. Exporting OTLP JSON Trace payloads to collectors or viewing via Dashboard API (/api/traces).
 */

import {
  evaluateResponseConfidence,
  exportOtelTraces,
  generateSpanId,
  generateTraceId,
  toOtelTracePayload,
} from '../src/index.js';

async function main() {
  console.log('=== 1. Confidence-Calibrated Early-Exit Evaluation ===');
  const query = 'How do I resolve a race condition in a multi-threaded database connection pool?';
  const tier1Draft = 'I am not sure, perhaps you could increase timeout or it might be a locked table.';

  const evaluation = evaluateResponseConfidence(tier1Draft, 'stop');
  console.log(`Tier 1 Draft Confidence Score: ${evaluation.confidenceScore}`);
  console.log(`Is Confident: ${evaluation.isConfident}`);
  console.log(`Should Escalate to Tier 3: ${evaluation.shouldEscalate}`);
  console.log('Detected Signals:', evaluation.signals);

  console.log('\n=== 2. OpenTelemetry GenAI Semantic Conventions Spans ===');
  const traceId = generateTraceId();
  const rootSpanId = generateSpanId();
  const childSpanId = generateSpanId();

  const spans = [
    {
      traceId,
      spanId: rootSpanId,
      name: 'chat gateway-request',
      startTimeMs: Date.now() - 320,
      endTimeMs: Date.now(),
      attributes: {
        'gen_ai.operation.name': 'chat',
        'sinaps.strategy': 'adaptive',
        'sinaps.client_id': 'enterprise_tenant_01',
      },
    },
    {
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      name: 'chat gemini-2.5-pro',
      startTimeMs: Date.now() - 280,
      endTimeMs: Date.now() - 20,
      attributes: {
        'gen_ai.system': 'gemini',
        'gen_ai.request.model': 'gemini-2.5-pro',
        'gen_ai.response.model': 'gemini-2.5-pro-001',
        'gen_ai.usage.prompt_tokens': 120,
        'gen_ai.usage.completion_tokens': 450,
        'gen_ai.usage.total_tokens': 570,
        'sinaps.cost_usd': 0.00185,
      },
    },
  ];

  const otelPayload = toOtelTracePayload(spans, {
    serviceName: 'sinapsai-production-service',
    attributes: { cluster: 'asia-east-1' },
  });

  console.log('Generated OTLP v1 Trace Payload (Resource Spans):');
  console.log(JSON.stringify(otelPayload, null, 2).slice(0, 500) + '...\n');

  console.log('=== 3. Ready to Export to OTLP Collector (Langfuse / Datadog / Jaeger) ===');
  console.log('Endpoint default: POST http://127.0.0.1:4318/v1/traces');
  console.log('=== Example 42 Completed Successfully! ===');
}

main().catch(console.error);
