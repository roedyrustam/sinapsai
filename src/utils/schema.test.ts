import { describe, expect, it } from 'vitest';
import {
  jsonSchema,
  SchemaValidationError,
  s,
  tool,
  toStandardJsonSchema,
  validateSchema,
} from './schema.js';

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

  describe('Standard Schema & Universal Resolver', () => {
    it('should detect and validate Standard Schema v1 objects', async () => {
      const mockStandardSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test-vendor',
          validate: (val: unknown) => {
            if (
              typeof val === 'object' &&
              val !== null &&
              typeof (val as { name?: string }).name === 'string'
            ) {
              return { value: val as { name: string } };
            }
            return {
              issues: [{ message: 'Expected name to be string' }],
            };
          },
        },
      };

      const validRes = await validateSchema(mockStandardSchema, {
        name: 'Bob',
      });
      expect(validRes.success).toBe(true);
      if (validRes.success) {
        expect(validRes.data).toEqual({ name: 'Bob' });
      }

      const invalidRes = await validateSchema(mockStandardSchema, {
        name: 123,
      });
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.errors[0]).toBe('Expected name to be string');
      }
    });

    it('should convert duck-typed Zod schemas into JSON Schema without zod dependency', () => {
      // Mocking Zod schema structure directly
      const mockZodObject = {
        _def: {
          typeName: 'ZodObject',
          description: 'User details',
          shape: () => ({
            username: {
              _def: {
                typeName: 'ZodString',
                checks: [
                  { kind: 'min', value: 3 },
                  { kind: 'max', value: 20 },
                ],
              },
            },
            age: {
              _def: {
                typeName: 'ZodNumber',
                checks: [{ kind: 'int' }, { kind: 'min', value: 18 }],
              },
            },
            role: {
              _def: {
                typeName: 'ZodEnum',
                values: ['admin', 'viewer'],
              },
            },
            bio: {
              _def: {
                typeName: 'ZodOptional',
                innerType: {
                  _def: { typeName: 'ZodString' },
                },
              },
            },
          }),
        },
        safeParse: (val: unknown) => {
          if (typeof val === 'object' && val !== null) {
            return { success: true, data: val };
          }
          return { success: false, error: new Error('Invalid zod object') };
        },
      };

      const converted = toStandardJsonSchema(mockZodObject);
      expect(converted.type).toBe('object');
      expect(converted.description).toBe('User details');
      expect(converted.required).toContain('username');
      expect(converted.required).toContain('age');
      expect(converted.required).toContain('role');
      expect(converted.required).not.toContain('bio');

      expect(converted.properties?.username.type).toBe('string');
      expect(converted.properties?.username.minLength).toBe(3);
      expect(converted.properties?.age.type).toBe('integer');
      expect(converted.properties?.age.minimum).toBe(18);
      expect(converted.properties?.role.enum).toEqual(['admin', 'viewer']);
      expect(converted.properties?.bio.type).toBe('string');
    });

    it('should generate OpenAI ResponseFormat via jsonSchema() helper', () => {
      const userSchema = s.object({
        id: s.string(),
        score: s.number(),
      });

      const format = jsonSchema('UserScore', userSchema, {
        description: 'Output user score',
        strict: true,
      });

      expect(format.type).toBe('json_schema');
      expect(format.json_schema?.name).toBe('UserScore');
      expect(format.json_schema?.description).toBe('Output user score');
      expect(format.json_schema?.strict).toBe(true);
      expect(format.json_schema?.schema.type).toBe('object');
      expect(format.json_schema?.schema.properties?.id.type).toBe('string');
    });

    it('should generate ToolDefinition via tool() helper', () => {
      const calculateParams = s.object({
        expression: s.string({ description: 'Mathematical expression' }),
      });

      const toolDef = tool(
        'calculate',
        'Evaluate math formula',
        calculateParams,
      );
      expect(toolDef.type).toBe('function');
      expect(toolDef.function.name).toBe('calculate');
      expect(toolDef.function.description).toBe('Evaluate math formula');
      expect(toolDef.function.parameters.type).toBe('object');
    });
  });
});
