import { describe, expect, it } from 'vitest';
import { SchemaValidationError, s } from './schema.js';

describe('Zero-Dependency Schema Builder (s)', () => {
  it('should validate string schemas with constraints', () => {
    const usernameSchema = s.string({
      min: 3,
      max: 10,
      description: 'Username',
    });
    expect(usernameSchema.parse('alice')).toBe('alice');
    expect(() => usernameSchema.parse('al')).toThrow(SchemaValidationError);
    expect(() => usernameSchema.parse('thisisaverylongusername')).toThrow(
      SchemaValidationError,
    );
    expect(() => usernameSchema.parse(123)).toThrow(SchemaValidationError);
  });

  it('should validate numbers and integers', () => {
    const ageSchema = s.number({ min: 0, max: 120, integer: true });
    expect(ageSchema.parse(25)).toBe(25);
    expect(ageSchema.parse('25')).toBe(25); // string coercion
    expect(() => ageSchema.parse(25.5)).toThrow('integer');
    expect(() => ageSchema.parse(-1)).toThrow('>= 0');
    expect(() => ageSchema.parse(150)).toThrow('<= 120');
  });

  it('should validate booleans with string coercion', () => {
    const activeSchema = s.boolean({ default: false });
    expect(activeSchema.parse(true)).toBe(true);
    expect(activeSchema.parse(false)).toBe(false);
    expect(activeSchema.parse('true')).toBe(true);
    expect(activeSchema.parse('false')).toBe(false);
    expect(activeSchema.parse(undefined)).toBe(false);
  });

  it('should validate arrays with item constraints', () => {
    const tagSchema = s.array(s.string(), { minItems: 1, maxItems: 3 });
    expect(tagSchema.parse(['ai', 'llm'])).toEqual(['ai', 'llm']);
    expect(() => tagSchema.parse([])).toThrow('at least 1');
    expect(() => tagSchema.parse(['a', 'b', 'c', 'd'])).toThrow('at most 3');
  });

  it('should validate nested objects with optional and required fields', () => {
    const userSchema = s.object({
      id: s.string(),
      age: s.number({ min: 18 }),
      email: s.string().optional(),
      role: s.enum(['admin', 'user'] as const),
    });

    const parsed = userSchema.parse({
      id: 'usr_1',
      age: 21,
      role: 'admin',
    });

    expect(parsed).toEqual({
      id: 'usr_1',
      age: 21,
      role: 'admin',
    });

    expect(() =>
      userSchema.parse({
        id: 'usr_2',
        role: 'superadmin',
      }),
    ).toThrow();
  });

  it('should generate valid JSON Schema for OpenAI and MCP tools', () => {
    const weatherParams = s.object(
      {
        location: s.string({ description: 'City and state' }),
        unit: s
          .enum(['celsius', 'fahrenheit'] as const)
          .describe('Temperature unit'),
        forecastDays: s.number({ min: 1, max: 7 }).default(3),
      },
      { description: 'Weather function parameters' },
    );

    const jsonSchema = weatherParams.toJsonSchema();
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.required).toContain('location');
    expect(jsonSchema.required).toContain('unit');
    expect(jsonSchema.required).not.toContain('forecastDays');
    expect(jsonSchema.properties?.location.type).toBe('string');
    expect(jsonSchema.properties?.unit.enum).toEqual(['celsius', 'fahrenheit']);
    expect(jsonSchema.properties?.forecastDays.default).toBe(3);

    const toolDef = s.toToolDefinition(
      'getWeather',
      'Fetch weather for location',
      weatherParams,
    );
    expect(toolDef.type).toBe('function');
    expect(toolDef.function.name).toBe('getWeather');
    expect(toolDef.function.parameters).toEqual(jsonSchema);

    const mcpTool = s.toMcpTool(
      'getWeather',
      'Fetch weather for location',
      weatherParams,
    );
    expect(mcpTool.name).toBe('getWeather');
    expect(mcpTool.inputSchema).toEqual(jsonSchema);
  });
});
