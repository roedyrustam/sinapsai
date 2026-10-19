/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Links a source AbortSignal to a target AbortController.
 * Automatically cleans up the event listener when the returned cleanup function is invoked,
 * preventing memory leaks on long-lived AbortSignal instances.
 *
 * @param target The target AbortController to trigger if the source aborts.
 * @param source Optional source AbortSignal from downstream callers.
 * @returns Cleanup function to detach the abort event listener, or undefined if no source provided.
 */
export function linkAbortSignal(
  target: AbortController,
  source?: AbortSignal,
): (() => void) | undefined {
  if (!source) return undefined;

  if (source.aborted) {
    target.abort();
    return undefined;
  }

  const onAbort = () => {
    target.abort();
  };

  source.addEventListener('abort', onAbort, { once: true });

  return () => {
    source.removeEventListener('abort', onAbort);
  };
}
