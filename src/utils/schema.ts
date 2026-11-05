/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Zero-Dependency Type-Safe Schema Builder
 *
 * Provides a lightweight, Zod-like fluent schema declaration engine
 * that compiles directly to standard JSON Schema (OpenAI / MCP compatible)
 * with built-in runtime validation and inference without external dependencies.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ResponseFormat, ToolDefinition } from '../types/index.js';

export class SchemaValidationError extends Error {
  public readonly path: string;
  public readonly received: unknown;

  constructor(message: string, path = '', received: unknown = undefined) {
    super(
      path
        ? `Validation error at "${path}": ${message}`
        : `Validation error: ${message}`,
    );
    this.name = 'SchemaValidationError';
    this.path = path;
    this.received = received;
  }
}

export interface JsonSchemaObject {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JsonSchemaObject;
  default?: unknown;
  [key: string]: unknown;
}

export interface SchemaNode<T = unknown> {
  readonly _type: T;
  readonly isOptional: boolean;
  description?: string;
  defaultValue?: T;
  toJsonSchema(): JsonSchemaObject;
  parse(value: unknown, path?: string): T;
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: SchemaValidationError };
  optional(): SchemaNode<T | undefined>;
  describe(description: string): this;
  default(val: T): this;
}

export type InferSchema<T> = T extends SchemaNode<infer U> ? U : never;

abstract class BaseSchemaNode<T> implements SchemaNode<T> {
  readonly _type!: T;
  public isOptional = false;
  public description?: string;
  public defaultValue?: T;

  abstract toJsonSchema(): JsonSchemaObject;
  abstract parse(value: unknown, path?: string): T;

  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: SchemaValidationError } {
    try {
      return { success: true, data: this.parse(value) };
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        return { success: false, error: err };
      }
      return {
        success: false,
        error: new SchemaValidationError(
          err instanceof Error ? err.message : String(err),
        ),
      };
    }
  }

  optional(): SchemaNode<T | undefined> {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone.isOptional = true;
    return clone;
  }

  describe(desc: string): this {
    this.description = desc;
    return this;
  }

  default(val: T): this {
    this.defaultValue = val;
    this.isOptional = true;
    return this;
  }
}

export interface StringOptions {
  description?: string;
  min?: number;
  max?: number;
  enum?: string[];
  default?: string;
  optional?: boolean;
}

export class StringSchemaNode extends BaseSchemaNode<string> {
  constructor(private options: StringOptions = {}) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
    if (options.default !== undefined) {
      this.defaultValue = options.default;
      this.isOptional = true;
    }
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = { type: 'string' };
    if (this.description) schema.description = this.description;
    if (this.options.min !== undefined) schema.minLength = this.options.min;
    if (this.options.max !== undefined) schema.maxLength = this.options.max;
    if (this.options.enum && this.options.enum.length > 0)
      schema.enum = this.options.enum;
    if (this.defaultValue !== undefined) schema.default = this.defaultValue;
    return schema;
  }

  parse(value: unknown, path = ''): string {
    if (value === undefined || value === null) {
      if (this.defaultValue !== undefined) return this.defaultValue;
      if (this.isOptional) return undefined as unknown as string;
      throw new SchemaValidationError(
        'Expected string, received undefined or null',
        path,
        value,
      );
    }
    if (typeof value !== 'string') {
      throw new SchemaValidationError(
        `Expected string, received ${typeof value}`,
        path,
        value,
      );
    }
    if (this.options.min !== undefined && value.length < this.options.min) {
      throw new SchemaValidationError(
        `String must contain at least ${this.options.min} characters`,
        path,
        value,
      );
    }
    if (this.options.max !== undefined && value.length > this.options.max) {
      throw new SchemaValidationError(
        `String must contain at most ${this.options.max} characters`,
        path,
        value,
      );
    }
    if (this.options.enum && !this.options.enum.includes(value)) {
      throw new SchemaValidationError(
        `Value must be one of: ${this.options.enum.join(', ')}`,
        path,
        value,
      );
    }
    return value;
  }
}

export interface NumberOptions {
  description?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  default?: number;
  optional?: boolean;
}

