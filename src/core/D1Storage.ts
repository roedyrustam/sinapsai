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
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
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
export class D1Storage implements StateStorage {
  private db: D1DatabaseLike;
  private tableName: string;
  private migrated = false;
  private autoMigrate: boolean;

  constructor(db: D1DatabaseLike, options?: D1StorageOptions) {
    this.db = db;
    this.tableName = options?.tableName ?? 'sinaps_state';
    this.autoMigrate = options?.autoMigrate ?? true;
  }

  private async ensureTable(): Promise<void> {
    if (this.migrated || !this.autoMigrate) return;

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )
    `);
    this.migrated = true;
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1000);

    const row = await this.db
      .prepare(
        `SELECT value FROM ${this.tableName} WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .bind(key, now)
      .first<{ value: string }>();

    if (!row) return null;

    // Handle both object results and string results from D1
    const rawValue = typeof row === 'string' ? row : row.value;
    if (!rawValue) return null;

    try {
      return JSON.parse(rawValue) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureTable();
    const serialized = JSON.stringify(value);
    const expiresAt =
      ttlSeconds && ttlSeconds > 0
        ? Math.floor(Date.now() / 1000) + ttlSeconds
        : null;

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, ?)`,
      )
      .bind(key, serialized, expiresAt)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();
    await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE key = ?`)
      .bind(key)
      .run();
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    await this.ensureTable();
    const current = await this.get<number>(key);
    const newValue = (current ?? 0) + 1;
    const expiresAt =
      current === null && ttlSeconds && ttlSeconds > 0
        ? Math.floor(Date.now() / 1000) + ttlSeconds
        : null;

    if (current === null && expiresAt !== null) {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, ?)`,
        )
        .bind(key, JSON.stringify(newValue), expiresAt)
        .run();
    } else {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO ${this.tableName} (key, value, expires_at) VALUES (?, ?, (SELECT expires_at FROM ${this.tableName} WHERE key = ?))`,
        )
        .bind(key, JSON.stringify(newValue), key)
        .run();
    }

    return newValue;
  }

  async clear(): Promise<void> {
    await this.ensureTable();
    await this.db.prepare(`DELETE FROM ${this.tableName}`).run();
  }

  /**
   * Removes expired entries. Call periodically via scheduled handler
   * or Cron Trigger to keep the table lean.
   */
  async purgeExpired(): Promise<void> {
    await this.ensureTable();
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare(
        `DELETE FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .bind(now)
      .run();
  }
}
