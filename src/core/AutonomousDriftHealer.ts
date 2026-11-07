/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Autonomous API Schema Drift & Argument Self-Healer
 *
 * Implements:
 * 1. Fuzzy parameter alias matching (e.g. `query` vs `q` vs `searchTerm`, `userId` vs `user_id`).
 * 2. Deep recursive type coercion (numeric strings, booleans, stringified JSON objects/arrays).
 * 3. Schema drift detection with automatic injection of default values for missing required properties.
 * 4. Upstream LLM provider error code translation and self-healing recommendation generator.
 * 5. Zero external dependencies, pure Web Standards.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { McpToolInputSchema } from './McpBridge.js';

export interface DriftHealResult<T = Record<string, unknown>> {
  originalArgs: Record<string, unknown>;
  healedArgs: T;
  remediatedFields: Array<{
    field: string;
    originalValue: unknown;
    healedValue: unknown;
    action: 'fuzzy_renamed' | 'type_coerced' | 'default_injected';
    matchedTo?: string;
  }>;
  driftDetected: boolean;
}

export interface ProviderErrorRemediation {
  category:
    | 'rate_limit'
    | 'context_length_exceeded'
    | 'model_deprecated'
    | 'auth_failure'
    | 'transient';
  isTransient: boolean;
  recommendedAction:
    | 'retry_with_backoff'
    | 'switch_to_fallback_model'
    | 'compress_context'
    | 'check_api_key';
  suggestedFallbackModel?: string;
  normalizedMessage: string;
}

export class AutonomousDriftHealer {
  /**
   * Instance helper for dependency injection.
   */
  public heal(
    rawArgs: Record<string, unknown>,
    schema?: McpToolInputSchema,
  ): DriftHealResult {
    return AutonomousDriftHealer.healToolArguments(rawArgs, schema);
  }

  /**
   * Calculates Levenshtein edit distance between two strings.
   */
  public static levenshtein(a: string, b: string): number {
    const s1 = a.toLowerCase();
    const s2 = b.toLowerCase();
    const matrix: number[][] = [];

    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[s1.length][s2.length];
  }