export class NumberSchemaNode extends BaseSchemaNode<number> {
  constructor(private options: NumberOptions = {}) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
    if (options.default !== undefined) {
      this.defaultValue = options.default;
      this.isOptional = true;
    }
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = {
      type: this.options.integer ? 'integer' : 'number',
    };
    if (this.description) schema.description = this.description;
    if (this.options.min !== undefined) schema.minimum = this.options.min;
    if (this.options.max !== undefined) schema.maximum = this.options.max;
    if (this.defaultValue !== undefined) schema.default = this.defaultValue;
    return schema;
  }

  parse(value: unknown, path = ''): number {
    if (value === undefined || value === null) {
      if (this.defaultValue !== undefined) return this.defaultValue;
      if (this.isOptional) return undefined as unknown as number;
      throw new SchemaValidationError(
        'Expected number, received undefined or null',
        path,
        value,
      );
    }
    let num = value;
    if (
      typeof num === 'string' &&
      num.trim() !== '' &&
      !Number.isNaN(Number(num))
    ) {
      num = Number(num);
    }
    if (typeof num !== 'number' || Number.isNaN(num)) {
      throw new SchemaValidationError(
        `Expected number, received ${typeof value}`,
        path,
        value,
      );
    }
    if (this.options.integer && !Number.isInteger(num)) {
      throw new SchemaValidationError('Expected integer value', path, num);
    }
    if (this.options.min !== undefined && num < this.options.min) {
      throw new SchemaValidationError(
        `Number must be >= ${this.options.min}`,
        path,
        num,
      );
    }
    if (this.options.max !== undefined && num > this.options.max) {
      throw new SchemaValidationError(
        `Number must be <= ${this.options.max}`,
        path,
        num,
      );
    }
    return num;
  }
}

export interface BooleanOptions {
  description?: string;
  default?: boolean;
  optional?: boolean;
}

export class BooleanSchemaNode extends BaseSchemaNode<boolean> {
  constructor(options: BooleanOptions = {}) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
    if (options.default !== undefined) {
      this.defaultValue = options.default;
      this.isOptional = true;
    }
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = { type: 'boolean' };
    if (this.description) schema.description = this.description;
    if (this.defaultValue !== undefined) schema.default = this.defaultValue;
    return schema;
  }

  parse(value: unknown, path = ''): boolean {
    if (value === undefined || value === null) {
      if (this.defaultValue !== undefined) return this.defaultValue;
      if (this.isOptional) return undefined as unknown as boolean;
      throw new SchemaValidationError(
        'Expected boolean, received undefined or null',
        path,
        value,
      );
    }
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new SchemaValidationError(
      `Expected boolean, received ${typeof value}`,
      path,
      value,
    );
  }
}

export interface ArrayOptions {
  description?: string;
  minItems?: number;
  maxItems?: number;
  optional?: boolean;
}

export class ArraySchemaNode<T> extends BaseSchemaNode<T[]> {
  constructor(
    public readonly itemSchema: SchemaNode<T>,
    private options: ArrayOptions = {},
  ) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = {
      type: 'array',
      items: this.itemSchema.toJsonSchema(),
    };
    if (this.description) schema.description = this.description;
    if (this.options.minItems !== undefined)
      schema.minItems = this.options.minItems;
    if (this.options.maxItems !== undefined)
      schema.maxItems = this.options.maxItems;
    return schema;
  }

  parse(value: unknown, path = ''): T[] {
    if (value === undefined || value === null) {
      if (this.isOptional) return undefined as unknown as T[];
      throw new SchemaValidationError(
        'Expected array, received undefined or null',
        path,
        value,
      );
    }
    if (!Array.isArray(value)) {
      throw new SchemaValidationError(
        `Expected array, received ${typeof value}`,
        path,
        value,
      );
    }
    if (
      this.options.minItems !== undefined &&
      value.length < this.options.minItems
    ) {
      throw new SchemaValidationError(
        `Array must contain at least ${this.options.minItems} items`,
        path,
        value,
      );
    }
    if (
      this.options.maxItems !== undefined &&
      value.length > this.options.maxItems
    ) {
      throw new SchemaValidationError(
        `Array must contain at most ${this.options.maxItems} items`,
        path,
        value,
      );
    }
    return value.map((item, idx) =>
      this.itemSchema.parse(item, path ? `${path}[${idx}]` : `[${idx}]`),
    );
  }
}

