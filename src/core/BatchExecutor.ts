/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  BatchItemResult,
  BatchOptions,
  BatchProgress,
  BatchResult,
} from '../types/index.js';

export class BatchExecutionError<T> extends Error {
  public readonly results: BatchItemResult<T>[];
  public readonly cause?: Error;

  constructor(message: string, results: BatchItemResult<T>[], cause?: Error) {
    super(message);
    this.name = 'BatchExecutionError';
    this.results = results;
    this.cause = cause;
  }
}

/**
 * Executes an array of items concurrently through an async handler function
 * with configurable concurrency limits, fail-soft or fail-fast semantics,
 * progress tracking, and abort signal support.
 */
export async function executeBatch<TReq, TRes>(
  items: TReq[],
  handler: (item: TReq, index: number) => Promise<TRes>,
  options?: BatchOptions,
): Promise<BatchResult<TRes>> {
  const startTime = Date.now();
  const total = items.length;

  if (total === 0) {
    return {
      results: [],
      total: 0,
      successful: 0,
      failed: 0,
      durationMs: 0,
    };
  }

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, total));
  const stopOnError = options?.stopOnError ?? false;
  const signal = options?.signal;

  const results: BatchItemResult<TRes>[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;
  let successful = 0;
  let failed = 0;
  let shouldStop = false;
  let firstError: Error | undefined;

  const updateProgress = () => {
    if (options?.onProgress) {
      const progress: BatchProgress = {
        completed,
        total,
        percentage: Math.min(100, Math.round((completed / total) * 100)),
        successful,
        failed,
      };
      options.onProgress(progress);
    }
  };

  const worker = async () => {
    while (nextIndex < total && !shouldStop) {
      if (signal?.aborted) {
        shouldStop = true;
        break;
      }

      const currentIndex = nextIndex++;
      const item = items[currentIndex];

      try {
        const value = await handler(item, currentIndex);
        results[currentIndex] = {
          index: currentIndex,
          status: 'fulfilled',
          value,
        };
        successful++;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        results[currentIndex] = {
          index: currentIndex,
          status: 'rejected',
          error,
        };
        failed++;

        if (stopOnError) {
          shouldStop = true;
          firstError = error;
          break;
        }
      } finally {
        completed++;
        updateProgress();
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Fill in any unstarted items if stopped early due to stopOnError or signal
  if (shouldStop) {
    for (let i = 0; i < total; i++) {
      if (!results[i]) {
        results[i] = {
          index: i,
          status: 'rejected',
          error: signal?.aborted
            ? new Error('Batch execution aborted by caller')
            : (firstError ??
              new Error('Batch execution stopped due to previous error')),
        };
        failed++;
        completed++;
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (stopOnError && firstError) {
    throw new BatchExecutionError(
      `Batch execution failed at index ${results.findIndex((r) => r.status === 'rejected')}: ${firstError.message}`,
      results,
      firstError,
    );
  }

  return {
    results,
    total,
    successful,
    failed,
    durationMs,
  };
}
