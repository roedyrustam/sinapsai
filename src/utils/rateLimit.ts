import type { RateLimitInfo } from '../types/index.js';

export function parseDurationMs(durationStr: string): number | undefined {
  const trimmed = durationStr.trim();
  if (!trimmed) return undefined;

  // Pure number (seconds)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number.parseFloat(trimmed);
    return Number.isNaN(val) ? undefined : Math.round(val * 1000);
  }

  let totalMs = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec iteration
  while ((match = regex.exec(trimmed)) !== null) {
    matched = true;
    const value = Number.parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'ms':
        totalMs += value;
        break;
      case 's':
        totalMs += value * 1000;
        break;
      case 'm':
        totalMs += value * 60 * 1000;
        break;
      case 'h':
        totalMs += value * 3600 * 1000;
        break;
      case 'd':
        totalMs += value * 86400 * 1000;
        break;
    }
  }

  return matched ? Math.round(totalMs) : undefined;
}

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
  } else {
    const resetTokensHeader = headers.get('x-ratelimit-reset-tokens');
    const resetRequestsHeader = headers.get('x-ratelimit-reset-requests');
    if (resetTokensHeader) {
      resetMs = parseDurationMs(resetTokensHeader);
    } else if (resetRequestsHeader) {
      resetMs = parseDurationMs(resetRequestsHeader);
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
