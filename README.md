# ⚡ SinapsAI

<p align="center">
  <b>English</b> •
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sinapsai"><img src="https://img.shields.io/npm/v/sinapsai.svg" alt="npm version" /></a>
  <a href="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml"><img src="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" alt="TypeScript Ready" /></a>
  <img src="https://img.shields.io/badge/Tests-169%20Passed-brightgreen.svg" alt="Tests Passed" />
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%3E%3D18.0.0-green.svg" alt="Node >= 18.0.0" /></a>
</p>

**SinapsAI** is a high-performance **Local AI Control Plane & Unified Gateway** built for Node.js and TypeScript. It bridges your applications with multiple LLM providers (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Mistral AI, Ollama, Groq, OpenRouter, and custom endpoints) through a single, standardized **Unified API**.

Engineered with a **100% in-process / in-memory** architecture, SinapsAI eliminates downtime via automatic failover, load balancing, lowest-latency routing, and a resilient **Circuit Breaker**—without requiring intermediary proxy servers, external Redis dependencies, or adding measurable latency (<10ms overhead).

---

## 🥊 Why SinapsAI?

Most AI gateways (LiteLLM, Portkey, Helicone) require deploying separate Docker containers, managing external Redis/PostgreSQL instances, or routing sensitive user prompts and API keys through external third-party cloud servers. 

**SinapsAI runs directly inside your Node.js application process:**

| Feature | **SinapsAI** ⚡ | Direct Provider SDKs | Cloud Gateways (Portkey/Helicone) | LiteLLM Proxy |
| :--- | :---: | :---: | :---: | :---: |
| **Zero Infra Setup** (No Docker/Redis) | ✅ **100% In-Process** | ✅ Yes | ❌ Requires Cloud Account | ❌ Requires Docker/Python |
| **Added Latency** | ⚡ **<10ms** | 0ms | ⚠️ +50ms to +250ms (Extra hop) | ⚠️ +20ms to +80ms |
| **Data Privacy** | 🔒 **Zero Data Leakage** | 🔒 Direct | ⚠️ Third-Party Gateway | 🔒 Self-hosted |
| **In-Memory Circuit Breaker** | ✅ **Built-in** | ❌ Manual code | ⚠️ Cloud feature | ⚠️ Basic retries |
| **Automatic Multi-Provider Failover** | ✅ **Built-in** | ❌ None | ✅ Yes | ✅ Yes |
| **Lowest-Latency Auto-Routing** | ✅ **Built-in** | ❌ None | ⚠️ Cloud feature | ⚠️ Custom setup |
| **Lowest-Cost Auto-Routing** | ✅ **Built-in** | ❌ None | ⚠️ Paid tier | ✅ Yes |
| **Universal Frontier Reasoning** | ✅ **o1/o3/Claude 3.7/Gemini/Groq** | ⚠️ Fragmented | ⚠️ Inconsistent | ⚠️ Partial |
| **KV-Cache / Prompt Cache Tracking**| ✅ **Built-in (`cachedPromptTokens`)** | ⚠️ Varies | ⚠️ Paid | ⚠️ Partial |
| **TypeScript Native (Zero Runtime Deps)**| ✅ **Native `fetch`** | ⚠️ Varies | ❌ Separate Service | ❌ Python |

> 📁 Looking for ready-to-run code? Check the **[Examples Directory (`/examples`)](./examples)**!

---

## 📑 Table of Contents

