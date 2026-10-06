import type { RateLimitInfo } from '../types/index.js';

export function parseRateLimitHeaders(
  headers?: Headers,
): RateLimitInfo | undefined {
  if (!headers) return undefined;

  const reqStr =
    headers.get('x-ratelimit-remaining-requests') ||
    headers.get('anthropic-ratelimit-requests-remaining') ||
    headers.get('ratelimit-remaining');

  const tokStr =
    headers.get('x-ratelimit-remaining-tokens') ||
    headers.get('anthropic-ratelimit-tokens-remaining');

  const retryAfter = headers.get('retry-after');

  let remainingRequests: number | undefined;
  if (reqStr !== null && reqStr !== undefined) {
    const parsed = Number.parseInt(reqStr, 10);
    if (!Number.isNaN(parsed)) remainingRequests = parsed;
  }

  let remainingTokens: number | undefined;
  if (tokStr !== null && tokStr !== undefined) {
    const parsed = Number.parseInt(tokStr, 10);
    if (!Number.isNaN(parsed)) remainingTokens = parsed;
  }

  let resetMs: number | undefined;
  if (retryAfter) {
    const parsedSec = Number.parseFloat(retryAfter);
    if (!Number.isNaN(parsedSec)) {
      resetMs = Math.round(parsedSec * 1000);
    }
  }

  if (
    remainingRequests === undefined &&
    remainingTokens === undefined &&
    resetMs === undefined
  ) {
    return undefined;
  }

  return {
    remainingRequests,
    remainingTokens,
    resetMs,
  };
}
