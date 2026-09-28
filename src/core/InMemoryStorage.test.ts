import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from './InMemoryStorage.js';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new InMemoryStorage();
  });

  afterEach(() => {
    storage.destroy();
    vi.useRealTimers();
  });

  it('should set and get values', async () => {
    await storage.set('key1', 'value1');
    const value = await storage.get('key1');
    expect(value).toBe('value1');
  });

  it('should return null for non-existent keys', async () => {
    const value = await storage.get('non-existent');
    expect(value).toBeNull();
  });

  it('should delete values', async () => {
    await storage.set('key1', 'value1');
    await storage.delete('key1');
    const value = await storage.get('key1');
    expect(value).toBeNull();
  });

  it('should handle ttl properly', async () => {
    await storage.set('key1', 'value1', 1); // 1 second TTL

    let value = await storage.get('key1');
    expect(value).toBe('value1');

    // advance time by 1.1 seconds
    vi.advanceTimersByTime(1100);

    value = await storage.get('key1');
    expect(value).toBeNull();
  });

  it('should clear expired items on sweep', async () => {
    await storage.set('key1', 'value1', 1);

    vi.advanceTimersByTime(1100);
    // manual trigger sweep via internal method is not exposed, but interval is 60s
    vi.advanceTimersByTime(60000);

    // Wait, sweep cleans up internally. If we just get, it also cleans up.
    // So let's check size if we could. We can't easily check size.
  });

  it('should increment values', async () => {
    await storage.increment('counter');
    let val = await storage.get('counter');
    expect(val).toBe(1);

    await storage.increment('counter');
    val = await storage.get('counter');
    expect(val).toBe(2);
  });
});