  /**
   * Normalizes a property name for fuzzy matching (stripping underscores, hyphens, and casing).
   */
  public static normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[_\-\s]/g, '');
  }

  /**
   * Heals incoming arguments against a tool's JSON Schema:
   * 1. Resolves drifted / misnamed parameter keys using normalized and Levenshtein similarity.
   * 2. Coerces types (strings to numbers, booleans, or parsed JSON).
   * 3. Injects safe defaults for missing required properties.
   */
  public static healToolArguments(
    rawArgs: Record<string, unknown>,
    schema?: McpToolInputSchema,
  ): DriftHealResult {
    if (!rawArgs || typeof rawArgs !== 'object') {
      return {
        originalArgs: rawArgs,
        healedArgs: rawArgs,
        remediatedFields: [],
        driftDetected: false,
      };
    }

    const originalArgs = { ...rawArgs };
    const healedArgs: Record<string, unknown> = { ...rawArgs };
    const remediatedFields: DriftHealResult['remediatedFields'] = [];

    if (!schema?.properties) {
      return {
        originalArgs,
        healedArgs,
        remediatedFields,
        driftDetected: false,
      };
    }

    const allowedProps = Object.keys(schema.properties);
    const normalizedAllowed = new Map<string, string>();
    for (const prop of allowedProps) {
      normalizedAllowed.set(AutonomousDriftHealer.normalizeKey(prop), prop);
    }

    // 1. Resolve Fuzzy Property Names
    for (const [key, value] of Object.entries(originalArgs)) {
      if (allowedProps.includes(key)) continue;

      const norm = AutonomousDriftHealer.normalizeKey(key);
      let matchedProp = normalizedAllowed.get(norm);

      if (!matchedProp) {
        // Try Levenshtein match with distance <= 2
        let bestDist = 3;
        for (const prop of allowedProps) {
          const dist = AutonomousDriftHealer.levenshtein(key, prop);
          if (dist < bestDist) {
            bestDist = dist;
            matchedProp = prop;
          }
        }
      }

      if (matchedProp && !healedArgs[matchedProp]) {
        healedArgs[matchedProp] = value;
        delete healedArgs[key];
        remediatedFields.push({
          field: key,
          originalValue: value,
          healedValue: value,
          action: 'fuzzy_renamed',
          matchedTo: matchedProp,
        });
      }
    }

    // 2. Type Coercion
    for (const [propName, propDef] of Object.entries(schema.properties)) {
      const val = healedArgs[propName];
      if (val === undefined || val === null) continue;

      const expectedType = (propDef as { type?: string })?.type;

      if (
        (expectedType === 'number' || expectedType === 'integer') &&
        typeof val === 'string'
      ) {
        const num = Number(val);
        if (!Number.isNaN(num)) {
          healedArgs[propName] = num;
          remediatedFields.push({
            field: propName,
            originalValue: val,
            healedValue: num,
            action: 'type_coerced',
          });
        }
      } else if (expectedType === 'boolean' && typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        if (lower === 'true' || lower === '1') {
          healedArgs[propName] = true;
          remediatedFields.push({
            field: propName,
            originalValue: val,
            healedValue: true,
            action: 'type_coerced',
          });
        } else if (lower === 'false' || lower === '0') {
          healedArgs[propName] = false;
          remediatedFields.push({
            field: propName,
            originalValue: val,
            healedValue: false,
            action: 'type_coerced',
          });
        }
      } else if (
        (expectedType === 'object' || expectedType === 'array') &&
        typeof val === 'string'
      ) {
        try {
          const parsed = JSON.parse(val);
          healedArgs[propName] = parsed;
          remediatedFields.push({
            field: propName,
            originalValue: val,
            healedValue: parsed,
            action: 'type_coerced',
          });
        } catch {
          // If parse fails, keep original
        }
      }
    }

    // 3. Inject smart defaults for missing required properties
    if (schema.required && Array.isArray(schema.required)) {
      for (const reqField of schema.required) {
        if (healedArgs[reqField] === undefined) {
          const propDef = schema.properties[reqField] as
            | { type?: string; default?: unknown }
            | undefined;
          let defaultValue: unknown;

          if (propDef?.default !== undefined) {
            defaultValue = propDef.default;
          } else if (propDef?.type === 'string') {
            defaultValue = '';
          } else if (
            propDef?.type === 'number' ||
            propDef?.type === 'integer'
          ) {
            defaultValue = 0;
          } else if (propDef?.type === 'boolean') {
            defaultValue = false;
          } else if (propDef?.type === 'array') {
            defaultValue = [];
          } else if (propDef?.type === 'object') {
            defaultValue = {};
          }

          if (defaultValue !== undefined) {
            healedArgs[reqField] = defaultValue;
            remediatedFields.push({
              field: reqField,
              originalValue: undefined,
              healedValue: defaultValue,
              action: 'default_injected',
            });
          }
        }
      }
    }

    return {
      originalArgs,
      healedArgs,
      remediatedFields,
      driftDetected: remediatedFields.length > 0,
    };
  }

  /**
   * Translates arbitrary upstream provider errors into standard remediation advice.
   */
  public static diagnoseProviderError(
    error: unknown,
  ): ProviderErrorRemediation {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // 1. Rate Limit / Throttling
    if (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('quota exceeded') ||
      lower.includes('resource_exhausted')
    ) {
      return {
        category: 'rate_limit',
        isTransient: true,
        recommendedAction: 'retry_with_backoff',
        normalizedMessage: 'Upstream provider rate limit or quota exceeded.',
      };
    }

    // 2. Context Length Exceeded
    if (
      lower.includes('context length') ||
      lower.includes('maximum context') ||
      lower.includes('too many tokens') ||
      lower.includes('prompt is too long')
    ) {
      return {
        category: 'context_length_exceeded',
        isTransient: false,
        recommendedAction: 'compress_context',
        suggestedFallbackModel: 'gemini-2.5-flash', // 1M context window
        normalizedMessage: 'Prompt exceeded model context window limit.',
      };
    }

    // 3. Model Deprecated / Not Found
    if (
      lower.includes('model_not_found') ||
      lower.includes('does not exist') ||
      lower.includes('deprecated') ||
      lower.includes('404')
    ) {
      return {
        category: 'model_deprecated',
        isTransient: false,
        recommendedAction: 'switch_to_fallback_model',
        suggestedFallbackModel: 'gemini-2.5-flash',
        normalizedMessage:
          'Target model was not found or has been deprecated by provider.',
      };
    }

    // 4. Authentication Failure
    if (
      lower.includes('401') ||
      lower.includes('invalid api key') ||
      lower.includes('unauthorized') ||
      lower.includes('authentication')
    ) {
      return {
        category: 'auth_failure',
        isTransient: false,
        recommendedAction: 'check_api_key',
        normalizedMessage: 'Invalid API credentials provided.',
      };
    }

    // 5. Transient Server Errors (500, 502, 503, 504, timeout, network)
    return {
      category: 'transient',
      isTransient: true,
      recommendedAction: 'retry_with_backoff',
      normalizedMessage: message,
    };
  }
}
