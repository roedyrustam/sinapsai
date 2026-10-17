/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type BudgetAlert,
  BudgetExceededError,
  BudgetGuardrails,
} from './BudgetGuardrails.js';

describe('BudgetGuardrails', () => {
  it('returns empty alerts when spend and tokens are well below warning threshold', () => {
    const onAlert = vi.fn();
    const bg = new BudgetGuardrails({
      maxCostUsd: 10.0,
      maxTotalTokens: 100000,
      warningThresholdRatio: 0.8,
      onBudgetAlert: onAlert,
    });

    const alerts = bg.evaluate({ estimatedCostUsd: 2.5, totalTokens: 20000 });
    expect(alerts).toHaveLength(0);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('triggers warning alert when usage crosses warningThresholdRatio without throwing', () => {
    const alertsReceived: BudgetAlert[] = [];
    const bg = new BudgetGuardrails({
      maxCostUsd: 10.0,
      warningThresholdRatio: 0.8,
      onBudgetAlert: (a) => alertsReceived.push(a),
    });

    // 8.50 is 85% of 10.00 -> warning
    const alerts = bg.evaluate({ estimatedCostUsd: 8.5, totalTokens: 1000 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('cost_warning');
    expect(alerts[0].currentValue).toBe(8.5);
    expect(alerts[0].limitValue).toBe(10.0);
    expect(alerts[0].percentage).toBe(85);
    expect(alertsReceived).toHaveLength(1);
  });

  it('throws BudgetExceededError when hard limit is exceeded and action is block', () => {
    const bg = new BudgetGuardrails({
      maxCostUsd: 5.0,
      action: 'block',
    });

    expect(() => {
      bg.evaluate({ estimatedCostUsd: 5.5, totalTokens: 1000 });
    }).toThrow(BudgetExceededError);

    try {
      bg.evaluate({ estimatedCostUsd: 5.5, totalTokens: 1000 });
    } catch (e: unknown) {
      const err = e as BudgetExceededError;
      expect(err.name).toBe('BudgetExceededError');
      expect(err.alert.type).toBe('cost_exceeded');
      expect(err.alert.currentValue).toBe(5.5);
    }
  });

  it('does not throw when hard limit is exceeded if action is warn', () => {
    const onAlert = vi.fn();
    const bg = new BudgetGuardrails({
      maxTotalTokens: 5000,
      action: 'warn',
      onBudgetAlert: onAlert,
    });

    const alerts = bg.evaluate({ estimatedCostUsd: 0.1, totalTokens: 5500 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('token_exceeded');
    expect(onAlert).toHaveBeenCalled();
  });

  it('bypasses checks completely when enabled is false', () => {
    const onAlert = vi.fn();
    const bg = new BudgetGuardrails({
      enabled: false,
      maxCostUsd: 1.0,
      action: 'block',
      onBudgetAlert: onAlert,
    });

    const alerts = bg.evaluate({
      estimatedCostUsd: 100.0,
      totalTokens: 1000000,
    });
    expect(alerts).toHaveLength(0);
    expect(onAlert).not.toHaveBeenCalled();
  });
});
