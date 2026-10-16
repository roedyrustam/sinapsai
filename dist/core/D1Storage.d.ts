/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Cloudflare D1 (SQLite Edge) Storage Adapter
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { StateStorage } from './StateStorage.js';
/**
 * Cloudflare D1 database interface.
 * Compatible with `D1Database` from `@cloudflare/workers-types`.
 */
export interface D1DatabaseLike {
    prepare(query: string): D1PreparedStatementLike;
    exec(query: string): Promise<unknown>;
    batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;
}
export interface D1PreparedStatementLike {
    bind(...values: unknown[]): D1PreparedStatementLike;
    first<T = unknown>(column?: string): Promise<T | null>;
    all<T = unknown>(): Promise<{
        results: T[];
    }>;
    run(): Promise<{
        success: boolean;
    }>;
}
export interface D1StorageOptions {
    /**
     * Table name to use for storing key-value pairs (default: 'sinaps_state').
     */
    tableName?: string;
    /**
     * If true, auto-creates the table on first operation (default: true).
     */
    autoMigrate?: boolean;
}
/**
 * Distributed `StateStorage` adapter for Cloudflare D1 (SQLite at the edge).
 *
 * Provides durable, SQL-backed state persistence for circuit breaker data,
 * cache metadata, and rate limiter counters. D1 offers strong consistency
 * guarantees within a single region and is ideal for applications that
 * require transactional state operations.
 *
 * @example
 * ```typescript
 * import { SinapsClient, D1Storage } from 'sinapsai';
 *
 * export default {
 *   async fetch(request: Request, env: { SINAPS_DB: D1Database }) {
 *     const client = new SinapsClient({
 *       providers: [...],
 *       storage: new D1Storage(env.SINAPS_DB),
 *     });
 *   },
 * };
 * ```
 */
export declare class D1Storage implements StateStorage {
    private db;
    private tableName;
    private migrated;
    private autoMigrate;
    constructor(db: D1DatabaseLike, options?: D1StorageOptions);
    private ensureTable;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string): Promise<number>;
    clear(): Promise<void>;
    /**
     * Removes expired entries. Call periodically via scheduled handler
     * or Cron Trigger to keep the table lean.
     */
    purgeExpired(): Promise<void>;
}
//# sourceMappingURL=D1Storage.d.ts.map