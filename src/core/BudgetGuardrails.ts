/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { SinapsMetrics } from '../types/index.js';

export type BudgetAction = 'block' | 'warn';

export interface BudgetGuardrailsOptions {
  enabled?: boolean;
  /**
   * Maximum cumulative spend in USD allowed before triggering action.
   */
  maxCostUsd?: number;
  /**
   * Maximum cumulative tokens (prompt + completion) allowed before triggering action.
   */
  maxTotalTokens?: number;
  /**
   * Soft warning threshold ratio between 0 and 1 (default: 0.80 = 80% of budget).
   */
  warningThresholdRatio?: number;
  /**
   * Action when hard limit is reached: 'block' throws BudgetExceededError, 'warn' only triggers callback.
   * Default: 'block'
   */
  action?: BudgetAction;
  /**
   * Callback fired when spend or token usage crosses the warning threshold or hard limit.
   */
  onBudgetAlert?: (alert: BudgetAlert) => void;
}

export interface BudgetAlert {
  type: 'cost_warning' | 'cost_exceeded' | 'token_warning' | 'token_exceeded';
  currentValue: number;
  limitValue: number;
  percentage: number;
  timestamp: number;
}

export class BudgetExceededError extends Error {
  public readonly alert: BudgetAlert;

  constructor(message: string, alert: BudgetAlert) {
    super(message);
    this.name = 'BudgetExceededError';
    this.alert = alert;
  }
}

export class BudgetGuardrails {
  private options: Required<
    Pick<
      BudgetGuardrailsOptions,
      'enabled' | 'warningThresholdRatio' | 'action'
    >
  > &
    BudgetGuardrailsOptions;

  constructor(options: BudgetGuardrailsOptions = {}) {
    this.options = {
      ...options,
      enabled: options.enabled ?? true,
      warningThresholdRatio: options.warningThresholdRatio ?? 0.8,
      action: options.action ?? 'block',
    };
  }

  /**
   * Evaluates current gateway telemetry metrics against configured budget limits.
   * Throws BudgetExceededError if action is 'block' and hard limits are reached.
   */
  public evaluate(
    metrics: Pick<SinapsMetrics, 'estimatedCostUsd' | 'totalTokens'>,
  ): BudgetAlert[] {
    if (!this.options.enabled) return [];

    const alerts: BudgetAlert[] = [];
    const now = Date.now();

    // 1. Check USD Cost Limit
    if (this.options.maxCostUsd !== undefined && this.options.maxCostUsd > 0) {
      const currentCost = metrics.estimatedCostUsd;
      const limitCost = this.options.maxCostUsd;
      const ratio = currentCost / limitCost;
      const percentage = Math.round(ratio * 1000) / 10;

      if (currentCost >= limitCost) {
        const alert: BudgetAlert = {
          type: 'cost_exceeded',
          currentValue: currentCost,
          limitValue: limitCost,
          percentage,
          timestamp: now,
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);

        if (this.options.action === 'block') {
          throw new BudgetExceededError(
            `SinapsAI Budget Guardrail: Cumulative cost ($${currentCost.toFixed(4)} USD) exceeded limit ($${limitCost.toFixed(4)} USD).`,
            alert,
          );
        }
      } else if (ratio >= this.options.warningThresholdRatio) {
        const alert: BudgetAlert = {
          type: 'cost_warning',
          currentValue: currentCost,
          limitValue: limitCost,
          percentage,
          timestamp: now,
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
      }
    }

    // 2. Check Total Tokens Limit
    if (
      this.options.maxTotalTokens !== undefined &&
      this.options.maxTotalTokens > 0
    ) {
      const currentTokens = metrics.totalTokens;
      const limitTokens = this.options.maxTotalTokens;
      const ratio = currentTokens / limitTokens;
      const percentage = Math.round(ratio * 1000) / 10;

      if (currentTokens >= limitTokens) {
        const alert: BudgetAlert = {
          type: 'token_exceeded',
          currentValue: currentTokens,
          limitValue: limitTokens,
          percentage,
          timestamp: now,
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);

        if (this.options.action === 'block') {
          throw new BudgetExceededError(
            `SinapsAI Budget Guardrail: Total token usage (${currentTokens}) exceeded limit (${limitTokens}).`,
            alert,
          );
        }
      } else if (ratio >= this.options.warningThresholdRatio) {
        const alert: BudgetAlert = {
          type: 'token_warning',
          currentValue: currentTokens,
          limitValue: limitTokens,
          percentage,
          timestamp: now,
        };
        alerts.push(alert);
        this.options.onBudgetAlert?.(alert);
      }
    }

    return alerts;
  }
}
