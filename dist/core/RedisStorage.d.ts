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
    set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
    del(key: string | string[]): Promise<number>;
    incr(key: string): Promise<number>;
    keys?(pattern: string): Promise<string[]>;
    expire?(key: string, seconds: number): Promise<unknown>;
    scan?(cursor: number | string, ...args: Array<string | number>): Promise<[string, string[]]>;
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
export declare class RedisStorage implements StateStorage {
    private redis;
    private prefix;
    constructor(redis: RedisClientLike, options?: RedisStorageOptions);
    private key;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttlSeconds?: number): Promise<number>;
    clear(): Promise<void>;
}
//# sourceMappingURL=RedisStorage.d.ts.map