/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * FaithfulnessSentinel Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import type { UnifiedApiResponse } from '../types/index.js';
import { FaithfulnessSentinel } from './FaithfulnessSentinel.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import { SinapsClient } from './SinapsClient.js';

describe('FaithfulnessSentinel', () => {
  const context = [
    'SinapsAI is a zero-dependency in-process AI gateway and control plane built in TypeScript.',
    'It runs completely within your Node.js application process without requiring external proxy containers or Python services.',
    'Key capabilities include adaptive routing, semantic caching, and proactive canary health probing.',
  ];

  it('extracts atomic claims from answers while filtering conversational preambles', () => {
    const sentinel = new FaithfulnessSentinel();
    const answer = `
      Certainly! Here is the summary:
      - SinapsAI is an in-process AI gateway developed in TypeScript.
      - It requires no external Docker containers or proxy servers.
      - Furthermore, it features active canary health probing.
    `;

    const claims = sentinel.extractClaims(answer);
    expect(claims.length).toBe(3);
    expect(claims[0]).toContain('SinapsAI is an in-process AI gateway');
    expect(claims[1]).toContain('It requires no external Docker containers');
    expect(claims[2]).toContain('Furthermore, it features active canary');
  });

  it('verifies grounded claims with high faithfulness score', () => {
    const sentinel = new FaithfulnessSentinel({ minFaithfulnessScore: 0.75 });
    const answer =
      'SinapsAI is an in-process AI gateway built in TypeScript that runs without external proxy containers.';

    const result = sentinel.verifyGrounding({
      answer,
      context,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
    expect(result.unsupportedClaims.length).toBe(0);
    expect(result.claimAudits.length).toBeGreaterThan(0);
    expect(result.claimAudits[0].isSupported).toBe(true);
  });

  it('detects hallucinations and flags unsupported claims', () => {
    const sentinel = new FaithfulnessSentinel({ minFaithfulnessScore: 0.8 });
    const hallucinatedAnswer = `
      SinapsAI is a quantum computing framework running exclusively on Rust.
      It requires 128 gigabytes of GPU VRAM and a dedicated Kubernetes cluster in Frankfurt.
    `;

    const result = sentinel.verifyGrounding({
      answer: hallucinatedAnswer,
      context,
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(0.5);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    expect(result.unsupportedClaims[0]).toContain('quantum computing');
  });

  it('handles empty context or answer gracefully', () => {
    const sentinel = new FaithfulnessSentinel();
    const emptyResult = sentinel.verifyGrounding({
      answer: '',
      context: [],
    });

    expect(emptyResult.passed).toBe(true);
    expect(emptyResult.score).toBe(1.0);
    expect(emptyResult.totalClaims).toBe(0);
  });

  it('executes auto-retry / escalation when initial answer contains hallucinations', async () => {
    const client = new SinapsClient({
      providers: [new OllamaProvider({ id: 'test-prov' })],
      storage: new InMemoryStorage(),
    });

    let callCount = 0;
    vi.spyOn(client.chat.completions, 'create').mockImplementation(
      async (req) => {
        callCount++;
        if (callCount === 1) {
          // First attempt hallucinated
          return {
            id: 'chat_1',
            model: req.model || 'test-model',
            provider: 'test-prov',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content:
                    'SinapsAI requires an external Kubernetes cluster and 64GB of memory.',
                },
                finishReason: 'stop',
              },
            ],
          } as unknown as UnifiedApiResponse;
        }
        // Healed attempt grounded in context
        return {
          id: 'chat_2',
          model: req.model || 'test-model',
          provider: 'test-prov',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'SinapsAI runs completely in-process within Node.js without requiring external proxy containers.',
              },
              finishReason: 'stop',
            },
          ],
        } as unknown as UnifiedApiResponse;
      },
    );

    const sentinel = new FaithfulnessSentinel({
      minFaithfulnessScore: 0.8,
      autoEscalate: true,
      client,
    });

    const res = await sentinel.executeVerifiedCompletion(
      {
        model: 'test-model',
        messages: [
          { role: 'user', content: 'Tell me about SinapsAI infrastructure' },
        ],
        context,
      },
      client,
    );

    expect(callCount).toBe(2);
    expect(res.grounding.escalated).toBe(true);
    expect(res.grounding.passed).toBe(true);
    expect(res.completion.choices[0].message.content).toContain(
      'runs completely in-process',
    );
  });

  it('exposes createGroundingVerified directly on client.chat.completions', async () => {
    const client = new SinapsClient({
      providers: [new OllamaProvider({ id: 'test-prov' })],
      storage: new InMemoryStorage(),
    });

    vi.spyOn(client.chat.completions, 'create').mockResolvedValueOnce({
      id: 'chat_verified',
      model: 'test-model',
      provider: 'test-prov',
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              'SinapsAI is a zero-dependency in-process AI gateway and control plane built in TypeScript.',
          },
          finishReason: 'stop',
        },
      ],
    } as unknown as UnifiedApiResponse);

    const verified = await client.chat.completions.createGroundingVerified({
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is SinapsAI?' }],
      context,
      minFaithfulness: 0.7,
    });

    expect(verified.grounding.passed).toBe(true);
    expect(verified.grounding.score).toBeGreaterThanOrEqual(0.7);
    expect(verified.response.choices[0].message.content).toContain(
      'zero-dependency',
    );
  });
});
