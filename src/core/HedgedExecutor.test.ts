/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  Provider,
  UnifiedApiRequest,
  UnifiedApiResponse,
} from '../types/index.js';
import { HedgedExecutor } from './HedgedExecutor.js';

describe('HedgedExecutor', () => {
  const p1: Provider = {
    id: 'p1',
    name: 'PrimaryProvider',
    generateContent: vi.fn(),
  };
  const p2: Provider = {
    id: 'p2',
    name: 'BackupProvider1',
    generateContent: vi.fn(),
  };

  const req: UnifiedApiRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'fast test' }],
  };

  it('resolves primary provider directly when it finishes before delayMs', async () => {
    const mockRes: UnifiedApiResponse = {
      id: 'res-fast',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Fast primary' } }],
    };

    const hedgeFired = vi.fn();
    const hedgeWon = vi.fn();

    const executor = new HedgedExecutor({
      delayMs: 100,
      onHedgeFired: hedgeFired,
      onHedgeWon: hedgeWon,
    });

    const dispatcher = vi.fn().mockResolvedValue(mockRes);

    const result = await executor.execute([p1, p2], req, dispatcher);

    expect(result.response.choices[0].message.content).toBe('Fast primary');
    expect(result.winnerProvider.id).toBe('p1');
    expect(result.wasHedged).toBe(false);
    expect(hedgeFired).not.toHaveBeenCalled();
    expect(hedgeWon).not.toHaveBeenCalled();
  });

  it('fires hedge and allows backup provider to win when primary is slow', async () => {
    const primaryRes: UnifiedApiResponse = {
      id: 'res-slow',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Slow primary' } }],
    };
    const backupRes: UnifiedApiResponse = {
      id: 'res-fast-backup',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Fast backup' } }],
    };

    const hedgeFired = vi.fn();
    const hedgeWon = vi.fn();

    const executor = new HedgedExecutor({
      delayMs: 30,
      maxHedges: 1,
      onHedgeFired: hedgeFired,
      onHedgeWon: hedgeWon,
    });

    const dispatcher = vi
      .fn()
      .mockImplementation((provider: Provider, _r: UnifiedApiRequest) => {
        if (provider.id === 'p1') {
          // Slow: 150ms
          return new Promise((resolve) =>
            setTimeout(() => resolve(primaryRes), 150),
          );
        }
        // Backup fast: 10ms
        return new Promise((resolve) =>
          setTimeout(() => resolve(backupRes), 10),
        );
      });

    const result = await executor.execute([p1, p2], req, dispatcher);

    expect(result.response.choices[0].message.content).toBe('Fast backup');
    expect(result.winnerProvider.id).toBe('p2');
    expect(result.wasHedged).toBe(true);
    expect(hedgeFired).toHaveBeenCalledWith(p1, p2, 30);
    expect(hedgeWon).toHaveBeenCalledWith(p2, expect.any(Number));
  });

  it('bypasses hedging when disabled or for streaming requests', async () => {
    const executor = new HedgedExecutor({ enabled: false });
    const mockRes: UnifiedApiResponse = {
      id: 'res-disabled',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'No hedging' } }],
    };

    const dispatcher = vi.fn().mockResolvedValue(mockRes);
    const result = await executor.execute([p1, p2], req, dispatcher);

    expect(result.wasHedged).toBe(false);
    expect(dispatcher).toHaveBeenCalledTimes(1);

    // Streaming request
    const streamReq: UnifiedApiRequest = { ...req, stream: true };
    const streamResult = await executor.execute(
      [p1, p2],
      streamReq,
      dispatcher,
    );
    expect(streamResult.wasHedged).toBe(false);
  });

  it('throws when all hedged providers fail', async () => {
    const executor = new HedgedExecutor({ delayMs: 10, maxHedges: 1 });
    const dispatcher = vi.fn().mockRejectedValue(new Error('Provider timeout'));

    await expect(executor.execute([p1, p2], req, dispatcher)).rejects.toThrow(
      'Provider timeout',
    );
  });
});