export type PropertyShape = Record<string, SchemaNode<unknown>>;

export type InferObject<T extends PropertyShape> = {
  [K in keyof T as T[K]['isOptional'] extends true ? never : K]: InferSchema<
    T[K]
  >;
} & {
  [K in keyof T as T[K]['isOptional'] extends true ? K : never]?: InferSchema<
    T[K]
  >;
};

export interface JsonObjectSchema extends JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaObject>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaObject;
}

export interface ObjectOptions {
  description?: string;
  additionalProperties?: boolean;
  optional?: boolean;
}

export class ObjectSchemaNode<T extends PropertyShape> extends BaseSchemaNode<
  InferObject<T>
> {
  constructor(
    public readonly shape: T,
    private options: ObjectOptions = {},
  ) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
  }

  toJsonSchema(): JsonObjectSchema {
    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];

    for (const [key, prop] of Object.entries(this.shape)) {
      properties[key] = prop.toJsonSchema();
      if (!prop.isOptional) {
        required.push(key);
      }
    }

    const schema: JsonObjectSchema = {
      type: 'object',
      properties,
      additionalProperties: this.options.additionalProperties ?? false,
    };

    if (required.length > 0) {
      schema.required = required;
    }
    if (this.description) {
      schema.description = this.description;
    }
    return schema;
  }

  parse(value: unknown, path = ''): InferObject<T> {
    if (value === undefined || value === null) {
      if (this.isOptional) return undefined as unknown as InferObject<T>;
      throw new SchemaValidationError(
        'Expected object, received undefined or null',
        path,
        value,
      );
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new SchemaValidationError(
        `Expected object, received ${typeof value}`,
        path,
        value,
      );
    }

    const input = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, prop] of Object.entries(this.shape)) {
      const childPath = path ? `${path}.${key}` : key;
      const rawVal = input[key];

      if (rawVal === undefined) {
        if (prop.defaultValue !== undefined) {
          result[key] = prop.defaultValue;
        } else if (prop.isOptional) {
          // optional property not present
        } else {
          throw new SchemaValidationError(
            'Missing required property',
            childPath,
          );
        }
      } else {
        result[key] = prop.parse(rawVal, childPath);
      }
    }

    if (this.options.additionalProperties) {
      for (const [key, val] of Object.entries(input)) {
        if (!(key in this.shape)) {
          result[key] = val;
        }
      }
    }

    return result as InferObject<T>;
  }
}

export class EnumSchemaNode<
  T extends string | number,
> extends BaseSchemaNode<T> {
  constructor(
    public readonly values: readonly T[],
    options: { description?: string; optional?: boolean } = {},
  ) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? false;
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = {
      enum: [...this.values],
    };
    const first = this.values[0];
    if (typeof first === 'number') schema.type = 'number';
    else schema.type = 'string';
    if (this.description) schema.description = this.description;
    return schema;
  }

  parse(value: unknown, path = ''): T {
    if (value === undefined || value === null) {
      if (this.isOptional) return undefined as unknown as T;
      throw new SchemaValidationError(
        'Expected enum value, received undefined or null',
        path,
        value,
      );
    }
    if (!this.values.includes(value as T)) {
      throw new SchemaValidationError(
        `Invalid enum value. Expected one of: ${this.values.join(', ')}`,
        path,
        value,
      );
    }
    return value as T;
  }
}

export class AnySchemaNode extends BaseSchemaNode<unknown> {
  constructor(options: { description?: string; optional?: boolean } = {}) {
    super();
    this.description = options.description;
    this.isOptional = options.optional ?? true;
  }

  toJsonSchema(): JsonSchemaObject {
    const schema: JsonSchemaObject = {};
    if (this.description) schema.description = this.description;
    return schema;
  }

  parse(value: unknown): unknown {
    return value;
  }
}

/**
 * Fluent Schema Builder Factory
 */
