/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Tests for Episodic Vector Memory & Context Injection Engine
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/index.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { SinapsClient } from './SinapsClient.js';

describe('EpisodicMemory', () => {
  it('stores and retrieves memory records by id', async () => {
    const memory = new EpisodicMemory();

    const record = await memory.store({
      content: 'User prefers concise TypeScript answers with zero boilerplate.',
      userId: 'user_123',
      metadata: { domain: 'coding' },
    });

    expect(record.id).toBeDefined();
    expect(record.content).toContain('zero boilerplate');
    expect(record.userId).toBe('user_123');

    const fetched = memory.get(record.id);
    expect(fetched).toEqual(record);
    expect(memory.count()).toBe(1);
    expect(memory.count('user_123')).toBe(1);
    expect(memory.count('user_999')).toBe(0);
  });

  it('recalls top relevant records using semantic cosine similarity', async () => {
    const memory = new EpisodicMemory();

    await memory.store({
      content: 'User lives in Jakarta and speaks Indonesian and English.',
      userId: 'user_a',
    });
    await memory.store({
      content: 'User is allergic to peanuts and seafood.',
      userId: 'user_a',
    });
    await memory.store({
      content: 'Quantum entanglement physics experiments.',
      userId: 'user_b',
    });

    // Query for dietary restrictions of user_a
    const results = await memory.recall({
      query: 'What foods does the user avoid due to allergies?',
      userId: 'user_a',
      topK: 2,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].record.content).toContain('allergic to peanuts');
    expect(results[0].record.userId).toBe('user_a');

    // user_b data should be isolated and not leaked
    for (const r of results) {
      expect(r.record.userId).toBe('user_a');
    }
  });

  it('injects relevant episodic memories into system prompt', async () => {
    const memory = new EpisodicMemory();

    await memory.store({
      content: 'Customer is a VIP tier subscriber with enterprise license.',
      userId: 'vip_user',
    });

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an AI support assistant for SinapsAI.',
      },
      {
        role: 'user',
        content: 'Can you show me the enterprise SLA terms?',
      },
    ];

    const augmented = await memory.injectIntoMessages(
      messages,
      'enterprise SLA terms',
      'vip_user',
      { topK: 2 },
    );

    expect(augmented.length).toBe(2);
    const systemPrompt = augmented[0].content as string;
    expect(systemPrompt).toContain('LONG-TERM EPISODIC MEMORY / USER FACTS');
    expect(systemPrompt).toContain('VIP tier subscriber');
    expect(systemPrompt).toContain('You are an AI support assistant');
  });

  it('prepends new system message if none existed when injecting memories', async () => {
    const memory = new EpisodicMemory();

    await memory.store({
      content: 'User prefers dark mode.',
      userId: 'u1',
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Preferences?' }];

    const augmented = await memory.injectIntoMessages(
      messages,
      'preferences',
      'u1',
    );

    expect(augmented.length).toBe(2);
    expect(augmented[0].role).toBe('system');
    expect(augmented[0].content).toContain('User prefers dark mode');
  });

  it('persists and restores with backing StateStorage', async () => {
    const storage = new InMemoryStorage();
    const mem1 = new EpisodicMemory({ storage });

    const rec = await mem1.store({
      content: 'Important financial rule: always check tax rate.',
      userId: 'finance_dept',
    });

    // Verify written to storage
    const stored = await storage.get<unknown>(`sinaps_mem_${rec.id}`);
    expect(stored).toBeDefined();

    // Delete record
    await mem1.delete(rec.id);
    expect(mem1.count()).toBe(0);
    const afterDelete = await storage.get(`sinaps_mem_${rec.id}`);
    expect(afterDelete).toBeNull();
  });

  it('clears records by user or entirely', async () => {
    const memory = new EpisodicMemory();
    await memory.store({ content: 'Item 1', userId: 'alice' });
    await memory.store({ content: 'Item 2', userId: 'alice' });
    await memory.store({ content: 'Item 3', userId: 'bob' });

    expect(memory.count()).toBe(3);
    await memory.clear('alice');
    expect(memory.count('alice')).toBe(0);
    expect(memory.count('bob')).toBe(1);

    await memory.clear();
    expect(memory.count()).toBe(0);
  });

  it('integrates seamlessly with SinapsClient.memory instance', async () => {
    const client = new SinapsClient({
      providers: [
        {
          id: 'test-p',
          name: 'test',
          models: ['m1'],
          apiKey: 'key',
        },
      ],
    });

    expect(client.memory).toBeInstanceOf(EpisodicMemory);
    const rec = await client.memory.store({
      content: 'Client memory integrated directly.',
      userId: 'direct_user',
    });
    expect(client.memory.get(rec.id)).toBeDefined();
  });
});
