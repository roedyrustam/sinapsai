/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Active Canary Health Probing & Proactive Circuit Breaker
 *
 * Runs non-blocking background canary probes to detect provider outages
 * and degradations proactively. Opens the circuit breaker *before* user
 * traffic arrives, eliminating P99 timeout spikes and achieving zero tail-latency failover.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest } from '../types/index.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import type { StateStorage } from './StateStorage.js';

export type CanaryHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface CanaryProviderHealth {
  providerId: string;
  status: CanaryHealthStatus;
  lastProbeTime?: number;
  latencyMs?: number;
  lastError?: string;
  consecutiveFailures: number;
}

export interface CanaryProberOptions {
  /**
   * Interval between automated canary probes in milliseconds.
   * Default: 30000 (30 seconds).
   */
  intervalMs?: number;

  /**
   * Timeout per canary probe request in milliseconds.
   * Default: 5000 (5 seconds).
   */
  timeoutMs?: number;

  /**
   * Probing strategy:
   * - 'always': Probes all active providers continuously to maintain real-time health telemetry.
   * - 'on_degraded': Only actively probes providers currently in OPEN or HALF_OPEN states to accelerate recovery with minimal token usage.
   * Default: 'on_degraded'.
   */
  mode?: 'always' | 'on_degraded';

  /**
   * Maximum consecutive probe failures before tripping the circuit breaker directly.
   * Default: 2.
   */
  failureThreshold?: number;

  /**
   * Custom probe request or factory function.
   * Defaults to an ultra-lightweight ping: { model: 'default', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 }
   */
  probeRequest?:
    | UnifiedApiRequest
    | ((provider: Provider) => UnifiedApiRequest);

  /**
   * Callback fired whenever a provider's proactive health state transitions.
   */
  onHealthChange?: (
    providerId: string,
    status: CanaryHealthStatus,
    latencyMs?: number,
  ) => void;
}

export class CanaryProber {
  private circuitBreaker: CircuitBreaker;
  private providers: Map<string, Provider> = new Map();
  public readonly storage?: StateStorage;
  private options: Required<
    Omit<CanaryProberOptions, 'probeRequest' | 'onHealthChange'>
  > & {
    probeRequest?:
      | UnifiedApiRequest
      | ((provider: Provider) => UnifiedApiRequest);
    onHealthChange?: (
      providerId: string,
      status: CanaryHealthStatus,
      latencyMs?: number,
    ) => void;
  };
  private timer?: ReturnType<typeof setInterval>;
  private inFlightProbes: Map<string, AbortController> = new Map();
  private healthCache: Map<string, CanaryProviderHealth> = new Map();
  private isRunning = false;

  constructor(
    circuitBreaker: CircuitBreaker,
    providers: Provider[],
    storage: StateStorage,
    options: CanaryProberOptions = {},
  ) {
    this.circuitBreaker = circuitBreaker;
    this.storage = storage;
    for (const p of providers) {
      this.providers.set(p.id, p);
      this.healthCache.set(p.id, {
        providerId: p.id,
        status: 'HEALTHY',
        consecutiveFailures: 0,
      });
    }

    this.options = {
      intervalMs: options.intervalMs ?? 30_000,
      timeoutMs: options.timeoutMs ?? 5_000,
      mode: options.mode ?? 'on_degraded',
      failureThreshold: options.failureThreshold ?? 2,
      probeRequest: options.probeRequest,
      onHealthChange: options.onHealthChange,
    };
  }