export const s = {
  string: (options?: StringOptions) => new StringSchemaNode(options),
  number: (options?: NumberOptions) => new NumberSchemaNode(options),
  boolean: (options?: BooleanOptions) => new BooleanSchemaNode(options),
  array: <T>(item: SchemaNode<T>, options?: ArrayOptions) =>
    new ArraySchemaNode(item, options),
  object: <T extends PropertyShape>(shape: T, options?: ObjectOptions) =>
    new ObjectSchemaNode(shape, options),
  enum: <T extends string | number>(
    values: readonly T[],
    options?: { description?: string },
  ) => new EnumSchemaNode(values, options),
  any: (options?: { description?: string }) => new AnySchemaNode(options),

  /**
   * Helper to format schema into a standard OpenAI / Unified API ToolDefinition
   */
  toToolDefinition<T extends PropertyShape>(
    name: string,
    description: string,
    parameters: ObjectSchemaNode<T>,
  ): ToolDefinition {
    return {
      type: 'function',
      function: {
        name,
        description,
        parameters: parameters.toJsonSchema(),
      },
    };
  },

  /**
   * Helper to format schema into an MCP Tool specification
   */
  toMcpTool<T extends PropertyShape>(
    name: string,
    description: string,
    parameters: ObjectSchemaNode<T>,
  ) {
    return {
      name,
      description,
      inputSchema: parameters.toJsonSchema(),
    };
  },
};

// ---------------------------------------------------------------------------
// Standard Schema & Universal Schema Resolver Specification
// ---------------------------------------------------------------------------

/**
 * Standard Schema v1 specification interface.
 * Implemented natively by Zod (v3.24+), Valibot, ArkType, and Standard Schema compliant validators.
 * @see https://standardschema.dev/
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export type StandardResult<Output> =
  | StandardSuccessResult<Output>
  | StandardFailureResult;

export interface StandardSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardFailureResult {
  readonly issues: ReadonlyArray<StandardIssue>;
}

export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/**
 * Type guard for Standard Schema v1 compliant objects.
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof (value as StandardSchemaV1)['~standard'] === 'object' &&
    (value as StandardSchemaV1)['~standard'] !== null &&
    typeof (value as StandardSchemaV1)['~standard'].validate === 'function'
  );
}

/**
 * Type guard for SinapsAI fluent SchemaNode objects.
 */
export function isSinapsSchema(value: unknown): value is SchemaNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SchemaNode).toJsonSchema === 'function' &&
    typeof (value as SchemaNode).parse === 'function'
  );
}

/**
 * Type guard for Zod-like schemas without requiring zod as a dependency.
 */
export function isZodSchema(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  // biome-ignore lint/suspicious/noExplicitAny: duck-typing Zod
  const anyVal = value as any;
  return (
    typeof anyVal.safeParse === 'function' &&
    typeof anyVal._def === 'object' &&
    anyVal._def !== null &&
    typeof anyVal._def.typeName === 'string'
  );
}

/**
 * Converts a Zod _def definition into a standard JSON Schema object zero-dependency.
 */
