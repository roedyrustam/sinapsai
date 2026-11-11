/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Tournament & Voting Consensus Engine Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { TournamentConsensusEngine } from './TournamentConsensus.js';

describe('TournamentConsensusEngine', () => {
  it('should handle single submission with 100% confidence', async () => {
    const engine = new TournamentConsensusEngine();
    const result = await engine.evaluate([
      { agentId: 'agent_1', content: 'Use AES-GCM-256 for symmetric encryption.' },
    ]);

    expect(result.winningSolution).toBe('Use AES-GCM-256 for symmetric encryption.');
    expect(result.winningAgentId).toBe('agent_1');
    expect(result.confidence).toBe(1.0);
    expect(result.dissentingViews.length).toBe(0);
  });

  it('should resolve majority consensus when 2 out of 3 agents agree', async () => {
    const engine = new TournamentConsensusEngine({
      strategy: 'majority',
      similarityThreshold: 0.55,
    });

    const submissions = [
      {
        agentId: 'claude_architect',
        content: 'Implement a distributed Raft consensus algorithm with state machine replication.',
      },
      {
        agentId: 'gpt_engineer',
        content: 'Use Raft consensus algorithm for leader election and log replication.',
      },
      {
        agentId: 'rebel_agent',
        content: 'Use centralized Redis master-replica without Raft or consensus.',
      },
    ];

    const result = await engine.evaluate(submissions);

    expect(result.strategy).toBe('majority');
    expect(['claude_architect', 'gpt_engineer']).toContain(result.winningAgentId);
    expect(result.clusters.length).toBe(2);
    expect(result.dissentingViews.length).toBe(1);
    expect(result.dissentingViews[0].agentId).toBe('rebel_agent');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('should honor agent weights in weighted voting', async () => {
    const engine = new TournamentConsensusEngine({
      strategy: 'weighted',
      similarityThreshold: 0.7,
      weights: {
        principal_architect: 5.0, // High weight
        junior_dev: 1.0,
      },
    });

    const submissions = [
      {
        agentId: 'principal_architect',
        content: 'Enforce strict Zero-Trust authentication with mutual TLS.',
      },
      {
        agentId: 'junior_dev',
        content: 'Use basic HTTP header tokens without TLS.',
      },
    ];

    const result = await engine.evaluate(submissions);

    expect(result.winningAgentId).toBe('principal_architect');
    expect(result.winningSolution).toContain('Zero-Trust');
    expect(result.dissentingViews.length).toBe(1);
    expect(result.dissentingViews[0].agentId).toBe('junior_dev');
  });

  it('should calculate Borda points across peer similarity rankings', async () => {
    const engine = new TournamentConsensusEngine({ strategy: 'borda' });

    const submissions = [
      { agentId: 'a1', content: 'Option A: Microservices with Docker' },
      { agentId: 'a2', content: 'Option A: Containerized microservices using Docker' },
      { agentId: 'a3', content: 'Option B: Monolithic PHP application' },
    ];

    const result = await engine.evaluate(submissions);
    expect(result.strategy).toBe('borda');
    expect(result.scores['a1'].bordaPoints).toBeGreaterThan(0);
    expect(result.scores['a2'].bordaPoints).toBeGreaterThan(0);
    expect(result.scores['a3'].bordaPoints).toBeDefined();
  });

  it('should reject empty submissions with clear error', async () => {
    const engine = new TournamentConsensusEngine();
    await expect(engine.evaluate([])).rejects.toThrow(
      'TournamentConsensusEngine requires at least one candidate submission.',
    );
  });
});
