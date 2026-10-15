/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Cloudflare Workers KV Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { StateStorage } from './StateStorage.js';

/**
 * Cloudflare Workers KV namespace interface.
 * Compatible with `KVNamespace` from `@cloudflare/workers-types`.
 */
export interface KVNamespaceLike {
  get(key: string, options?: { type?: string }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface CloudflareKVStorageOptions {
  /**
   * Optional key prefix for namespacing SinapsAI state
   * within a shared KV namespace (default: 'sinaps:').
   */
  prefix?: string;
}

/**
 * Distributed `StateStorage` adapter for Cloudflare Workers KV.
 *
 * Enables cross-worker synchronization of circuit breaker state,
 * response cache, and rate limiter counters across the Cloudflare
 * edge network without any external dependencies.
 *
 * @example
 * ```typescript
 * import { SinapsClient, CloudflareKVStorage } from 'sinapsai';
 *
 * export default {
 *   async fetch(request: Request, env: { SINAPS_KV: KVNamespace }) {
 *     const client = new SinapsClient({
 *       providers: [...],
 *       storage: new CloudflareKVStorage(env.SINAPS_KV),
 *     });
 *     // Circuit breaker state is now shared across all edge workers
 *   },
 * };
 * ```
 */
export class CloudflareKVStorage implements StateStorage {
  private kv: KVNamespaceLike;
  private prefix: string;

  constructor(kv: KVNamespaceLike, options?: CloudflareKVStorageOptions) {
    this.kv = kv;
    this.prefix = options?.prefix ?? 'sinaps:';
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(this.key(key), { type: 'text' });
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const options: { expirationTtl?: number } = {};

    if (ttlSeconds && ttlSeconds > 0) {
      // Cloudflare KV minimum TTL is 60 seconds
      options.expirationTtl = Math.max(60, ttlSeconds);
    }

    await this.kv.put(this.key(key), serialized, options);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(this.key(key));
  }

  async increment(key: string): Promise<number> {
    const prefixedKey = this.key(key);
    const raw = await this.kv.get(prefixedKey, { type: 'text' });
    let current = 0;

    if (raw !== null) {
      try {
        current = JSON.parse(raw) as number;
      } catch {
        current = 0;
      }
    }

    const newValue = current + 1;
    await this.kv.put(prefixedKey, JSON.stringify(newValue));
    return newValue;
  }

  async clear(): Promise<void> {
    let cursor: string | undefined;
    let complete = false;

    while (!complete) {
      const result = await this.kv.list({
        prefix: this.prefix,
        limit: 1000,
        cursor,
      });

      await Promise.all(result.keys.map((k) => this.kv.delete(k.name)));

      complete = result.list_complete;
      cursor = result.cursor;
    }
  }
}
