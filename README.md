# ⚡ SinapsAI

<p align="center">
  <b>English</b> •
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center">
  <a href="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml"><img src="https://github.com/roedyrustam/sinapsai/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome" /></a>
  <a href="https://creativecommons.org/licenses/by/4.0/"><img src="https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg" alt="License: CC BY 4.0" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" alt="TypeScript Ready" /></a>
  <img src="https://img.shields.io/badge/Tests-49%20Passed-brightgreen.svg" alt="Tests Passed" />
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%3E%3D18.0.0-green.svg" alt="Node >= 18.0.0" /></a>
</p>

**SinapsAI** is a high-performance **Local AI Control Plane & Unified Gateway** built for Node.js and TypeScript. It bridges your applications with multiple LLM providers (OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, and custom endpoints) through a single, standardized **Unified API**.

Engineered with a **100% in-process / in-memory** architecture, SinapsAI eliminates downtime via automatic failover, load balancing, and a resilient **Circuit Breaker**—without requiring intermediary proxy servers, external Redis dependencies, or adding measurable latency (<10ms overhead).

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
| **Round-Robin Load Balancing** | ✅ **Built-in** | ❌ None | ✅ Yes | ✅ Yes |
| **Lowest-Cost Auto-Routing** | ✅ **Built-in** | ❌ None | ⚠️ Paid tier | ✅ Yes |
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
  - [4. Lowest-Cost Routing](#4-lowest-cost-routing)
  - [5. Observability with Event Hooks](#5-observability-with-event-hooks)
- [Supported Providers](#-supported-providers)
  - [Creating a Custom Provider (e.g. Ollama)](#creating-a-custom-provider-eg-ollama)
- [Configuration Reference](#-configuration-reference)
- [Development & Testing](#-development--testing)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Key Features

- 🌐 **Unified API**: Communicate seamlessly across different LLM providers using standard request/response structures aligned with the OpenAI Chat Completions specification.
- 🛡️ **In-Memory Circuit Breaker**: Detects provider outages instantaneously and trips (*Open Circuit*) to prevent cascading latencies and application thread blockage.
- 🔀 **Flexible Routing Strategies**:
  - `failover`: Automatically falls back to secondary providers when primary models fail or time out.
  - `load-balance`: Distributes requests in a round-robin rotation across multiple keys or endpoints to avert rate limiting (HTTP 429).
  - `lowest-cost`: Dynamically sorts and invokes the most cost-effective provider using token pricing (`costPer1kTokens`).
- 🌊 **Native SSE Streaming**: Stream completions in real time using native asynchronous generators (`for await...of`).
- 🔒 **Zero Data Leakage & 100% Local**: Runs strictly within your application's memory space. API keys and prompt payloads never leave your infrastructure.
- 🪝 **Rich Event Hooks**: Observe crucial gateway events (`onFallback`, `onCircuitOpen`, `onCircuitClose`, `onRateLimit`) for APM metrics and custom alerting.

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

Automatically execute through the most cost-efficient provider configured:

```typescript
import { SinapsClient, OpenAiProvider, GroqProvider } from 'sinapsai';

const client = new SinapsClient({
  strategy: 'lowest-cost',
  providers: [
    new OpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      costPer1kTokens: 0.005,
    }),
    new GroqProvider({
      apiKey: process.env.GROQ_API_KEY!,
      costPer1kTokens: 0.0005, // Prioritized first due to lower cost
    }),
  ],
});
```

---

### 5. Observability with Event Hooks

Integrate lifecycle events with your telemetry and monitoring pipelines (Datadog, OpenTelemetry, Prometheus):

```typescript
const client = new SinapsClient({
  providers: [...],
  hooks: {
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
  },
});
```

---

## 🧩 Supported Providers

| Provider | Exported Class | Options Supported |
| :--- | :--- | :--- |
| **OpenAI** | `OpenAiProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Anthropic Claude** | `AnthropicProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Google Gemini** | `GeminiProvider` | `apiVersion`, `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Groq** | `GroqProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **OpenRouter** | `OpenRouterProvider` | `baseUrl`, `timeoutMs`, `costPer1kTokens` |
| **Custom / On-Prem** | `Provider` (Interface) | Custom implementations for Ollama, vLLM, LocalAI, etc. |

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
| `strategy` | `'failover' \| 'load-balance' \| 'lowest-cost'` | `'failover'` | Routing algorithm for requests |
| `storage` | `StateStorage` | `InMemoryStorage` | State store for circuit breaker tracking |
| `circuitBreaker` | `CircuitBreakerOptions` | `{}` | Fault tolerance parameters |
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

This project is licensed under the **[Creative Commons Attribution 4.0 International License (CC BY 4.0)](./LICENSE)**.

You are free to:
- **Share** — copy and redistribute the material in any medium or format.
- **Adapt** — remix, transform, and build upon the material for any purpose, even commercially.

Under the condition that you provide appropriate attribution and a link to the license.

---

Crafted with dedication by **Roedy Rustam** & the SinapsAI Contributors.
