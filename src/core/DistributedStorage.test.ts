/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Distributed Storage Adapters Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareKVStorage,
  type KVNamespaceLike,
} from '../core/CloudflareKVStorage.js';
import {
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  D1Storage,
} from '../core/D1Storage.js';
import { type RedisClientLike, RedisStorage } from '../core/RedisStorage.js';

// ────────────────────────────────────────────────
// CLOUDFLARE KV STORAGE
// ────────────────────────────────────────────────
describe('CloudflareKVStorage', () => {
  let store: Map<string, string>;
  let mockKV: KVNamespaceLike;

  beforeEach(() => {
    store = new Map();
    mockKV = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      list: vi.fn(async () => ({
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
      })),
    };
  });

  it('should get and set values with JSON serialization', async () => {
    const storage = new CloudflareKVStorage(mockKV);

    await storage.set('test-key', { count: 42 });
    expect(mockKV.put).toHaveBeenCalledWith(
      'sinaps:test-key',
      '{"count":42}',
      {},
    );

    const result = await storage.get<{ count: number }>('test-key');
    expect(result).toEqual({ count: 42 });
  });

  it('should apply TTL with minimum 60 seconds for KV', async () => {
    const storage = new CloudflareKVStorage(mockKV);

    await storage.set('ttl-key', 'data', 30);
    expect(mockKV.put).toHaveBeenCalledWith('sinaps:ttl-key', '"data"', {
      expirationTtl: 60,
    });

    await storage.set('ttl-key-2', 'data', 300);
    expect(mockKV.put).toHaveBeenCalledWith('sinaps:ttl-key-2', '"data"', {
      expirationTtl: 300,
    });
  });

  it('should support custom prefix', async () => {
    const storage = new CloudflareKVStorage(mockKV, { prefix: 'myapp:' });

    await storage.set('key1', 'value1');
    expect(mockKV.put).toHaveBeenCalledWith('myapp:key1', '"value1"', {});
  });

  it('should return null for missing keys', async () => {
    const storage = new CloudflareKVStorage(mockKV);
    const result = await storage.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should increment atomically', async () => {
    const storage = new CloudflareKVStorage(mockKV);

    const val1 = await storage.increment('counter');
    expect(val1).toBe(1);

    const val2 = await storage.increment('counter');
    expect(val2).toBe(2);
  });

  it('should delete keys', async () => {
    const storage = new CloudflareKVStorage(mockKV);

    await storage.set('to-delete', 'data');
    await storage.delete('to-delete');
    expect(mockKV.delete).toHaveBeenCalledWith('sinaps:to-delete');
  });

  it('should clear all keys with matching prefix', async () => {
    const storage = new CloudflareKVStorage(mockKV);

    await storage.set('key1', 'a');
    await storage.set('key2', 'b');
    await storage.clear();
    expect(mockKV.delete).toHaveBeenCalled();
  });

  it('should handle malformed JSON gracefully', async () => {
    store.set('sinaps:bad-json', 'not-json{');
    const storage = new CloudflareKVStorage(mockKV);
    const result = await storage.get('bad-json');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────
// REDIS STORAGE
// ────────────────────────────────────────────────
describe('RedisStorage', () => {
  let store: Map<string, string>;
  let mockRedis: RedisClientLike;

  beforeEach(() => {
    store = new Map();
    mockRedis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) count++;
        }
        return count;
      }),
      incr: vi.fn(async (key: string) => {
        const current = store.get(key);
        const newVal = (current ? Number.parseInt(current, 10) : 0) + 1;
        store.set(key, String(newVal));
        return newVal;
      }),
      keys: vi.fn(async (pattern: string) => {
        const prefix = pattern.replace('*', '');
        return [...store.keys()].filter((k) => k.startsWith(prefix));
      }),
    };
  });

  it('should get and set values with JSON serialization', async () => {
    const storage = new RedisStorage(mockRedis);

    await storage.set('test-key', { status: 'active' });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'sinaps:test-key',
      '{"status":"active"}',
    );

    const result = await storage.get<{ status: string }>('test-key');
    expect(result).toEqual({ status: 'active' });
  });

  it('should set values with EX TTL', async () => {
    const storage = new RedisStorage(mockRedis);

    await storage.set('ttl-key', 'data', 120);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'sinaps:ttl-key',
      '"data"',
      'EX',
      120,
    );
  });

  it('should use atomic INCR for counters', async () => {
    const storage = new RedisStorage(mockRedis);

    const val1 = await storage.increment('counter');
    expect(val1).toBe(1);
    expect(mockRedis.incr).toHaveBeenCalledWith('sinaps:counter');

    const val2 = await storage.increment('counter');
    expect(val2).toBe(2);
  });

  it('should support custom prefix', async () => {
    const storage = new RedisStorage(mockRedis, { prefix: 'app:' });

    await storage.set('session', 'token123');
    expect(mockRedis.set).toHaveBeenCalledWith('app:session', '"token123"');
  });

  it('should return null for missing keys', async () => {
    const storage = new RedisStorage(mockRedis);
    const result = await storage.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete keys', async () => {
    const storage = new RedisStorage(mockRedis);
    await storage.set('to-delete', 'val');
    await storage.delete('to-delete');
    expect(mockRedis.del).toHaveBeenCalledWith('sinaps:to-delete');
  });

  it('should clear all keys with matching prefix via KEYS fallback', async () => {
    const storage = new RedisStorage(mockRedis);

    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.clear();
    expect(mockRedis.keys).toHaveBeenCalledWith('sinaps:*');
  });

  it('should handle malformed JSON gracefully', async () => {
    store.set('sinaps:bad-json', '{broken');
    const storage = new RedisStorage(mockRedis);
    const result = await storage.get('bad-json');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────
// CLOUDFLARE D1 STORAGE
// ────────────────────────────────────────────────
describe('D1Storage', () => {
  let rows: Map<string, { value: string; expires_at: number | null }>;
  let mockDb: D1DatabaseLike;

  beforeEach(() => {
    rows = new Map();

    const createPreparedStatement = (
      query: string,
    ): D1PreparedStatementLike => {
      let boundValues: unknown[] = [];

      const statement: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          boundValues = values;
          return statement;
        },
        async first<T>(): Promise<T | null> {
          // SELECT query
          if (query.includes('SELECT value FROM')) {
            const key = boundValues[0] as string;
            const now = boundValues[1] as number;
            const row = rows.get(key);
            if (!row || (row.expires_at !== null && now > row.expires_at)) {
              return null;
            }
            return { value: row.value } as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async run() {
          if (query.includes('INSERT OR REPLACE')) {
            const key = boundValues[0] as string;
            if (typeof boundValues[1] === 'string') {
              const value = boundValues[1] as string;
              const expiresAt = (boundValues[2] as number | null) ?? null;
              rows.set(key, { value, expires_at: expiresAt });
            }
          } else if (
            query.includes('DELETE') &&
            query.includes('WHERE key = ?')
          ) {
            const key = boundValues[0] as string;
            rows.delete(key);
          } else if (query.includes('DELETE') && !query.includes('WHERE key')) {
            if (query.includes('expires_at')) {
              // purgeExpired
              const now = boundValues[0] as number;
              for (const [k, v] of rows.entries()) {
                if (v.expires_at !== null && v.expires_at <= now) {
                  rows.delete(k);
                }
              }
            } else {
              rows.clear();
            }
          }
          return { success: true };
        },
      };
      return statement;
    };

    mockDb = {
      prepare: vi.fn(createPreparedStatement),
      exec: vi.fn(async () => ({})),
      batch: vi.fn(async () => []),
    };
  });

  it('should auto-migrate table on first operation', async () => {
    const storage = new D1Storage(mockDb);
    await storage.set('test', 'value');
    expect(mockDb.exec).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS'),
    );
  });

  it('should get and set values', async () => {
    const storage = new D1Storage(mockDb);

    await storage.set('key1', { name: 'SinapsAI' });
    const result = await storage.get<{ name: string }>('key1');
    expect(result).toEqual({ name: 'SinapsAI' });
  });

  it('should return null for missing keys', async () => {
    const storage = new D1Storage(mockDb);
    const result = await storage.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should support TTL via expires_at', async () => {
    const storage = new D1Storage(mockDb);

    await storage.set('ttl-key', 'temp', 300);
    const row = rows.get('ttl-key');
    expect(row).toBeDefined();
    expect(row?.expires_at).toBeGreaterThan(0);
  });

  it('should delete keys', async () => {
    const storage = new D1Storage(mockDb);

    await storage.set('to-delete', 'data');
    expect(rows.has('to-delete')).toBe(true);

    await storage.delete('to-delete');
    expect(rows.has('to-delete')).toBe(false);
  });

  it('should increment values', async () => {
    const storage = new D1Storage(mockDb);

    const val1 = await storage.increment('counter');
    expect(val1).toBe(1);

    const val2 = await storage.increment('counter');
    expect(val2).toBe(2);
  });

  it('should clear all entries', async () => {
    const storage = new D1Storage(mockDb);

    await storage.set('a', '1');
    await storage.set('b', '2');
    await storage.clear();
    expect(rows.size).toBe(0);
  });

  it('should purge expired entries', async () => {
    const storage = new D1Storage(mockDb);

    // Insert expired entry
    rows.set('expired', {
      value: '"old"',
      expires_at: Math.floor(Date.now() / 1000) - 100,
    });
    rows.set('valid', { value: '"current"', expires_at: null });

    await storage.purgeExpired();
    expect(rows.has('expired')).toBe(false);
    expect(rows.has('valid')).toBe(true);
  });

  it('should use custom table name', async () => {
    const storage = new D1Storage(mockDb, { tableName: 'custom_store' });
    await storage.set('test', 'val');
    expect(mockDb.exec).toHaveBeenCalledWith(
      expect.stringContaining('custom_store'),
    );
  });
});
