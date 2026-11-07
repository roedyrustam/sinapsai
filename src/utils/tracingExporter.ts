/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * OpenTelemetry GenAI Semantic Conventions (v1.30+) Distributed Tracing Exporter
 *
 * Implements:
 * 1. Zero-dependency OTLP JSON Trace Payload generator conforming to OpenTelemetry v1 spec.
 * 2. Standard GenAI attributes:
 *    - `gen_ai.system` ("openai", "anthropic", "gemini", "groq", etc.)
 *    - `gen_ai.request.model`, `gen_ai.response.model`
 *    - `gen_ai.operation.name` ("chat", "embeddings", "tool_call", "swarm_agent")
 *    - `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens`
 * 3. 16-byte random hex TraceID and 8-byte SpanID generators without external crypto libraries.
 * 4. Ready for instant ingest into Langfuse, Arize Phoenix, Datadog, Jaeger, Honeycomb, or Grafana Tempo.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface GenAiSpanAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: number | string;
    boolValue?: boolean;
    doubleValue?: number;
  };
}

export interface GenAiSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name: string;
  kind?: number; // 1 = Internal, 2 = Server, 3 = Client
  startTimeMs: number;
  endTimeMs: number;
  attributes: Record<string, string | number | boolean | undefined>;
  status?: {
    code: 0 | 1 | 2; // 0 = Unset, 1 = Ok, 2 = Error
    message?: string;
  };
}

export interface OtelTraceExportOptions {
  serviceName?: string;
  serviceVersion?: string;
  endpoint?: string; // e.g. "http://localhost:4318/v1/traces"
  headers?: Record<string, string>;
  attributes?: Record<string, string>;
}

export interface OtelTracePayload {
  resourceSpans: Array<{
    resource: {
      attributes: GenAiSpanAttribute[];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version: string;
      };
      spans: Array<{
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        name: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: GenAiSpanAttribute[];
        status: {
          code: number;
          message?: string;
        };
      }>;
    }>;
  }>;
}

/**
 * Generates a random 32-character (16-byte) hex string for OpenTelemetry TraceID.
 */
export function generateTraceId(): string {
  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return hex.slice(0, 32);
}

/**
 * Generates a random 16-character (8-byte) hex string for OpenTelemetry SpanID.
 */
export function generateSpanId(): string {
  let hex = '';
  for (let i = 0; i < 2; i++) {
    hex += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return hex.slice(0, 16);
}

function formatAttribute(
  key: string,
  val: string | number | boolean,
): GenAiSpanAttribute {
  if (typeof val === 'string') {
    return { key, value: { stringValue: val } };
  }
  if (typeof val === 'boolean') {
    return { key, value: { boolValue: val } };
  }
  if (Number.isInteger(val)) {
    return { key, value: { intValue: String(val) } };
  }
  return { key, value: { doubleValue: Number(val) } };
}

/**
 * Converts internal GenAiSpan objects into standard OpenTelemetry OTLP JSON format.
 */
export function toOtelTracePayload(
  spans: GenAiSpan[],
  options: OtelTraceExportOptions = {},
): OtelTracePayload {
  const serviceName = options.serviceName ?? 'sinapsai-gateway';
  const serviceVersion = options.serviceVersion ?? '3.0.0';

  const resourceAttributes: GenAiSpanAttribute[] = [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'service.version', value: { stringValue: serviceVersion } },
    { key: 'telemetry.sdk.name', value: { stringValue: 'sinapsai' } },
    { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } },
  ];

  if (options.attributes) {
    for (const [k, v] of Object.entries(options.attributes)) {
      resourceAttributes.push({ key: k, value: { stringValue: v } });
    }
  }

  const defaultTraceId = generateTraceId();

  const formattedSpans = spans.map((span) => {
    const traceId = span.traceId || defaultTraceId;
    const spanId = span.spanId || generateSpanId();
    const startTimeUnixNano = `${BigInt(Math.floor(span.startTimeMs)) * 1000000n}`;
    const endTimeUnixNano = `${BigInt(Math.floor(span.endTimeMs)) * 1000000n}`;

    const attributes: GenAiSpanAttribute[] = [];
    for (const [k, v] of Object.entries(span.attributes)) {
      if (v !== undefined) {
        attributes.push(formatAttribute(k, v));
      }
    }

    return {
      traceId,
      spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind ?? 3, // Client kind default for external LLM calls
      startTimeUnixNano,
      endTimeUnixNano,
      attributes,
      status: {
        code: span.status?.code ?? 1, // 1 = OK
        message: span.status?.message,
      },
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: resourceAttributes,
        },
        scopeSpans: [
          {
            scope: {
              name: 'sinapsai.gen_ai',
              version: serviceVersion,
            },
            spans: formattedSpans,
          },
        ],
      },
    ],
  };
}

/**
 * Dispatches OpenTelemetry trace payload directly to an OTLP HTTP collector (/v1/traces).
 */
export async function exportOtelTraces(
  spans: GenAiSpan[],
  options: OtelTraceExportOptions = {},
): Promise<{ success: boolean; status?: number; error?: string }> {
  const endpoint = options.endpoint || 'http://127.0.0.1:4318/v1/traces';
  const payload = toOtelTracePayload(spans, options);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: JSON.stringify(payload),
    });

    return {
      success: res.ok,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
