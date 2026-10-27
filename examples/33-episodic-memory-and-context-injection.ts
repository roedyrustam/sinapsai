/**
 * Example 33: Long-Term Episodic Vector Memory & Context Injection
 *
 * Demonstrates:
 * 1. Zero-dependency in-process episodic vector memory.
 * 2. User & tenant data isolation (multi-tenant safety).
 * 3. Semantic recall using local subword character n-gram cosine similarity.
 * 4. Dynamic injection of recalled facts into system instructions.
 * 5. StateStorage persistence (InMemory, Redis, Cloudflare KV, D1).
 */

import {
  type ChatMessage,
  EpisodicMemory,
  InMemoryStorage,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log(
    '=== 1. Episodic Vector Memory & Dynamic Context Injection ===\n',
  );

  // Initialize EpisodicMemory with an in-memory backing storage
  const storage = new InMemoryStorage();
  const memory = new EpisodicMemory({ storage });

  console.log('--- A. Ingesting User Knowledge & Preferences ---');
  await memory.store({
    userId: 'usr_sarah',
    content:
      'Sarah prefers TypeScript code samples with strict typing and functional style.',
    metadata: { role: 'Senior Architect', department: 'Engineering' },
  });

  await memory.store({
    userId: 'usr_sarah',
    content:
      'Sarah uses macOS and develops primarily for Cloudflare Workers edge runtime.',
    metadata: { stack: 'Cloudflare Workers', os: 'macOS' },
  });

  await memory.store({
    userId: 'usr_alex',
    content: 'Alex prefers Python 3.13 examples using FastAPI and uv.',
    metadata: { stack: 'Python', role: 'Data Scientist' },
  });

  console.log(`Total Stored Facts: ${memory.count()}`);
  console.log(`Sarah Facts: ${memory.count('usr_sarah')}`);
  console.log(`Alex Facts: ${memory.count('usr_alex')}\n`);

  console.log('--- B. Semantic Recall with User Partition Isolation ---');
  const query =
    'What runtime and language does the user target for deployment?';
  const recalledSarah = await memory.recall({
    userId: 'usr_sarah',
    query,
    topK: 2,
  });

  console.log(`Query: "${query}" (for usr_sarah):`);
  for (const item of recalledSarah) {
    console.log(
      `  - [Match ${(item.similarity * 100).toFixed(0)}%] ${item.record.content}`,
    );
  }

  // Cross-tenant protection verification
  const recalledAlex = await memory.recall({
    userId: 'usr_alex',
    query,
    topK: 2,
  });
  console.log(`\nQuery: "${query}" (for usr_alex):`);
  for (const item of recalledAlex) {
    console.log(
      `  - [Match ${(item.similarity * 100).toFixed(0)}%] ${item.record.content}`,
    );
  }

  console.log('\n--- C. Dynamic Prompt Injection for LLM Invocations ---');
  const baseMessages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are SinapsAI Code Copilot, an elite programming assistant.',
    },
    {
      role: 'user',
      content: 'Show me an HTTP handler boilerplate for my project.',
    },
  ];

  const augmentedMessages = await memory.injectIntoMessages(
    baseMessages,
    'HTTP handler boilerplate',
    'usr_sarah',
  );

  console.log('Augmented System Prompt:');
  console.log(augmentedMessages[0].content);

  console.log('\n--- D. Native SinapsClient.memory Instance Direct Access ---');
  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        apiKey: 'demo',
      }),
    ],
  });

  await client.memory.store({
    userId: 'org_enterprise',
    content: 'Corporate policy: All API keys must rotate every 90 days.',
  });

  console.log(
    `client.memory contains ${client.memory.count('org_enterprise')} enterprise facts.`,
  );
}

main().catch(console.error);