- [Why SinapsAI?](#-why-sinapsai)
- [Key Features](#-key-features)
- [Architecture & Request Flow](#-architecture--request-flow)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
  - [1. Client Initialization with Automatic Failover](#1-client-initialization-with-automatic-failover)
  - [2. Real-Time Streaming (SSE)](#2-real-time-streaming-sse)
  - [3. Round-Robin Load Balancing](#3-round-robin-load-balancing)
  - [4. Lowest-Cost Routing (Dual-Token Pricing)](#4-lowest-cost-routing-dual-token-pricing)
  - [5. Observability with Event Hooks & Rate Limiting](#5-observability-with-event-hooks--rate-limiting)
  - [6. Real-Time In-Process Telemetry (getMetrics)](#6-real-time-in-process-telemetry-getmetrics)
  - [7. Retries with Exponential Backoff & Jitter](#7-retries-with-exponential-backoff--jitter)
  - [8. Exact & Semantic In-Process Response Caching](#8-exact--semantic-in-process-response-caching)
  - [9. Tool Calling & Function Execution](#9-tool-calling--function-execution)
  - [10. Structured Outputs (JSON Mode)](#10-structured-outputs-json-mode)
  - [11. Unified Text Embeddings](#11-unified-text-embeddings)
  - [12. OpenRouter Free Tier & Zero-Cost Routing](#12-openrouter-free-tier--zero-cost-routing)
  - [13. Groq LPU Ultra-Fast Inference & Reasoning Integration](#13-groq-lpu-ultra-fast-inference--reasoning-integration)
  - [14. Hierarchical Model-Level Fallbacks](#14-hierarchical-model-level-fallbacks)
  - [15. Universal Multi-Modal Vision & Audio (ContentPart[])](#15-universal-multi-modal-vision--audio-contentpart)
  - [16. Concurrent In-Process Batch Processing (client.batch)](#16-concurrent-in-process-batch-processing-clientbatch)
- [Supported Providers](#-supported-providers)
  - [Creating a Custom Provider (e.g. Ollama)](#creating-a-custom-provider-eg-ollama)
- [Configuration Reference](#-configuration-reference)
- [Development & Testing](#-development--testing)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Key Features

- 🌐 **Unified API**: Communicate seamlessly across different LLM providers using standard request/response structures aligned with the OpenAI Chat Completions specification.
- 🧠 **Universal Frontier Reasoning Engine**: Seamless control for deep thinking and Chain-of-Thought across Claude 3.7 Sonnet (`thinkingBudget`), OpenAI o1/o3/o4 (`reasoningEffort: 'low' | 'medium' | 'high'`), Groq LPU, DeepSeek R1, and Gemini Flash Thinking, automatically surfaced in `message.reasoning_content`.
- ⚡ **Lowest-Latency Routing (`lowest-latency`)**: Dynamically measures running moving-average latency and dispatches prompts to the fastest available LLM provider with zero cold-start lag.
- 🎯 **Hierarchical Model-Level Fallbacks**: Intelligently fall back to secondary candidate models (e.g., `gpt-4o` -> `gpt-4o-mini`) on the current provider before escalating to provider failover, complete with fast-failover on 401 Unauthorized.
- 👁️ **Universal Multi-Modal Content (`ContentPart[]`)**: Unified vision and audio payload format (`text`, `image_url`, `input_audio`) natively mapped across OpenAI, Anthropic Claude, and Google Gemini.
- ⚡ **Zero-Dependency Semantic Caching**: Pure in-process cosine similarity response caching using local or provider embeddings with configurable threshold (0.0 to 1.0) and zero native addons.
- 📊 **Streaming TTFT & Mid-Stream Circuit Breaking**: Millisecond-accurate Time-To-First-Token telemetry (`onStreamSuccess`) and circuit breaker failure trapping against mid-stream connection drops while protecting client aborts.
- 💰 **KV-Cache & Prompt Caching Analytics**: Real-time tracking of `cachedPromptTokens` in responses and `totalCachedPromptTokens` in metrics to audit and reduce API bills by 70-90%.
- 🛠️ **Universal Tool Calling & JSON Mode**: Define tools once with standard JSON Schema (`tools`, `toolChoice`). SinapsAI automatically translates function calls to Anthropic's XML/tool syntax, Gemini's function declarations, and OpenAI formats.
- 🛡️ **In-Memory Circuit Breaker**: Detects provider outages instantaneously and trips (*Open Circuit*) to prevent cascading latencies and application thread blockage.
- 🔀 **Flexible Routing Strategies**:
  - `failover`: Automatically falls back to secondary providers when primary models fail or time out.
  - `lowest-latency`: Dynamically sorts and sends requests to the fastest provider based on running average response latency.
  - `load-balance`: Distributes requests in a round-robin rotation across multiple keys or endpoints to avert rate limiting (HTTP 429).
  - `lowest-cost`: Dynamically sorts and invokes the most cost-effective provider using token pricing (`costPer1kTokens` & dual pricing).
- ⚡ **Exponential Backoff & Retries**: Automatically retries transient network errors and rate limits (429, 5xx) with random jitter before failing over.
- 💾 **In-Memory Prompt Hash & Semantic Caching**: Instant response caching with configurable TTL to avoid duplicate calls and slash inference costs.
- 🚀 **Concurrent In-Process Batch Engine (`client.batch`)**: Zero-dependency worker pool for high-throughput batch chat completions and embeddings with concurrency limits and live progress tracking.
- 🌊 **Native SSE Streaming**: Stream completions in real time using native asynchronous generators (`for await...of`).
- 🔒 **Zero Data Leakage & 100% Local**: Runs strictly within your application's memory space. API keys and prompt payloads never leave your infrastructure.
- 🪝 **Rich Event Hooks**: Observe crucial gateway events (`onSuccess`, `onStreamSuccess`, `onFallback`, `onModelFallback`, `onSemanticCacheHit`, `onCircuitOpen`, `onCircuitClose`, `onRateLimit`, `onRetry`) for APM metrics and custom alerting.

---

## 🏛️ Architecture & Request Flow

```
Your Application
       │
       ▼
┌────────────────────────────────────────────────────────┐
│                      SinapsClient                      │
│            chat.completions.create(request)            │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                         Router                         │
│  Strategy: 'failover' | 'load-balance' | 'lowest-cost' │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                     CircuitBreaker                     │
│    Check State: [ CLOSED | OPEN | HALF_OPEN ]          │
└──────────────────────────┬─────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
    [Circuit CLOSED]                [Circuit OPEN]
Execute Request to Provider      Bypass & Try Next Provider
           │                               │
     ┌─────┴─────┐                         │
  Success      Failure                     │
     │           │                         ▼
     ▼           └──────────────► Automatic Fallback
Return Response                   (Triggers onFallback Hook)
```

---

## 📦 Installation

Install the package using your favorite package manager:

```bash
# Using NPM
npm install sinapsai

# Using PNPM
pnpm add sinapsai

# Using Yarn
yarn add sinapsai

# Using Bun
bun add sinapsai
```

---

## 🚀 Quick Start

### 1. Client Initialization with Automatic Failover

If the primary provider (e.g., OpenAI) is experiencing an outage or rate-limiting, SinapsAI automatically routes the request to secondary providers (Anthropic Claude or Google Gemini):

```typescript
import { 
  SinapsClient, 
  OpenAiProvider, 
  AnthropicProvider, 
  GeminiProvider 
} from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }),
  ],
  circuitBreaker: {
    failureThreshold: 3,         // Trip circuit after 3 consecutive failures
    recoverySuccessThreshold: 2, // Restore circuit after 2 successful probe calls
    resetTimeoutMs: 30000,       // Wait 30s before testing recovery (Half-Open)
  },
  hooks: {
    onFallback: (error, fromProvider, toProvider) => {
      console.warn(`[Failover] ${fromProvider.name} failed (${error.message}). Switching to ${toProvider.name}...`);
    },
    onCircuitOpen: (provider) => {
      console.error(`[Circuit Breaker] Circuit tripped OPEN for ${provider.name}.`);
    },
  },
});

async function main() {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful and reliable AI assistant.' },
      { role: 'user', content: 'Explain distributed caching in two concise sentences.' },
    ],
    temperature: 0.7,
  });

  if ('choices' in response) {
    console.log('Response:', response.choices[0]?.message.content);
    console.log('Token Usage:', response.usage);
  }
}

main().catch(console.error);
```

---

### 2. Real-Time Streaming (SSE)

SinapsAI natively handles streaming through async iterators:

```typescript
import { SinapsClient, OpenAiProvider } from 'sinapsai';

const client = new SinapsClient({
  providers: [new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! })],
});

async function streamDemo() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Write a short haiku about clean code.' }],
    stream: true,
  });

  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta.content || '';
      process.stdout.write(text);
    }
    console.log('\n--- Stream Complete ---');
  }
}

streamDemo();
```

---

### 3. Round-Robin Load Balancing

Balance traffic across multiple API keys or accounts to prevent hitting individual rate limits:

```typescript
import { SinapsClient, GroqProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'load-balance',
  providers: [
    new GroqProvider({ id: 'groq-key-1', apiKey: process.env.GROQ_KEY_1! }),
    new GroqProvider({ id: 'groq-key-2', apiKey: process.env.GROQ_KEY_2! }),
    new GroqProvider({ id: 'groq-key-3', apiKey: process.env.GROQ_KEY_3! }),
  ],
});
```

---

### 4. Lowest-Cost Routing

Automatically execute through the most cost-efficient provider using dynamic dual-token pricing (`promptCostPer1k` and `completionCostPer1k`):

```typescript
import { SinapsClient, OpenAiProvider, DeepSeekProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'lowest-cost',
  providers: [
    new OpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      promptCostPer1k: 0.0025,    // $2.50 per 1M prompt tokens
      completionCostPer1k: 0.010, // $10.00 per 1M completion tokens
    }),
    new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      promptCostPer1k: 0.00027,   // $0.27 per 1M prompt tokens
      completionCostPer1k: 0.0011,// $1.10 per 1M completion tokens
    }),
  ],
});
```

---

### 5. Observability with Event Hooks & Rate Limiting

Integrate lifecycle events with your telemetry and monitoring pipelines (Datadog, OpenTelemetry, Prometheus) and catch proactive rate limit warnings:

```typescript
const client = new SinapsClient({
  providers: [...],
  hooks: {
    onSuccess: (provider, response, latencyMs) => {
      telemetry.recordSuccess(provider.name, latencyMs, response.usage?.totalTokens);
    },
    onStreamSuccess: (provider, ttftMs, totalLatencyMs) => {
      telemetry.recordStreamLatency(provider.name, ttftMs, totalLatencyMs);
    },
    onModelFallback: (error, provider, fromModel, toModel) => {
      console.warn(`[Model Fallback] ${provider.name} failed on ${fromModel}: ${error.message}. Switching to candidate model ${toModel}...`);
    },
    onSemanticCacheHit: (request, cachedResponse, similarity) => {
      console.log(`[Semantic Cache Hit] ${(similarity * 100).toFixed(1)}% match for model ${cachedResponse.model}`);
    },
    onRateLimitWarning: (provider, rateLimit) => {
      console.warn(`[Warning] Provider ${provider.name} capacity low! Remaining: ${rateLimit.remainingRequests}`);
    },
    onFallback: (error, fromProvider, toProvider) => {
      telemetry.recordFallback(fromProvider.name, toProvider.name, error.message);
    },
    onCircuitOpen: (provider) => {
      alertSystem.notify(`Circuit breaker tripped for provider: ${provider.name}`);
    },
    onCircuitClose: (provider) => {
      alertSystem.notify(`Provider ${provider.name} has recovered to healthy state.`);
    },
    onRateLimit: (provider, error) => {
      telemetry.recordRateLimit(provider.name);
    },
    onRetry: (provider, error, attempt, delayMs) => {
      console.warn(`[Retry] Retrying ${provider.name} (attempt ${attempt}) after ${Math.round(delayMs)}ms...`);
    },
  },
});
```

---

### 6. Real-Time In-Process Telemetry (`getMetrics`)

Query cumulative runtime metrics anytime without external database dependencies:

```typescript
const metrics = client.getMetrics();

console.log(`Total Requests: ${metrics.totalRequests}`);
console.log(`Successes: ${metrics.successfulRequests}`);
console.log(`Cached: ${metrics.cachedRequests}`);
console.log(`Total Tokens: ${metrics.totalTokens}`);
console.log(`Estimated Spend: $${metrics.estimatedCostUsd.toFixed(6)} USD`);
console.table(metrics.providerMetrics);
```

---

### 7. Retries with Exponential Backoff & Jitter

Configure per-provider or global retry attempts for transient server glitches (5xx, timeouts, 429) before falling over:

```typescript
const client = new SinapsClient({
  retries: 2,            // Retry transient errors up to 2 times
  retryDelayMs: 250,     // Initial backoff delay (doubles each attempt + random jitter)
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  ],
});
```

---

### 8. Exact & Semantic In-Process Response Caching

Instantly serve repeated prompt queries with 0ms network overhead and zero token consumption. SinapsAI supports both exact match hash caching and **zero-dependency semantic caching** using cosine similarity:

```typescript
const client = new SinapsClient({
  cache: {
    enabled: true,       // Cache responses
    ttlSeconds: 300,     // Cache lifespan (default 5 minutes)
    semantic: {
      enabled: true,
      similarityThreshold: 0.90, // Cosine similarity threshold (0.0 to 1.0)
      embeddingModel: 'text-embedding-3-small', // Or uses available provider
      // Optional: customEmbed: async (text) => [0.1, 0.2, ...]
    },
  },
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
  hooks: {
    onSemanticCacheHit: (req, cachedRes, similarity) => {
      console.log(`[Semantic Hit] ${(similarity * 100).toFixed(1)}% match for: ${cachedRes.model}`);
    },
  },
});
```


---

### 9. Tool Calling & Function Execution

Define functions once using OpenAI's standard JSON schema. SinapsAI automatically maps and parses them across OpenAI, Anthropic Claude, and Google Gemini:

```typescript
import { SinapsClient, OpenAiProvider, AnthropicProvider, GeminiProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }),
  ],
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the stock price of Apple (AAPL)?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_stock_price',
        description: 'Get the current stock price for a given ticker symbol',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker, e.g. AAPL' },
          },
          required: ['symbol'],
        },
      },
    },
  ],
  toolChoice: 'auto',
});

if (response.choices[0].finishReason === 'tool_calls') {
  const toolCall = response.choices[0].message.tool_calls?.[0];
  console.log('Tool to call:', toolCall?.function.name);
  console.log('Arguments:', toolCall?.function.arguments);
}
```

---

### 10. Structured Outputs (JSON Mode)

Enforce valid JSON object responses natively across all providers (`responseFormat: { type: 'json_object' }`):

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a data extractor. Always return JSON.' },
    { role: 'user', content: 'Generate a profile for John Doe, age 28, engineer.' },
  ],
  responseFormat: { type: 'json_object' },
});

const data = JSON.parse(response.choices[0].message.content || '{}');
console.log(data);
```

---

### 11. Unified Text Embeddings

Generate vector embeddings with automatic multi-provider failover, circuit breaker protection, and in-memory caching to eliminate redundant costs:

```typescript
const embeddings = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Control plane for AI engineering',
});

console.log(embeddings.data[0].embedding); // Array of vector floats
console.log(embeddings.usage?.totalTokens); // Token count
```

---

### 12. OpenRouter Free Tier & Zero-Cost Routing

Leverage [OpenRouter's Free Models catalog](https://openrouter.ai/models?variant=free) without paying for inference tokens. SinapsAI provides pre-configured zero-cost accounting, `openrouter/free` meta-routing, attribution headers, dynamic model discovery, and native fallback model chains:

```typescript
import { 
  SinapsClient, 
  OpenRouterProvider, 
  createOpenRouterFreeProvider,
  OpenAiProvider 
} from 'sinapsai';

// 1. Inspect live free models dynamically from OpenRouter API
const freeModels = await OpenRouterProvider.fetchFreeModels();
console.log(`Live Free Models: ${freeModels.length}`);

// 2. Instantiate pre-configured Free Provider ($0 cost per 1k tokens)
const openRouterFree = createOpenRouterFreeProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  siteUrl: 'https://myapp.com', // Sent as HTTP-Referer for OpenRouter leaderboard ranking
  siteName: 'My App',           // Sent as X-Title
  model: 'openrouter/free',      // Meta-router selecting active free models
  fallbackModels: [
    'openrouter/free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3.5-lightning:free',
  ],
});

// 3. Combine with paid backup provider under 'lowest-cost' strategy
const client = new SinapsClient({
  strategy: 'lowest-cost', // Prioritizes $0 free models first, fails over to paid if rate-limited!
  providers: [
    openRouterFree,
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
});

const response = await client.chat.completions.create({
  model: 'openrouter/free',
  messages: [{ role: 'user', content: 'What makes open weights AI impactful?' }],
  fallbackModels: ['google/gemma-4-31b-it:free'],
});

console.log(response.choices[0].message.content);
```

---

### 13. Groq LPU Ultra-Fast Inference & Reasoning Integration

Harness the raw inference speed of [GroqCloud LPUs](https://console.groq.com/docs/overview) (~500+ tokens/sec) with built-in reasoning support, JSON schema structured outputs, and automatic duration rate-limit header tracking:

- **Ultra-Fast Production Models**: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`.
- **Reasoning Tokens Extraction**: Automatically sets `reasoning_format: 'parsed'` and surfaces the thought chain in `choice.message.reasoning_content` (and streaming `delta.reasoning_content`). Supports raw `<think>...</think>` fallback parsing.
- **Groq Duration Rate Limit Parsing**: Handles Groq's distinctive duration headers (`x-ratelimit-reset-tokens: 7.66s`, `x-ratelimit-reset-requests: 2m59.56s`) to give exact millisecond precision for proactive throttling and `onRateLimitWarning` hooks.
- **Strict Compatibility**: Automatically strips unsupported fields (`messages[].name`) that cause Groq 400 errors and safely clamps `temperature: 0` to `1e-8` per Groq documentation.

```typescript
import { SinapsClient, GroqProvider, OpenAiProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'failover',
  providers: [
    new GroqProvider({
      apiKey: process.env.GROQ_API_KEY!,
      defaultModel: 'llama-3.3-70b-versatile',
      modelMap: {
        'fast-llm': 'llama-3.1-8b-instant',
        'reasoner': 'openai/gpt-oss-20b',
      },
    }),
    new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
});

// 1. Complex reasoning with explicit thought chain extraction
const reasoningResponse = await client.chat.completions.create({
  model: 'reasoner',
  messages: [{ role: 'user', content: 'Which is larger: 9.11 or 9.9?' }],
  thinkingBudget: 1024,
});

console.log('Reasoning:', reasoningResponse.choices[0].message.reasoning_content);
console.log('Answer:', reasoningResponse.choices[0].message.content);

// 2. Structured Outputs with JSON Schema
const schemaResponse = await client.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Extract name and role for Alice, Tech Lead' }],
  responseFormat: {
    type: 'json_schema',
    json_schema: {
      name: 'user_profile',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['name', 'role'],
      },
    },
  },
});
```

---

### 14. Hierarchical Model-Level Fallbacks

Configure candidate fallback models on the client, per-provider, or per-request. If a model encounters a rate limit or 5xx error, SinapsAI tries the secondary candidate models on the current provider before escalating to failover across providers:

```typescript
const client = new SinapsClient({
  providers: [
    new OpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      defaultModel: 'gpt-4o',
      fallbackModels: ['gpt-4o-mini'], // Provider-level fallback
    }),
    new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      defaultModel: 'claude-3-7-sonnet-20250219',
      fallbackModels: ['claude-3-5-haiku-20241022'],
    }),
  ],
  hooks: {
    onModelFallback: (error, provider, fromModel, toModel) => {
      console.warn(`[Model Fallback] ${provider.name} failed on ${fromModel}: ${error.message}. Switching to ${toModel}...`);
    },
    onFallback: (error, fromProvider, toProvider) => {
      console.warn(`[Provider Failover] All models exhausted on ${fromProvider.name}. Switching to ${toProvider.name}...`);
    },
  },
});

// You can also override candidate models per request:
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  fallbackModels: ['gpt-4o-mini'],
  messages: [{ role: 'user', content: 'Generate a short summary.' }],
});
```

---

### 15. Universal Multi-Modal Vision & Audio (`ContentPart[]`)

Send text, base64 images, remote URLs, and audio payloads using a single OpenAI-compatible structure. SinapsAI automatically formats them for OpenAI, Anthropic Claude, and Google Gemini:

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe what is in this image and transcribe the audio note.' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/chart.png', detail: 'high' },
        },
        {
          type: 'input_audio',
          input_audio: { data: '<base64-audio>', format: 'wav' },
        },
      ],
    },
  ],
});
```

---

### 16. Concurrent In-Process Batch Processing (`client.batch`)

Execute bulk chat completions or text embeddings concurrently with zero external dependencies (`p-limit` not needed). Includes concurrency limits, real-time progress callbacks, and fail-soft settled execution:

```typescript
const batchResult = await client.batch.chat(
  [
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Classify sentiment: Great product!' }] },
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Classify sentiment: Terrible service.' }] },
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Classify sentiment: Arrived on time.' }] },
  ],
  {
    concurrency: 2,       // Maximum 2 in-flight requests simultaneously
    stopOnError: false,   // Continue remaining requests on individual errors
    onProgress: (p) => {
      console.log(`[Batch Progress] ${p.completed}/${p.total} (${p.percentage}%)`);
    },
  },
);

console.log(`Completed ${batchResult.successful}/${batchResult.total} in ${batchResult.durationMs}ms`);
for (const item of batchResult.results) {
  if (item.status === 'fulfilled') {
    console.log(`[Item #${item.index}] Answer:`, item.value?.choices[0].message.content);
  } else {
    console.error(`[Item #${item.index}] Failed:`, item.error?.message);
  }
}
```

---

## 🧩 Supported Providers

| Provider | Exported Class | Options Supported |
| :--- | :--- | :--- |
| **OpenAI** | `OpenAiProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels` |
| **Anthropic Claude** | `AnthropicProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels` |
| **Google Gemini** | `GeminiProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels`, `safetySettings`, `thinkingBudget`, `outputDimensionality`, `GEMINI_MODELS`, `fetchAvailableModels()` |
| **DeepSeek** | `DeepSeekProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels`, reasoning tokens (`reasoning_content`) |
| **Ollama (Local)** | `OllamaProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` (default: 0), `fallbackModels` |
| **Groq** | `GroqProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels`, reasoning extraction (`reasoning_format: 'parsed'`, `reasoning_content`), duration rate limits (`7.66s`, `2m59.56s`), temperature clamping, message name sanitization |
| **OpenRouter** | `OpenRouterProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `siteUrl`, `siteName`, `fallbackModels`, `isFreeTier`, `createOpenRouterFreeProvider()` |
| **Mistral** | `MistralProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens`, `fallbackModels` |
| **Custom / On-Prem** | `Provider` (Interface) | Custom implementations for vLLM, LocalAI, TGI, etc. |

### Creating a Custom Provider (e.g. Ollama)

```typescript
import type { Provider, UnifiedApiRequest, UnifiedApiResponse } from 'sinapsai';

export class OllamaProvider implements Provider {
  id = 'ollama-local';
  name = 'Ollama Local';

  async generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse> {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'llama3',
        messages: request.messages,
        stream: false,
      }),
    });

    const data = await res.json();
    return {
      id: `ollama-${Date.now()}`,
      model: request.model,
      choices: [
        {
          message: { role: 'assistant', content: data.message.content },
          finishReason: 'stop',
        },
      ],
    };
  }
}
```

---

## ⚙️ Configuration Reference

### `SinapsClientOptions`

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `providers` | `Provider[]` | *(Required)* | List of provider instances to register |
| `strategy` | `'failover' \| 'load-balance' \| 'lowest-cost' \| 'lowest-latency'` | `'failover'` | Routing algorithm for requests |
| `storage` | `StateStorage` | `InMemoryStorage` | State store for circuit breaker tracking |
| `circuitBreaker` | `CircuitBreakerOptions` | `{}` | Fault tolerance parameters |
| `cache` | `CacheOptions` | `{}` | In-process exact & semantic response caching configuration |
| `retries` | `number` | `0` | Number of retries with exponential backoff before failover |
| `retryDelayMs` | `number` | `200` | Initial backoff delay for retries |
| `fallbackModels` | `string[]` | `undefined` | Global candidate model fallback list |
| `hooks` | `SinapsEventHooks` | `{}` | Lifecycle event listeners for observability |

### `CircuitBreakerOptions`

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `failureThreshold` | `number` | `5` | Consecutive failures required to open the circuit |
| `recoverySuccessThreshold` | `number` | `2` | Consecutive successes in Half-Open to restore normal state |
| `resetTimeoutMs` | `number` | `30000` (30s) | Duration circuit stays OPEN before entering HALF_OPEN |

---

## 🧪 Development & Testing

This project leverages **TypeScript**, **Biome**, and **Vitest**:

```bash
# Run unit and integration tests
npm test

# Run linter & code format check
npm run lint

# Build production artifacts (ESM, CommonJS, and .d.ts typings)
npm run build
```

---

## 🤝 Contributing

We welcome contributions of all kinds — new providers, bug fixes, tests, and documentation improvements!

Please read the **[Contributing Guide](./CONTRIBUTING.md)** for:
- Development environment setup
- Step-by-step guide for adding a new LLM provider
- Test writing standards with Vitest mocks
- Code style rules (Biome)
- Commit message convention (Conventional Commits)
- How to open a well-structured Pull Request

---

## 📄 License

This project is licensed under the **[MIT License](./LICENSE)**.

You are free to:
- **Use** — commercially, educationally, and privately without restrictions.
- **Modify** — alter, adapt, and build upon the source code.
- **Distribute** — copy and redistribute the code in any medium or format.
- **Sublicense** — grant others rights to use the software.

Under the condition that the copyright notice and permission notice are included in all copies or substantial portions of the Software.

---

Crafted with dedication by **Roedy Rustam** & the SinapsAI Contributors.
