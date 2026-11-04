/**
 * Example 36: Zero-Dependency Schema Builder & Type-Safe Tools
 *
 * Demonstrates:
 * 1. Building Zod-like fluent schemas using s.object, s.string, s.number, s.enum.
 * 2. Compiling schemas to standard OpenAI and MCP JSON Schema representations.
 * 3. Runtime validation and argument parsing with error handling.
 */

import { s } from '../src/index.js';

// 1. Declare Schema
const orderParams = s.object(
  {
    orderId: s.string({ min: 3, description: 'Unique order identifier' }),
    items: s.array(s.string(), { minItems: 1, description: 'List of product SKUs' }),
    shippingMethod: s
      .enum(['standard', 'express', 'next-day'] as const)
      .default('standard'),
    insured: s.boolean({ default: false }),
  },
  { description: 'Shipping order parameters' },
);

console.log('--- Compiled JSON Schema ---');
console.log(JSON.stringify(orderParams.toJsonSchema(), null, 2));

// 2. Validate input
const rawInput = {
  orderId: 'ORD-9876',
  items: ['ITEM-1', 'ITEM-2'],
  shippingMethod: 'express',
  insured: 'true', // auto-coerced to boolean true
};

const parsed = orderParams.parse(rawInput);
console.log('\n--- Validated & Coerced Output ---');
console.log(parsed);

// 3. Export to Tool Definition
const toolDef = s.toToolDefinition('processShippingOrder', 'Process a new customer shipping order', orderParams);
console.log('\n--- OpenAI / Unified API Tool Definition ---');
console.log(JSON.stringify(toolDef, null, 2));

