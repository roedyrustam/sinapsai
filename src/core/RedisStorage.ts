/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Redis / Upstash Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { StateStorage } from './StateStorage.js';

/**
 * Minimal Redis client interface compatible with `ioredis`, `redis` (node-redis),
 * and Upstash Redis REST SDK (`@upstash/redis`).
 *
 * SinapsAI does NOT bundle any Redis driver — bring your own client.
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  incr(key: string): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
  expire?(key: string, seconds: number): Promise<unknown>;
  scan?(
    cursor: number | string,
    ...args: Array<string | number>
  ): Promise<[string, string[]]>;
}

export interface RedisStorageOptions {
  /**
   * Optional key prefix for namespacing SinapsAI state
   * within a shared Redis instance (default: 'sinaps:').
   */
  prefix?: string;
}

/**
 * Distributed `StateStorage` adapter for Redis-compatible stores.
 *
 * Works with ioredis, node-redis, Upstash Redis, and any client
 * implementing the `RedisClientLike` interface. Enables cross-process
 * and cross-server synchronization of circuit breaker state, response
 * cache, and rate limiter counters.
 *
 * @example
 * ```typescript
 * import { SinapsClient, RedisStorage } from 'sinapsai';
 * import Redis from 'ioredis';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const client = new SinapsClient({
 *   providers: [...],
 *   storage: new RedisStorage(redis),
 * });
 * ```
 *
 * @example Upstash Redis (Edge / Serverless)
 * ```typescript
 * import { SinapsClient, RedisStorage } from 'sinapsai';
 * import { Redis } from '@upstash/redis';
 *
 * const redis = new Redis({ url: '...', token: '...' });
 * const client = new SinapsClient({
 *   providers: [...],
 *   storage: new RedisStorage(redis),
 * });
 * ```
 */
export class RedisStorage implements StateStorage {
  private redis: RedisClientLike;
  private prefix: string;

  constructor(redis: RedisClientLike, options?: RedisStorageOptions) {
    this.redis = redis;
    this.prefix = options?.prefix ?? 'sinaps:';
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(key));
    if (raw === null || raw === undefined) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const prefixedKey = this.key(key);
    const serialized = JSON.stringify(value);

    if (ttlSeconds && ttlSeconds > 0) {
      // Redis SET key value EX seconds
      await this.redis.set(prefixedKey, serialized, 'EX', ttlSeconds);
    } else {
      await this.redis.set(prefixedKey, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const prefixedKey = this.key(key);
    const val = await this.redis.incr(prefixedKey);
    if (
      val === 1 &&
      ttlSeconds &&
      ttlSeconds > 0 &&
      typeof this.redis.expire === 'function'
    ) {
      await this.redis.expire(prefixedKey, ttlSeconds);
    }
    return val;
  }

  async clear(): Promise<void> {
    // Use SCAN for safe iteration if available, fallback to KEYS
    if (typeof this.redis.scan === 'function') {
      let cursor: string | number = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.prefix}*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(keys as unknown as string);
        }
      } while (cursor !== '0');
    } else if (typeof this.redis.keys === 'function') {
      const keys = await this.redis.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        for (const key of keys) {
          await this.redis.del(key);
        }
      }
    }
  }
}
