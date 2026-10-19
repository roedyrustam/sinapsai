import { describe, expect, it } from 'vitest';
import { linkAbortSignal } from './signal.js';

describe('linkAbortSignal', () => {
  it('should return undefined if source signal is undefined', () => {
    const target = new AbortController();
    const cleanup = linkAbortSignal(target, undefined);
    expect(cleanup).toBeUndefined();
    expect(target.signal.aborted).toBe(false);
  });

  it('should immediately abort target if source signal is already aborted', () => {
    const target = new AbortController();
    const source = new AbortController();
    source.abort();

    const cleanup = linkAbortSignal(target, source.signal);
    expect(cleanup).toBeUndefined();
    expect(target.signal.aborted).toBe(true);
  });

  it('should abort target when source signal aborts subsequently', () => {
    const target = new AbortController();
    const source = new AbortController();

    const cleanup = linkAbortSignal(target, source.signal);
    expect(cleanup).toBeDefined();
    expect(target.signal.aborted).toBe(false);

    source.abort();
    expect(target.signal.aborted).toBe(true);

    cleanup?.();
  });

  it('should detach listener and prevent target abort if cleanup is called before source aborts', () => {
    const target = new AbortController();
    const source = new AbortController();

    const cleanup = linkAbortSignal(target, source.signal);
    expect(cleanup).toBeDefined();

    // Invoke cleanup before source aborts
    cleanup?.();

    source.abort();
    expect(target.signal.aborted).toBe(false);
  });
});
