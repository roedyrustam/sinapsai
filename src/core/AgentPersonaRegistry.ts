/**
 * Zero-dependency In-Process Autonomous Dynamic Agent Persona & Ephemeral Skill Registry.
 *
 * Manages standardized personas, ephemeral skill lifetimes (auto-expiring across turns),
 * fine-grained tool whitelists/blacklists, and persona drift detection across multi-agent swarms.
 *
 * @author Roedy Rustam
 * @license MIT
 */

import type { ToolDefinition } from '../types/index.js';

export interface EphemeralSkill {
  id: string;
  name: string;
  instructions: string;
  tools?: ToolDefinition[];
  turnsRemaining: number;
}

export interface AgentPersona {
  id: string;
  name: string;
  role: string;
  systemInstructions: string;
  temperature?: number;
  allowedTools?: string[];
  forbiddenTools?: string[];
  styleGuidelines?: string[];
  ephemeralSkills?: EphemeralSkill[];
}

export interface PersonaDriftResult {
  hasDrift: boolean;
  score: number; // 0.0 (no drift) to 1.0 (severe drift)
  violations: string[];
}

export class AgentPersonaRegistry {
  private personas: Map<string, AgentPersona> = new Map();

  constructor(initialPersonas?: AgentPersona[]) {
    if (initialPersonas) {
      for (const p of initialPersonas) {
        this.registerPersona(p);
      }
    }
  }

  /**
   * Registers or updates an agent persona.
   */
  public registerPersona(persona: AgentPersona): void {
    this.personas.set(persona.id, {
      ...persona,
      ephemeralSkills: persona.ephemeralSkills
        ? [...persona.ephemeralSkills]
        : [],
      styleGuidelines: persona.styleGuidelines
        ? [...persona.styleGuidelines]
        : [],
    });
  }

  /**
   * Retrieves a persona by its ID.
   */
  public getPersona(id: string): AgentPersona | undefined {
    return this.personas.get(id);
  }

  /**
   * Lists all registered personas.
   */
  public listPersonas(): AgentPersona[] {
    return Array.from(this.personas.values());
  }

  /**
   * Deletes a persona from the registry.
   */
  public removePersona(id: string): boolean {
    return this.personas.delete(id);
  }

  /**
   * Injects an ephemeral skill into a persona. The skill will automatically
   * expire and be pruned after turnsRemaining turns are consumed.
   */
  public injectSkill(personaId: string, skill: EphemeralSkill): boolean {
    const persona = this.personas.get(personaId);
    if (!persona) return false;

    if (!persona.ephemeralSkills) {
      persona.ephemeralSkills = [];
    }

    // Replace if exists, else append
    const existingIdx = persona.ephemeralSkills.findIndex(
      (s) => s.id === skill.id,
    );
    if (existingIdx >= 0) {
      persona.ephemeralSkills[existingIdx] = { ...skill };
    } else {
      persona.ephemeralSkills.push({ ...skill });
    }

    return true;
  }

  /**
   * Consumes one turn for all active ephemeral skills on the persona,
   * decrementing turnsRemaining and pruning any skills that have expired (<= 0).
   */
  public consumeTurn(personaId: string): {
    activeSkillsCount: number;
    prunedSkills: string[];
  } {
    const persona = this.personas.get(personaId);
    if (!persona?.ephemeralSkills || persona.ephemeralSkills.length === 0) {
      return { activeSkillsCount: 0, prunedSkills: [] };
    }

    const prunedSkills: string[] = [];
    const activeSkills: EphemeralSkill[] = [];

    for (const skill of persona.ephemeralSkills) {
      skill.turnsRemaining--;
      if (skill.turnsRemaining <= 0) {
        prunedSkills.push(skill.id);
      } else {
        activeSkills.push(skill);
      }
    }

    persona.ephemeralSkills = activeSkills;
    return {
      activeSkillsCount: activeSkills.length,
      prunedSkills,
    };
  }

  /**
   * Verifies if a given tool is permitted under this persona's security policy.
   */
  public isToolAllowed(personaId: string, toolName: string): boolean {
    const persona = this.personas.get(personaId);
    if (!persona) return true; // Default allow if persona not registered

    // Check blacklist first
    if (persona.forbiddenTools?.includes(toolName)) {
      return false;
    }

    // Check whitelist
    if (persona.allowedTools && persona.allowedTools.length > 0) {
      // Also allow tools exposed by active ephemeral skills
      const ephemeralToolNames = (persona.ephemeralSkills ?? []).flatMap(
        (s) => s.tools?.map((t) => t.function.name) ?? [],
      );

      return (
        persona.allowedTools.includes(toolName) ||
        ephemeralToolNames.includes(toolName)
      );
    }

    return true;
  }

  /**
   * Compiles the complete, canonical system prompt for the persona,
   * synthesizing core instructions, style guidelines, and active ephemeral skills.
   */
  public buildSystemPrompt(personaId: string, dynamicContext?: string): string {
    const persona = this.personas.get(personaId);
    if (!persona) return dynamicContext ?? '';

    const sections: string[] = [
      `You are ${persona.name}, acting as ${persona.role}.`,
      persona.systemInstructions,
    ];

    if (persona.styleGuidelines && persona.styleGuidelines.length > 0) {
      sections.push(
        'Style & Behavioral Guidelines:\n' +
          persona.styleGuidelines.map((g) => `- ${g}`).join('\n'),
      );
    }

    if (persona.ephemeralSkills && persona.ephemeralSkills.length > 0) {
      sections.push(
        'Active Temporary Skills:\n' +
          persona.ephemeralSkills
            .map(
              (s) =>
                `[Skill: ${s.name} (${s.turnsRemaining} turn${s.turnsRemaining > 1 ? 's' : ''} left)]\n${s.instructions}`,
            )
            .join('\n\n'),
      );
    }

    if (dynamicContext) {
      sections.push(`Runtime Context:\n${dynamicContext}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Inspects agent output for persona drift (unauthorized apologies, generic fluff,
   * or violation of defined style guidelines).
   */
  public detectDrift(
    personaId: string,
    responseContent: string,
  ): PersonaDriftResult {
    const persona = this.personas.get(personaId);
    if (!persona) {
      return { hasDrift: false, score: 0.0, violations: [] };
    }

    const violations: string[] = [];

    // 1. Anti-apology drift check
    const apologyRegex =
      /\b(i('m| am) sorry|i apologize|my apologies|pardon me)\b/i;
    if (apologyRegex.test(responseContent)) {
      violations.push(
        'Agent used prohibited apologetic language violating concise style guidelines.',
      );
    }

    // 2. Sycophancy / cheerleading check
    const sycophancyRegex =
      /\b(as an ai|certainly|sure thing|great question|happy to help)\b/i;
    if (sycophancyRegex.test(responseContent)) {
      violations.push(
        'Agent used generic conversational filler / sycophantic intro.',
      );
    }

    // 3. Style guidelines compliance heuristic
    if (persona.styleGuidelines) {
      for (const guideline of persona.styleGuidelines) {
        const lowerG = guideline.toLowerCase();
        if (
          lowerG.includes('json') &&
          !responseContent.includes('{') &&
          !responseContent.includes('[')
        ) {
          violations.push(
            'Response does not adhere to mandatory JSON formatting guideline.',
          );
        }
      }
    }

    const score =
      violations.length > 0 ? Math.min(1.0, violations.length * 0.4) : 0.0;

    return {
      hasDrift: violations.length > 0,
      score: Number(score.toFixed(2)),
      violations,
    };
  }
}