// biome-ignore lint/suspicious/noExplicitAny: duck-typing Zod internal _def
function zodDefToJsonSchema(def: any): JsonSchemaObject {
  if (!def?.typeName) return { type: 'object' };

  switch (def.typeName) {
    case 'ZodString': {
      const schema: JsonSchemaObject = { type: 'string' };
      if (def.description) schema.description = def.description;
      if (Array.isArray(def.checks)) {
        for (const check of def.checks) {
          if (check.kind === 'min') schema.minLength = check.value;
          if (check.kind === 'max') schema.maxLength = check.value;
        }
      }
      return schema;
    }

    case 'ZodNumber': {
      const isInteger =
        Array.isArray(def.checks) &&
        def.checks.some((c: { kind: string }) => c.kind === 'int');
      const schema: JsonSchemaObject = {
        type: isInteger ? 'integer' : 'number',
      };
      if (def.description) schema.description = def.description;
      if (Array.isArray(def.checks)) {
        for (const check of def.checks) {
          if (check.kind === 'min') schema.minimum = check.value;
          if (check.kind === 'max') schema.maximum = check.value;
        }
      }
      return schema;
    }

    case 'ZodBoolean':
      return { type: 'boolean', description: def.description };

    case 'ZodArray': {
      const inner = def.type?._def
        ? zodDefToJsonSchema(def.type._def)
        : { type: 'string' };
      const schema: JsonSchemaObject = {
        type: 'array',
        items: inner,
      };
      if (def.description) schema.description = def.description;
      if (def.exactLength?.value !== undefined) {
        schema.minItems = def.exactLength.value;
        schema.maxItems = def.exactLength.value;
      }
      if (def.minLength?.value !== undefined)
        schema.minItems = def.minLength.value;
      if (def.maxLength?.value !== undefined)
        schema.maxItems = def.maxLength.value;
      return schema;
    }

    case 'ZodObject': {
      const properties: Record<string, JsonSchemaObject> = {};
      const required: string[] = [];
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;

      if (shape && typeof shape === 'object') {
        for (const [key, prop] of Object.entries(shape)) {
          // biome-ignore lint/suspicious/noExplicitAny: property inspection
          const propDef = (prop as any)?._def;
          if (propDef) {
            properties[key] = zodDefToJsonSchema(propDef);
            const isOptional =
              propDef.typeName === 'ZodOptional' ||
              propDef.typeName === 'ZodDefault';
            if (!isOptional) {
              required.push(key);
            }
          }
        }
      }

      const schema: JsonSchemaObject = {
        type: 'object',
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) schema.required = required;
      if (def.description) schema.description = def.description;
      return schema;
    }

    case 'ZodEnum': {
      const values = Array.isArray(def.values) ? [...def.values] : [];
      return {
        type: 'string',
        enum: values,
        description: def.description,
      };
    }

    case 'ZodOptional': {
      const inner = def.innerType?._def
        ? zodDefToJsonSchema(def.innerType._def)
        : {};
      return inner;
    }

    case 'ZodNullable': {
      const inner = def.innerType?._def
        ? zodDefToJsonSchema(def.innerType._def)
        : {};
      return inner;
    }

    case 'ZodDefault': {
      const inner = def.innerType?._def
        ? zodDefToJsonSchema(def.innerType._def)
        : {};
      inner.default =
        typeof def.defaultValue === 'function'
          ? def.defaultValue()
          : def.defaultValue;
      return inner;
    }

    case 'ZodLiteral': {
      return {
        type: typeof def.value,
        enum: [def.value],
        description: def.description,
      };
    }

    case 'ZodUnion': {
      const options = Array.isArray(def.options)
        ? // biome-ignore lint/suspicious/noExplicitAny: union options
          def.options.map((opt: any) =>
            opt?._def ? zodDefToJsonSchema(opt._def) : {},
          )
        : [];
      return {
        anyOf: options,
        description: def.description,
      };
    }

    default:
      return { type: 'object', description: def.description };
  }
}

/**
 * Universal JSON Schema converter.
 * Converts SinapsAI SchemaNode, Standard Schema v1, Zod schema, or raw JSON Schema objects
 * into a valid OpenAPI / JSON Schema definition without requiring any external dependencies.
 */
