import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/index.js';
import { DatasetDistiller } from './DatasetDistiller.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { PIIGuardrails } from './PIIGuardrails.js';

describe('DatasetDistiller', () => {
  it('records DPO pairs and exports standard JSONL', async () => {
    const distiller = new DatasetDistiller();

    await distiller.recordDpo({
      prompt: 'Write a Python function to check palindrome.',
      chosen: 'def is_palindrome(s: str) -> bool:\n    return s == s[::-1]',
      rejected: 'def is_palindrome(s):\n    # TODO: implement',
      scoreChosen: 0.95,
      scoreRejected: 0.3,
      critique: 'Rejected output contained a TODO placeholder.',
    });

    await distiller.recordDpo({
      prompt: 'Explain CAP theorem in simple terms.',
      chosen:
        'CAP theorem states that a distributed system cannot guarantee Consistency, Availability, and Partition Tolerance simultaneously.',
      rejected: 'CAP theorem is about computers and networks.',
      scoreChosen: 0.9,
      scoreRejected: 0.4,
    });

    const dpoRecords = distiller.getDpoRecords();
    expect(dpoRecords.length).toBe(2);
    expect(dpoRecords[0].chosen).toContain('def is_palindrome');

    const jsonl = distiller.exportDpoJsonl();
    const lines = jsonl.split('\n');
    expect(lines.length).toBe(2);

    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.prompt).toBe('Write a Python function to check palindrome.');
    expect(parsed1.chosen).toContain('def is_palindrome');
    expect(parsed1.rejected).toContain('TODO');
  });

  it('records SFT conversations and exports standard JSONL', async () => {
    const distiller = new DatasetDistiller();

    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is the capital of Indonesia?' },
      {
        role: 'assistant',
        content:
          'The capital of Indonesia is Jakarta (with Nusantara as the new planned capital).',
      },
    ];

    await distiller.recordSft({
      messages,
      score: 0.98,
    });

    const sftRecords = distiller.getSftRecords();
    expect(sftRecords.length).toBe(1);

    const jsonl = distiller.exportSftJsonl();
    const parsed = JSON.parse(jsonl);
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[1].content).toContain('Jakarta');
  });

  it('automatically sanitizes PII before recording when PIIGuardrails is provided', async () => {
    const guardrails = new PIIGuardrails();
    const distiller = new DatasetDistiller({
      autoSanitizePii: true,
      piiGuardrails: guardrails,
    });

    await distiller.recordDpo({
      prompt: 'Contact John at john.doe@example.com or +1-555-123-4567.',
      chosen: 'We have processed the request for John at john.doe@example.com.',
      rejected: 'Invalid email john.doe@example.com.',
    });

    const record = distiller.getDpoRecords()[0];
    expect(record.prompt).not.toContain('john.doe@example.com');
    expect(record.prompt).toContain('[EMAIL]');
    expect(record.chosen).not.toContain('john.doe@example.com');
    expect(record.chosen).toContain('[EMAIL]');
    expect(record.rejected).toContain('[EMAIL]');
  });

  it('filters by minScore and limit in exports', async () => {
    const distiller = new DatasetDistiller();

    await distiller.recordDpo({
      prompt: 'Q1',
      chosen: 'A1 high quality',
      rejected: 'A1 bad',
      scoreChosen: 0.95,
    });

    await distiller.recordDpo({
      prompt: 'Q2',
      chosen: 'A2 low quality',
      rejected: 'A2 worse',
      scoreChosen: 0.65,
    });

    const highQualityJsonl = distiller.exportDpoJsonl({ minScore: 0.9 });
    const lines = highQualityJsonl.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Q1');

    const limitedJsonl = distiller.exportDpoJsonl({ minScore: 0.5, limit: 1 });
    expect(limitedJsonl.split('\n').length).toBe(1);
    expect(limitedJsonl).toContain('Q2');
  });

  it('tracks token statistics and storage persistence', async () => {
    const storage = new InMemoryStorage();
    const distiller = new DatasetDistiller({ storage });

    await distiller.recordDpo({
      prompt: 'Hello world',
      chosen: 'Hello from chosen',
      rejected: 'Hello from rejected',
    });

    const stats = distiller.getStats();
    expect(stats.dpoCount).toBe(1);
    expect(stats.sftCount).toBe(0);
    expect(stats.totalEstimatedTokens).toBeGreaterThan(0);

    const record = distiller.getDpoRecords()[0];
    const stored = await storage.get(`distiller:dpo:${record.id}`);
    expect(stored).toBeDefined();

    await distiller.clear();
    expect(distiller.getDpoRecords().length).toBe(0);
  });
});
