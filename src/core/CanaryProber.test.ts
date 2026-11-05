/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse } from '../types/index.js';
import { s } from '../utils/schema.js';
import { CanaryProber } from './CanaryProber.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { SinapsClient } from './SinapsClient.js';

function createMockProvider(id: string, shouldFail = false): Provider {
  return {
    id,
    name: `MockProvider-${id}`,
    defaultModel: 'test-model',
    resolveModel: (m) => m || 'test-model',
    generateContent: vi.fn(
      async (req: UnifiedApiRequest): Promise<UnifiedApiResponse> => {
        if (shouldFail) {
          throw new Error(`Provider ${id} simulated 503 outage`);
        }
        return {
          id: `res-${id}`,
          model: req.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"status":"ok","value":42}',
              },
              finishReason: 'stop',
            },
          ],
        };
      },
    ),
  };
}

describe('CanaryProber & Proactive Circuit Breaker', () => {
  it('should initialize with registered providers as HEALTHY', () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    const p1 = createMockProvider('prov-1');
    const p2 = createMockProvider('prov-2');

    const prober = new CanaryProber(cb, [p1, p2], storage, {
      intervalMs: 10_000,
    });

    const health1 = prober.getHealth('prov-1');
    const health2 = prober.getHealth('prov-2');

    expect(health1?.status).toBe('HEALTHY');
    expect(health2?.status).toBe('HEALTHY');
    expect(health1?.consecutiveFailures).toBe(0);
  });

  it('should probe a healthy provider and record latency and HEALTHY status', async () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    const p1 = createMockProvider('prov-1');

    const prober = new CanaryProber(cb, [p1], storage);
    const result = await prober.probeProvider(p1);

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const health = prober.getHealth('prov-1');
    expect(health?.status).toBe('HEALTHY');
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.lastProbeTime).toBeDefined();
    expect(p1.generateContent).toHaveBeenCalledTimes(1);
  });

  it('should proactively trip circuit breaker to DOWN after consecutive probe failures', async () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage, { failureThreshold: 2 });
    const pFail = createMockProvider('prov-fail', true);

    const onHealthChange = vi.fn();
    const prober = new CanaryProber(cb, [pFail], storage, {
      failureThreshold: 2,
      onHealthChange,
    });

    // First failure -> DEGRADED
    const res1 = await prober.probeProvider(pFail);
    expect(res1.ok).toBe(false);
    expect(prober.getHealth('prov-fail')?.status).toBe('DEGRADED');
    expect(onHealthChange).toHaveBeenCalledWith(
      'prov-fail',
      'DEGRADED',
      expect.any(Number),
    );

    // Second failure -> reaches threshold 2 -> DOWN and trips CircuitBreaker
    const res2 = await prober.probeProvider(pFail);
    expect(res2.ok).toBe(false);
    expect(prober.getHealth('prov-fail')?.status).toBe('DOWN');
    expect(onHealthChange).toHaveBeenCalledWith(
      'prov-fail',
      'DOWN',
      expect.any(Number),
    );

    // CircuitBreaker is now OPEN before user traffic arrives!
    const isAvail = await cb.isAvailable('prov-fail');
    expect(isAvail).toBe(false);
  });

  it('should recover from DOWN to HEALTHY when probe succeeds again', async () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    let failMode = true;

    const dynamicProvider: Provider = {
      id: 'dyn-prov',
      name: 'DynamicProvider',
      generateContent: vi.fn(async () => {
        if (failMode) throw new Error('Outage');
        return {
          id: 'res-dyn',
          model: 'test',
          choices: [
            {
              message: { role: 'assistant', content: 'recovered' },
              finishReason: 'stop',
            },
          ],
        };
      }),
    };

    const onHealthChange = vi.fn();
    const prober = new CanaryProber(cb, [dynamicProvider], storage, {
      failureThreshold: 1,
      onHealthChange,
    });

    // Probe 1 fails -> trips to DOWN
    await prober.probeProvider(dynamicProvider);
    expect(prober.getHealth('dyn-prov')?.status).toBe('DOWN');

    // Provider recovers in reality
    failMode = false;

    // Probe 2 succeeds -> restores to HEALTHY
    const res2 = await prober.probeProvider(dynamicProvider);
    expect(res2.ok).toBe(true);
    expect(prober.getHealth('dyn-prov')?.status).toBe('HEALTHY');
    expect(onHealthChange).toHaveBeenLastCalledWith(
      'dyn-prov',
      'HEALTHY',
      expect.any(Number),
    );

    // Circuit is available again
    const isAvail = await cb.isAvailable('dyn-prov');
    expect(isAvail).toBe(true);
  });

  it('should start and stop background probing timer cleanly', () => {
    const storage = new InMemoryStorage();
    const cb = new CircuitBreaker(storage);
    const p1 = createMockProvider('p1');

    const prober = new CanaryProber(cb, [p1], storage, { intervalMs: 50_000 });
    expect(prober.isActive()).toBe(false);

    prober.start();
    expect(prober.isActive()).toBe(true);

    prober.stop();
    expect(prober.isActive()).toBe(false);
  });
});

describe('SinapsClient with Canary & createStructured', () => {
  it('should initialize canary prober on SinapsClient when canary: true', () => {
    const p1 = createMockProvider('p1');
    const client = new SinapsClient({
      providers: [p1],
      canary: true,
    });

    expect(client.canary).toBeDefined();
    expect(client.canary?.isActive()).toBe(true);

    client.stop();
    expect(client.canary?.isActive()).toBe(false);
  });

  it('should execute createStructured with schema validation and return typed data', async () => {
    const p1 = createMockProvider('p1');
    const client = new SinapsClient({
      providers: [p1],
    });

    const UserSchema = s.object({
      status: s.string(),
      value: s.number(),
    });

    const result = await client.chat.completions.createStructured<{
      status: string;
      value: number;
    }>({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Get user' }],
      schema: UserSchema,
      schemaName: 'user_info',
    });

    expect(result.data).toEqual({
      status: 'ok',
      value: 42,
    });
    expect(result.response.choices[0].finishReason).toBe('stop');
  });

  it('should throw SchemaValidationError when model output does not match schema', async () => {
    const badProvider: Provider = {
      id: 'bad-provider',
      name: 'BadProvider',
      generateContent: vi.fn(async () => ({
        id: 'res-bad',
        model: 'test',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"status":"missing_value_field"}',
            },
            finishReason: 'stop',
          },
        ],
      })),
    };

    const client = new SinapsClient({
      providers: [badProvider],
    });

    const StrictSchema = s.object({
      status: s.string(),
      value: s.number(), // Required!
    });

    await expect(
      client.chat.completions.createStructured({
        model: 'test',
        messages: [{ role: 'user', content: 'Test' }],
        schema: StrictSchema,
      }),
    ).rejects.toThrow('Structured output validation failed');
  });
});
