/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type { UnifiedApiRequest, UnifiedApiResponse } from '../types/index.js';

export interface HedgingOptions {
  /**
   * Enable hedged requests for non-streaming completions.
   */
  enabled?: boolean;
  /**
   * Delay in milliseconds before firing the backup hedged request
   * if the primary provider has not responded yet (default: 1500ms).
   */
  delayMs?: number;
  /**
   * Maximum number of backup providers to hedge across (default: 1).
   */
  maxHedges?: number;
  /**
   * Optional hook triggered when a hedge request is launched.
   */
  onHedgeFired?: (
    primaryProvider: Provider,
    backupProvider: Provider,
    delayMs: number,
  ) => void;
  /**
   * Optional hook triggered when a hedged request wins the race.
   */
  onHedgeWon?: (winnerProvider: Provider, elapsedMs: number) => void;
}

export interface HedgeRaceResult {
  response: UnifiedApiResponse;
  winnerProvider: Provider;
  wasHedged: boolean;
  elapsedMs: number;
}

export class HedgedExecutor {
  private options: Required<
    Pick<HedgingOptions, 'enabled' | 'delayMs' | 'maxHedges'>
  > &
    HedgingOptions;

  constructor(options: HedgingOptions = {}) {
    this.options = {
      ...options,
      enabled: options.enabled ?? true,
      delayMs: options.delayMs ?? 1500,
      maxHedges: options.maxHedges ?? 1,
    };
  }

  /**
   * Executes a request against the primary provider and races up to `maxHedges`
   * secondary providers if the primary exceeds `delayMs`.
   * Automatically aborts all losing in-flight requests once a winner resolves.
   */
  public async execute(
    providers: Provider[],
    request: UnifiedApiRequest,
    dispatcher: (
      provider: Provider,
      reqWithSignal: UnifiedApiRequest,
    ) => Promise<UnifiedApiResponse>,
  ): Promise<HedgeRaceResult> {
    if (providers.length === 0) {
      throw new Error(
        'HedgedExecutor: No available providers to execute request.',
      );
    }

    const startTime = Date.now();

    // If hedging is disabled, streaming is active, or only 1 provider is available, run directly
    if (!this.options.enabled || request.stream || providers.length === 1) {
      const primary = providers[0];
      const response = await dispatcher(primary, request);
      return {
        response,
        winnerProvider: primary,
        wasHedged: false,
        elapsedMs: Date.now() - startTime,
      };
    }

    const candidateCount = Math.min(
      providers.length,
      1 + Math.max(1, this.options.maxHedges),
    );
    const selectedProviders = providers.slice(0, candidateCount);
    const controllers: AbortController[] = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let settled = false;

    const cleanup = (winnerIndex?: number) => {
      for (const t of timers) {
        clearTimeout(t);
      }
      controllers.forEach((ctrl, idx) => {
        if (idx !== winnerIndex && !ctrl.signal.aborted) {
          ctrl.abort();
        }
      });
    };

    // Propagate downstream user abort signal if present
    if (request.signal) {
      if (request.signal.aborted) {
        throw new Error('Request aborted by caller');
      }
      request.signal.addEventListener(
        'abort',
        () => {
          settled = true;
          cleanup();
        },
        { once: true },
      );
    }

    return new Promise<HedgeRaceResult>((resolve, reject) => {
      const errors: Error[] = [];
      let completedCount = 0;

      const launchAttempt = (provider: Provider, index: number) => {
        if (settled) return;

        const ctrl = new AbortController();
        controllers[index] = ctrl;

        const hedgedReq: UnifiedApiRequest = {
          ...request,
          signal: ctrl.signal,
        };

        dispatcher(provider, hedgedReq)
          .then((response) => {
            if (settled) return;
            settled = true;
            const elapsedMs = Date.now() - startTime;
            cleanup(index);

            if (index > 0) {
              this.options.onHedgeWon?.(provider, elapsedMs);
            }

            resolve({
              response,
              winnerProvider: provider,
              wasHedged: index > 0,
              elapsedMs,
            });
          })
          .catch((err) => {
            if (settled) return;
            errors.push(err instanceof Error ? err : new Error(String(err)));
            completedCount++;

            if (completedCount >= selectedProviders.length) {
              settled = true;
              cleanup();
              reject(
                errors[0] || new Error('All hedged provider attempts failed.'),
              );
            }
          });
      };

      // Launch primary provider immediately (t = 0)
      launchAttempt(selectedProviders[0], 0);

      // Schedule backup hedged providers at staggered intervals (delayMs, 2 * delayMs, ...)
      for (let i = 1; i < selectedProviders.length; i++) {
        const delay = this.options.delayMs * i;
        const timer = setTimeout(() => {
          if (!settled) {
            this.options.onHedgeFired?.(
              selectedProviders[0],
              selectedProviders[i],
              delay,
            );
            launchAttempt(selectedProviders[i], i);
          }
        }, delay);
        timers.push(timer);
      }
    });
  }
}