  /**
   * Register or update a provider in the prober.
   */
  public registerProvider(provider: Provider): void {
    this.providers.set(provider.id, provider);
    if (!this.healthCache.has(provider.id)) {
      this.healthCache.set(provider.id, {
        providerId: provider.id,
        status: 'HEALTHY',
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Start the background canary probing timer.
   */
  public start(): this {
    if (this.isRunning) return this;
    this.isRunning = true;

    // Run first probe immediately in background
    Promise.resolve().then(() => this.probeAll().catch(() => {}));

    this.timer = setInterval(() => {
      this.probeAll().catch(() => {});
    }, this.options.intervalMs);

    // Unref timer in Node environment so background probing doesn't block process exit
    if (
      this.timer &&
      typeof this.timer === 'object' &&
      'unref' in this.timer &&
      typeof this.timer.unref === 'function'
    ) {
      this.timer.unref();
    }

    return this;
  }

  /**
   * Stop the background canary probing timer and cancel pending probes.
   */
  public stop(): this {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const controller of this.inFlightProbes.values()) {
      controller.abort();
    }
    this.inFlightProbes.clear();
    return this;
  }

  /**
   * Check if the prober is currently running in the background.
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the current proactive health telemetry for a specific provider.
   */
  public getHealth(providerId: string): CanaryProviderHealth | undefined {
    return this.healthCache.get(providerId);
  }

  /**
   * Get proactive health telemetry for all registered providers.
   */
  public getAllHealth(): Record<string, CanaryProviderHealth> {
    const result: Record<string, CanaryProviderHealth> = {};
    for (const [id, health] of this.healthCache.entries()) {
      result[id] = { ...health };
    }
    return result;
  }

  /**
   * Manually trigger a proactive canary probe against a specific provider.
   */
  public async probeProvider(
    provider: Provider,
  ): Promise<{ ok: boolean; latencyMs: number; error?: Error }> {
    const providerId = provider.id;

    // Abort existing in-flight probe for this provider if any
    const existing = this.inFlightProbes.get(providerId);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.inFlightProbes.set(providerId, controller);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.options.timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);
    }

    const startTime = Date.now();
    try {
      let req: UnifiedApiRequest;
      if (typeof this.options.probeRequest === 'function') {
        req = this.options.probeRequest(provider);
      } else if (this.options.probeRequest) {
        req = { ...this.options.probeRequest };
      } else {
        const defaultModel =
          provider.defaultModel ||
          (provider.resolveModel
            ? provider.resolveModel('default')
            : 'default');
        req = {
          model: defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
        };
      }

      req.signal = controller.signal;

      const res = await provider.generateContent(req);

      // If response is a stream, read the first chunk to verify stream liveness
      if (
        res != null &&
        typeof res === 'object' &&
        Symbol.asyncIterator in res
      ) {
        const iterator = (res as AsyncIterable<unknown>)[
          Symbol.asyncIterator
        ]();
        await iterator.next();
      }

      const latencyMs = Date.now() - startTime;
      await this.recordProbeSuccess(providerId, latencyMs);
      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      await this.recordProbeFailure(providerId, error, latencyMs);
      return { ok: false, latencyMs, error };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.inFlightProbes.delete(providerId);
    }
  }

  /**
   * Run canary probes across all eligible providers concurrently.
   */
  public async probeAll(): Promise<
    Record<string, { ok: boolean; latencyMs: number; error?: string }>
  > {
    const results: Record<
      string,
      { ok: boolean; latencyMs: number; error?: string }
    > = {};

    const probePromises: Promise<void>[] = [];

    for (const [id, provider] of this.providers.entries()) {
      // If mode is 'on_degraded', only probe providers currently in OPEN or HALF_OPEN
      if (this.options.mode === 'on_degraded') {
        const isAvailable = await this.circuitBreaker.isAvailable(id);
        const health = this.healthCache.get(id);
        if (isAvailable && health?.status === 'HEALTHY') {
          continue; // Skip healthy providers to conserve tokens
        }
      }

      probePromises.push(
        this.probeProvider(provider).then((res) => {
          results[id] = {
            ok: res.ok,
            latencyMs: res.latencyMs,
            error: res.error?.message,
          };
        }),
      );
    }

    await Promise.allSettled(probePromises);
    return results;
  }

  private async recordProbeSuccess(
    providerId: string,
    latencyMs: number,
  ): Promise<void> {
    const current = this.healthCache.get(providerId) ?? {
      providerId,
      status: 'HEALTHY' as CanaryHealthStatus,
      consecutiveFailures: 0,
    };

    const previousStatus = current.status;
    current.status = 'HEALTHY';
    current.consecutiveFailures = 0;
    current.lastProbeTime = Date.now();
    current.latencyMs = latencyMs;
    current.lastError = undefined;

    this.healthCache.set(providerId, current);

    // If provider was previously tripped or in half-open, inform circuit breaker of success
    await this.circuitBreaker.recordSuccess(providerId);

    if (previousStatus !== 'HEALTHY') {
      this.options.onHealthChange?.(providerId, 'HEALTHY', latencyMs);
    }
  }

  private async recordProbeFailure(
    providerId: string,
    error: Error,
    latencyMs: number,
  ): Promise<void> {
    const current = this.healthCache.get(providerId) ?? {
      providerId,
      status: 'HEALTHY' as CanaryHealthStatus,
      consecutiveFailures: 0,
    };

    current.consecutiveFailures += 1;
    current.lastProbeTime = Date.now();
    current.latencyMs = latencyMs;
    current.lastError = error.message;

    // Proactively record failure in circuit breaker
    await this.circuitBreaker.recordFailure(providerId);

    const isAvailable = await this.circuitBreaker.isAvailable(providerId);
    const previousStatus = current.status;

    if (
      !isAvailable ||
      current.consecutiveFailures >= this.options.failureThreshold
    ) {
      current.status = 'DOWN';
    } else {
      current.status = 'DEGRADED';
    }

    this.healthCache.set(providerId, current);

    if (previousStatus !== current.status) {
      this.options.onHealthChange?.(providerId, current.status, latencyMs);
    }
  }
}
