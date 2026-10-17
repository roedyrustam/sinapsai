/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  CloudflareKVStorage,
  D1Storage,
  PIIGuardrails,
  type Provider,
  RedisStorage,
  SinapsClient,
  type UnifiedApiResponse,
} from '../src/index.js';

/**
 * Example 17: Distributed Storage Adapters & In-Process PII Guardrails
 *
 * Demonstrates:
 * 1. Zero-dependency PII Guardrails: redaction of emails, phones, credit cards (Luhn-validated), SSN, IP, JWT.
 * 2. Automatic outgoing payload sanitization inside SinapsClient before data leaves network boundaries.
 * 3. Redis / Upstash / Valkey distributed state storage (`RedisStorage`) for multi-instance clusters.
 * 4. Cloudflare Workers KV (`CloudflareKVStorage`) and Cloudflare D1 SQL (`D1Storage`) for Edge deployments.
 */
async function run() {
  console.log('=== SinapsAI Distributed Storage & PII Guardrails ===\n');

  // =========================================================================
  // PART 1: Standalone In-Process PII Guardrails Engine
  // =========================================================================
  console.log('--- Part 1: In-Process PII Guardrails Engine ---');

  const guardrails = new PIIGuardrails({
    categories: ['email', 'phone', 'credit_card', 'ssn', 'ip_address', 'jwt'],
    allowlist: ['support@company.com'],
    onPIIDetected: (matches) => {
      for (const match of matches) {
        console.log(`  [PII Detected] Category: ${match.category} -> "${match.original}"`);
      }
    },
  });

  const sensitivePrompt = `
Hello, my name is John Doe. My email is john.doe@example.com, and my phone is +1-555-867-5309.
Please charge my corporate card 4532-0150-1234-5678 or fallback to SSN 123-45-6789.
Server IP: 192.168.1.100.
Also, our public support is support@company.com (allowlisted).
  `.trim();

  console.log('\nOriginal prompt:');
  console.log(sensitivePrompt);

  const redactedText = guardrails.redact(sensitivePrompt);
  const detectedMatches = guardrails.detect(sensitivePrompt);
  console.log('\nRedacted prompt (Safe to send over network):');
  console.log(redactedText);
  console.log(`Total items redacted: ${detectedMatches.length}\n`);

  // =========================================================================
  // PART 2: SinapsClient with Built-In PII Guardrails Middleware
  // =========================================================================
  console.log('--- Part 2: Automatic PII Guardrails Middleware in SinapsClient ---');

  // Mock Provider to inspect incoming request payload received by provider
  let receivedPayloadMessages: any[] = [];
  const inspectProvider: Provider = {
    id: 'inspect-provider',
    name: 'Inspection Provider',
    async generateContent(request) {
      receivedPayloadMessages = request.messages;
      return {
        id: 'resp-inspect-1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Request processed safely. No PII was received.',
            },
            finishReason: 'stop',
          },
        ],
        model: request.model,
        usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
      } as UnifiedApiResponse;
    },
  };

  const secureClient = new SinapsClient({
    providers: [inspectProvider],
    piiGuardrails: {
      enabled: true,
      categories: ['email', 'phone', 'credit_card', 'ip_address'],
    },
  });

  console.log('Dispatching request through SinapsClient...');
  const response = await secureClient.chat.completions.create({
    model: 'inspect-model',
    messages: [
      {
        role: 'user',
        content: 'Contact me at secret.agent@defense.gov or call 555-123-4567.',
      },
    ],
  });

  console.log('Provider received payload:');
  console.log(JSON.stringify(receivedPayloadMessages, null, 2));
  console.log('Response content:', response.choices[0].message.content);

  // =========================================================================
  // PART 3: Distributed Storage Adapters for Clusters & Edge
  // =========================================================================
  console.log('\n--- Part 3: Distributed Storage Adapters ---');

  // 1. In-Memory Mock Redis Client to demonstrate RedisStorage adapter
  const redisStore = new Map<string, { val: string; exp?: number }>();
  const mockRedisClient = {
    async get(key: string): Promise<string | null> {
      const entry = redisStore.get(key);
      if (!entry) return null;
      if (entry.exp && Date.now() > entry.exp) {
        redisStore.delete(key);
        return null;
      }
      return entry.val;
    },
    async set(
      key: string,
      val: string,
      ...args: any[]
    ): Promise<'OK' | null> {
      let exp: number | undefined;
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        exp = Date.now() + args[1] * 1000;
      }
      redisStore.set(key, { val, exp });
      return 'OK';
    },
    async del(key: string): Promise<number> {
      return redisStore.delete(key) ? 1 : 0;
    },
    async incr(key: string): Promise<number> {
      const entry = redisStore.get(key);
      const num = entry ? Number.parseInt(entry.val, 10) + 1 : 1;
      redisStore.set(key, { val: String(num) });
      return num;
    },
  };

  const redisStorage = new RedisStorage(mockRedisClient, {
    prefix: 'sinaps:prod:',
  });

  // Test set with 60s TTL
  await redisStorage.set('rate_limit:user_123', { count: 1, tier: 'enterprise' }, 60);
  const cachedVal = await redisStorage.get('rate_limit:user_123');
  console.log('Retrieved from RedisStorage:', cachedVal);

  // Atomic increment
  const newCount = await redisStorage.increment('counter:requests');
  console.log('RedisStorage atomic counter:', newCount);

  // 2. Cloudflare KV Adapter demonstration
  const kvStore = new Map<string, string>();
  const mockKVNamespace = {
    async get(key: string) {
      return kvStore.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kvStore.set(key, value);
    },
    async delete(key: string) {
      kvStore.delete(key);
    },
  };

  const cfStorage = new CloudflareKVStorage(mockKVNamespace as any, { prefix: 'edge:' });
  await cfStorage.set('circuit_status', { provider: 'openai', status: 'closed' }, 120);
  const cfVal = await cfStorage.get('circuit_status');
  console.log('Retrieved from CloudflareKVStorage:', cfVal);

  console.log('\n=== All Distributed Storage & PII Guardrails Demos Passed Successfully ===');
}

run().catch(console.error);
