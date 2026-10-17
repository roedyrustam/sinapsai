/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 24: xAI (Grok) & Cohere v2 Providers Integration
 *
 * Demonstrates:
 * 1. Configuring xAI Grok provider with reasoning effort and model aliases.
 * 2. Configuring Cohere v2 Command A and Embed v4 models.
 * 3. Unified chat completions, structured JSON output, and embeddings.
 *
 * Run with: npx -y tsx examples/24-xai-and-cohere-providers.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  COHERE_MODELS,
  CohereProvider,
  SinapsClient,
  XAI_MODELS,
  XAiProvider,
} from '../src/index.js';

async function main() {
  console.log('=== SinapsAI: xAI Grok & Cohere v2 Integration ===\n');

  // --- PART A: Provider Initialization ---
  console.log('--- PART A: Provider Setup ---');

  const xai = new XAiProvider({
    id: 'xai-grok',
    apiKey: process.env.XAI_API_KEY || 'mock-xai-key',
    defaultModel: XAI_MODELS.GROK_3,
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
  });

  const cohere = new CohereProvider({
    id: 'cohere-v2',
    apiKey: process.env.COHERE_API_KEY || 'mock-cohere-key',
    defaultModel: COHERE_MODELS.COMMAND_A,
    promptCostPer1k: 0.0025,
    completionCostPer1k: 0.01,
  });

  console.log(`xAI configured with default model: ${xai.defaultModel}`);
  console.log(`Cohere configured with default model: ${cohere.defaultModel}`);

  // --- PART B: Format Request Inspection ---
  console.log('\n--- PART B: Request Translation Verification ---');

  // 1. xAI with reasoning effort & JSON schema
  const xaiReq = xai.formatRequest({
    model: 'grok-3',
    messages: [{ role: 'user', content: 'Design a distributed rate limiter in Go.' }],
    reasoningEffort: 'high',
    responseFormat: { type: 'json_object' },
  });
  console.log('xAI Formatted Payload:', {
    model: xaiReq.model,
    reasoning_effort: xaiReq.reasoning_effort,
    response_format: xaiReq.response_format,
  });

  // 2. Cohere v2 with tools & strict schema
  const cohereReq = cohere.formatRequest({
    model: 'command-a',
    messages: [{ role: 'user', content: 'What is the current stock price of TSLA?' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_stock_quote',
          description: 'Fetch real-time stock quote',
          parameters: {
            type: 'object',
            properties: { symbol: { type: 'string' } },
            required: ['symbol'],
          },
        },
      },
    ],
    toolChoice: 'required',
  });
  console.log('\nCohere v2 Formatted Payload:', {
    model: cohereReq.model,
    tool_choice: cohereReq.tool_choice,
    tools_count: cohereReq.tools?.length,
  });

  // --- PART C: SinapsClient Gateway Integration ---
  console.log('\n--- PART C: Multi-Provider Gateway with Model Aliases ---');

  const client = new SinapsClient({
    providers: [xai, cohere],
    strategy: 'failover',
    modelAliases: {
      grok: 'grok-3',
      cohere: 'command-a',
    },
  });

  console.log('Client initialized with model aliases:', client.getModelAliases());
  console.log('Ready for unified completions across xAI and Cohere.');

  console.log('\n=== Example 24 Completed Successfully ===');
}

main().catch(console.error);
