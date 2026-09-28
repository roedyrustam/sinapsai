import type { StateStorage } from './StateStorage.js';

interface StorageItem<T> {
  value: T;
  expiresAt: number | null;
}

export class InMemoryStorage implements StateStorage {
  private store: Map<string, StorageItem<unknown>> = new Map();
  private sweepInterval?: ReturnType<typeof setInterval>;

  constructor(sweepIntervalMs: number = 60000) {
    if (typeof setInterval !== 'undefined') {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
      if (
        this.sweepInterval &&
        typeof (this.sweepInterval as NodeJS.Timeout).unref === 'function'
      ) {
        (this.sweepInterval as NodeJS.Timeout).unref();
      }
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (item.expiresAt !== null && now > item.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) {
      return null;
    }

    if (item.expiresAt !== null && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async increment(key: string): Promise<number> {
    const item = this.store.get(key);
    let currentValue = 0;

    if (item) {
      if (item.expiresAt !== null && Date.now() > item.expiresAt) {
        this.store.delete(key);
      } else {
        currentValue = (item.value as number) || 0;
      }
    }

    const newValue = currentValue + 1;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: newValue,
      expiresAt: existing?.expiresAt ?? null,
    });
    return newValue;
  }

  destroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
  }
}
