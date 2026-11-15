import { describe, expect, it } from 'vitest';
import {
  type AgentPersona,
  AgentPersonaRegistry,
  type EphemeralSkill,
} from './AgentPersonaRegistry.js';

describe('AgentPersonaRegistry', () => {
  it('registers, retrieves, and lists personas correctly', () => {
    const registry = new AgentPersonaRegistry();

    const architect: AgentPersona = {
      id: 'architect',
      name: 'Elena',
      role: 'Principal System Architect',
      systemInstructions: 'Design high-availability distributed systems.',
      allowedTools: ['read_architecture_diagram', 'query_db_schema'],
      styleGuidelines: ['Code-first', 'No fluff'],
    };

    registry.registerPersona(architect);

    expect(registry.getPersona('architect')?.name).toBe('Elena');
    expect(registry.listPersonas()).toHaveLength(1);

    expect(registry.removePersona('architect')).toBe(true);
    expect(registry.getPersona('architect')).toBeUndefined();
  });

  it('handles ephemeral skill injection and turn-based expiration', () => {
    const registry = new AgentPersonaRegistry([
      {
        id: 'analyst',
        name: 'Marcus',
        role: 'Data Analyst',
        systemInstructions: 'Analyze real-time metrics.',
      },
    ]);

    const tempSkill: EphemeralSkill = {
      id: 'sql_tuning',
      name: 'SQL Performance Tuning',
      instructions:
        'Examine EXPLAIN ANALYZE traces and recommend partial indexes.',
      turnsRemaining: 2,
    };

    registry.injectSkill('analyst', tempSkill);
    expect(registry.getPersona('analyst')?.ephemeralSkills).toHaveLength(1);

    // Turn 1
    const turn1 = registry.consumeTurn('analyst');
    expect(turn1.activeSkillsCount).toBe(1);
    expect(turn1.prunedSkills).toHaveLength(0);

    // Turn 2: skill reaches 0 turnsRemaining and is pruned
    const turn2 = registry.consumeTurn('analyst');
    expect(turn2.activeSkillsCount).toBe(0);
    expect(turn2.prunedSkills).toEqual(['sql_tuning']);
    expect(registry.getPersona('analyst')?.ephemeralSkills).toHaveLength(0);
  });

  it('enforces allowedTools whitelist and forbiddenTools blacklist', () => {
    const registry = new AgentPersonaRegistry([
      {
        id: 'auditor',
        name: 'Sarah',
        role: 'Security Auditor',
        systemInstructions: 'Audit code for vulnerabilities.',
        allowedTools: ['scan_repo', 'read_file'],
        forbiddenTools: ['delete_file', 'execute_shell'],
      },
    ]);

    expect(registry.isToolAllowed('auditor', 'scan_repo')).toBe(true);
    expect(registry.isToolAllowed('auditor', 'read_file')).toBe(true);
    expect(registry.isToolAllowed('auditor', 'delete_file')).toBe(false);
    expect(registry.isToolAllowed('auditor', 'unregistered_tool')).toBe(false);
  });

  it('builds canonical system prompt with style guidelines and ephemeral skills', () => {
    const registry = new AgentPersonaRegistry([
      {
        id: 'reviewer',
        name: 'Dave',
        role: 'Code Reviewer',
        systemInstructions: 'Review pull requests against Clean Code rules.',
        styleGuidelines: ['Explain the architectural WHY', 'Do not apologize'],
      },
    ]);

    registry.injectSkill('reviewer', {
      id: 'rust_ownership',
      name: 'Rust Lifetime Analysis',
      instructions: 'Check borrow checker lifetimes.',
      turnsRemaining: 3,
    });

    const prompt = registry.buildSystemPrompt(
      'reviewer',
      'Repository: backend-service',
    );

    expect(prompt).toContain('You are Dave, acting as Code Reviewer.');
    expect(prompt).toContain('Explain the architectural WHY');
    expect(prompt).toContain('[Skill: Rust Lifetime Analysis (3 turns left)]');
    expect(prompt).toContain('Repository: backend-service');
  });

  it('detects persona drift for apologetic language and sycophancy', () => {
    const registry = new AgentPersonaRegistry([
      {
        id: 'strict_expert',
        name: 'Alex',
        role: 'Strict Tech Lead',
        systemInstructions: 'Answer directly without conversational fluff.',
        styleGuidelines: ['Return output in JSON format'],
      },
    ]);

    // Flawed response with apology and conversational fluff, missing JSON
    const flawedResponse =
      'I apologize for the delay! Certainly! Here is the answer without braces.';
    const drift = registry.detectDrift('strict_expert', flawedResponse);

    expect(drift.hasDrift).toBe(true);
    expect(drift.score).toBeGreaterThan(0.5);
    expect(drift.violations.some((v) => v.includes('apologetic'))).toBe(true);
    expect(drift.violations.some((v) => v.includes('filler'))).toBe(true);
    expect(drift.violations.some((v) => v.includes('JSON'))).toBe(true);

    // Clean JSON response
    const cleanResponse = JSON.stringify({ status: 'ok', data: [1, 2, 3] });
    const cleanDrift = registry.detectDrift('strict_expert', cleanResponse);
    expect(cleanDrift.hasDrift).toBe(false);
    expect(cleanDrift.score).toBe(0.0);
  });
});