export function toStandardJsonSchema(
  schema: unknown,
  options?: { name?: string; description?: string },
): JsonSchemaObject {
  if (schema == null) {
    return { type: 'object' };
  }

  // 1. SinapsAI SchemaNode
  if (isSinapsSchema(schema)) {
    return schema.toJsonSchema();
  }

  // 2. Objects with native toJsonSchema method
  // biome-ignore lint/suspicious/noExplicitAny: duck-typing
  if (typeof (schema as any).toJsonSchema === 'function') {
    // biome-ignore lint/suspicious/noExplicitAny: duck-typing
    return (schema as any).toJsonSchema();
  }

  // 3. Zod Schema
  if (isZodSchema(schema)) {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal _def
    const def = (schema as any)._def;
    const res = zodDefToJsonSchema(def);
    if (options?.description && !res.description) {
      res.description = options.description;
    }
    return res;
  }

  // 4. Standard Schema v1 (if it exports jsonSchema or has vendor metadata)
  // biome-ignore lint/suspicious/noExplicitAny: standard schema inspection
  const anySchema = schema as any;
  if (isStandardSchema(schema)) {
    if (
      typeof anySchema.jsonSchema === 'object' &&
      anySchema.jsonSchema !== null
    ) {
      return anySchema.jsonSchema;
    }
    if (anySchema._def) {
      return zodDefToJsonSchema(anySchema._def);
    }
  }

  // 5. Raw JSON Schema object
  if (
    typeof schema === 'object' &&
    schema !== null &&
    ('type' in schema || 'properties' in schema || 'enum' in schema)
  ) {
    const raw = schema as JsonSchemaObject;
    if (options?.description && !raw.description) {
      return { ...raw, description: options.description };
    }
    return raw;
  }

  // 6. Plain property map (e.g. { name: s.string(), age: s.number() })
  if (typeof schema === 'object' && schema !== null) {
    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(schema)) {
      if (isSinapsSchema(val)) {
        properties[key] = val.toJsonSchema();
        if (!val.isOptional) required.push(key);
      } else {
        properties[key] = toStandardJsonSchema(val);
        required.push(key);
      }
    }

    const res: JsonSchemaObject = {
      type: 'object',
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) res.required = required;
    if (options?.description) res.description = options.description;
    return res;
  }

  return { type: 'object' };
}

export interface ValidationSuccessResult<T> {
  success: true;
  data: T;
  errors?: undefined;
}

export interface ValidationFailureResult {
  success: false;
  data?: undefined;
  errors: string[];
}

export type ValidationResult<T> =
  | ValidationSuccessResult<T>
  | ValidationFailureResult;

/**
 * Universally validates data against any schema (Standard Schema v1, SinapsAI SchemaNode, or Zod).
 */
export async function validateSchema<T = unknown>(
  schema: unknown,
  value: unknown,
): Promise<ValidationResult<T>> {
  if (schema == null) {
    return { success: true, data: value as T };
  }

  // 1. Standard Schema v1
  if (isStandardSchema(schema)) {
    const res = await schema['~standard'].validate(value);
    if ('issues' in res && res.issues && res.issues.length > 0) {
      return {
        success: false,
        errors: res.issues.map((i) => i.message),
      };
    }
    if ('value' in res) {
      return { success: true, data: res.value as T };
    }
    return { success: true, data: value as T };
  }

  // 2. SinapsAI or Zod safeParse
  // biome-ignore lint/suspicious/noExplicitAny: duck-typing safeParse
  const anySchema = schema as any;
  if (typeof anySchema.safeParse === 'function') {
    const res = anySchema.safeParse(value);
    if (res.success) {
      return { success: true, data: res.data as T };
    }
    const errMsg =
      res.error instanceof Error
        ? res.error.message
        : res.error
          ? String(res.error)
          : 'Validation failed';
    return { success: false, errors: [errMsg] };
  }

  // 3. parse method
  if (typeof anySchema.parse === 'function') {
    try {
      const data = anySchema.parse(value);
      return { success: true, data: data as T };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, errors: [errMsg] };
    }
  }

  // Fallback: raw json schema or object
  return { success: true, data: value as T };
}

/**
 * Helper to build an OpenAI / Unified API `ResponseFormat` from any schema
 * (Standard Schema v1, Zod, SinapsAI SchemaNode, or JSON Schema).
 *
 * @example
 * ```typescript
 * const format = jsonSchema('user_profile', UserSchema, {
 *   description: 'Extract user profile data',
 *   strict: true,
 * });
 * ```
 */
export function jsonSchema(
  name: string,
  schema: unknown,
  options?: { description?: string; strict?: boolean },
): ResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      description: options?.description,
      schema: toStandardJsonSchema(schema, options),
      strict: options?.strict ?? true,
    },
  };
}

/**
 * Helper to define an OpenAI / Unified API `ToolDefinition` from any schema.
 *
 * @example
 * ```typescript
 * const weatherTool = tool('getWeather', 'Fetch weather for location', WeatherSchema);
 * ```
 */
export function tool(
  name: string,
  description: string,
  parameters: unknown,
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: toStandardJsonSchema(parameters, { description }),
    },
  };
}
