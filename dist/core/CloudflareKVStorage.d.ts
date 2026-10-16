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
    get(key: string, options?: {
        type?: string;
    }): Promise<string | null>;
    put(key: string, value: string, options?: {
        expirationTtl?: number;
    }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: {
        prefix?: string;
        limit?: number;
        cursor?: string;
    }): Promise<{
        keys: Array<{
            name: string;
        }>;
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
export declare class CloudflareKVStorage implements StateStorage {
    private kv;
    private prefix;
    constructor(kv: KVNamespaceLike, options?: CloudflareKVStorageOptions);
    private key;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string): Promise<number>;
    clear(): Promise<void>;
}
//# sourceMappingURL=CloudflareKVStorage.d.ts.map