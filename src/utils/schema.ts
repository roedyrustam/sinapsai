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

import type { ToolDefinition } from '../types/index.js';

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
