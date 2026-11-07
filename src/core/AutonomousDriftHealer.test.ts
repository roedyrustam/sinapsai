import { describe, expect, it } from 'vitest';
import { AutonomousDriftHealer } from './AutonomousDriftHealer.js';
import type { McpToolInputSchema } from './McpBridge.js';

describe('AutonomousDriftHealer (API Schema Drift & Self-Healing)', () => {
  it('corrects fuzzy and misnamed parameter keys to match schema', () => {
    const schema: McpToolInputSchema = {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        searchQuery: { type: 'string' },
        maxResults: { type: 'number' },
      },
      required: ['userId'],
    };

    const driftedArgs = {
      user_id: 'usr_999', // underscore vs camelCase
      search_query: 'quantum computing', // underscore vs camelCase
      maxResults: '25', // string number
    };

    const healed = AutonomousDriftHealer.healToolArguments(driftedArgs, schema);

    expect(healed.driftDetected).toBe(true);
    expect(healed.healedArgs.userId).toBe('usr_999');
    expect(healed.healedArgs.searchQuery).toBe('quantum computing');
    expect(healed.healedArgs.maxResults).toBe(25);
    expect(
      (healed.healedArgs as Record<string, unknown>).user_id,
    ).toBeUndefined();
  });

  it('coerces stringified booleans and JSON objects/arrays', () => {
    const schema: McpToolInputSchema = {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean' },
        metadata: { type: 'object' },
        tags: { type: 'array' },
      },
    };

    const driftedArgs = {
      dryRun: 'true',
      metadata: '{"env":"production","region":"asia"}',
      tags: '["ai","gateway","resilience"]',
    };

    const healed = AutonomousDriftHealer.healToolArguments(driftedArgs, schema);

    expect(healed.healedArgs.dryRun).toBe(true);
    expect(healed.healedArgs.metadata).toEqual({
      env: 'production',
      region: 'asia',
    });
    expect(healed.healedArgs.tags).toEqual(['ai', 'gateway', 'resilience']);
  });

  it('injects safe defaults for missing required properties', () => {
    const schema: McpToolInputSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number', default: 10 },
        active: { type: 'boolean' },
      },
      required: ['title', 'count', 'active'],
    };

    const partialArgs = {};
    const healed = AutonomousDriftHealer.healToolArguments(partialArgs, schema);

    expect(healed.healedArgs.title).toBe('');
    expect(healed.healedArgs.count).toBe(10);
    expect(healed.healedArgs.active).toBe(false);
  });

  it('diagnoses upstream provider errors with actionable remediation advice', () => {
    const rateLimit = AutonomousDriftHealer.diagnoseProviderError(
      new Error('Rate limit exceeded (HTTP 429)'),
    );
    expect(rateLimit.category).toBe('rate_limit');
    expect(rateLimit.isTransient).toBe(true);
    expect(rateLimit.recommendedAction).toBe('retry_with_backoff');

    const contextExceeded = AutonomousDriftHealer.diagnoseProviderError(
      new Error('Maximum context length exceeded: 131072 tokens'),
    );
    expect(contextExceeded.category).toBe('context_length_exceeded');
    expect(contextExceeded.isTransient).toBe(false);
    expect(contextExceeded.recommendedAction).toBe('compress_context');

    const deprecated = AutonomousDriftHealer.diagnoseProviderError(
      new Error('Model gpt-3.5-turbo-0613 is deprecated'),
    );
    expect(deprecated.category).toBe('model_deprecated');
    expect(deprecated.recommendedAction).toBe('switch_to_fallback_model');
  });
});
