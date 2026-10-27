/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type {
  ChatMessage,
  SecurityAction,
  SecurityGuardrailsOptions,
  SecurityScanResult,
  SecurityViolation,
  ThreatCategory,
} from '../types/index.js';

export class SecurityGuardrailError extends Error {
  public readonly violations: SecurityViolation[];

  constructor(message: string, violations: SecurityViolation[]) {
    super(message);
    this.name = 'SecurityGuardrailError';
    this.violations = violations;
  }
}

interface ThreatRule {
  category: ThreatCategory;
  regex: RegExp;
}

const DEFAULT_THREAT_RULES: ThreatRule[] = [
  // 1. System Prompt Override & Directive Reset
  {
    category: 'system_override',
    regex:
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|commands|context)/i,
  },
  {
    category: 'system_override',
    regex:
      /(?:disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|safety|guardrail|system)\s+(?:instructions|guidelines|rules|prompts)/i,
  },
  {
    category: 'system_override',
    regex: /\boverride\s+(?:system\s+)?(?:prompt|instructions|rules)\b/i,
  },

  // 2. Jailbreak Personas & Unrestricted AI Activation
  {
    category: 'jailbreak',
    regex:
      /\byou\s+are\s+now\s+(?:dan|unrestricted|jailbroken|freed|an\s+evil|chaosgpt)\b/i,
  },
  {
    category: 'jailbreak',
    regex: /\bdeveloper\s+mode\s+(?:is\s+)?(?:enabled|activated|on)\b/i,
  },
  {
    category: 'jailbreak',
    regex: /\bdo\s+anything\s+now\b/i,
  },
  {
    category: 'jailbreak',
    regex: /\bignore\s+ethical\s+guidelines\b/i,
  },
  {
    category: 'jailbreak',
    regex: /\bact\s+as\s+an?\s+unfiltered\s+ai\b/i,
  },

  // 3. Chat Delimiter Hijacking & Format Injection
  {
    category: 'delimiter_hijack',
    regex: /<\s*\|\s*im_start\s*\|\s*>\s*system/i,
  },
  {
    category: 'delimiter_hijack',
    regex: /\[SYSTEM(?:\s+PROMPT)?\]/i,
  },
  {
    category: 'delimiter_hijack',
    regex: /<<SYS>>[\s\S]*?<\/SYS>>/i,
  },
  {
    category: 'delimiter_hijack',
    regex: /<\/?(?:INST|SYS|SYSTEM)>/i,
  },
  {
    category: 'delimiter_hijack',
    regex: /---+ ?(?:BEGIN|START) SYSTEM (?:PROMPT|INSTRUCTIONS) ?---+/i,
  },

  // 4. Secret & System Prompt Exfiltration
  {
    category: 'secret_exfiltration',
    regex:
      /(?:print|output|reveal|display|leak|repeat)\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions|system\s+instructions)\s+(?:verbatim|word\s+for\s+word|in\s+full)/i,
  },
  {
    category: 'secret_exfiltration',
    regex:
      /(?:what\s+are\s+your|show\s+me\s+your)\s+(?:initial\s+instructions|system\s+prompts?|hidden\s+rules)/i,
  },

  // 5. Prompt Injection Syntax Patterns
  {
    category: 'prompt_injection',
    regex: /\bnew\s+instructions\s*:\s*(?:you\s+must|always|ignore)/i,
  },
  {
    category: 'prompt_injection',
    regex: /\bhidden\s+instructions\s*:/i,
  },
];

/**
 * SecurityGuardrails protects applications against prompt injection, jailbreaking,
 * delimiter hijacking, and system prompt exfiltration before prompts reach upstream LLMs.
 */
export class SecurityGuardrails {
  public readonly enabled: boolean;
  public readonly action: SecurityAction;
  private readonly rules: ThreatRule[];
  private readonly allowedPatterns: RegExp[];

  constructor(options: SecurityGuardrailsOptions = {}) {
    this.enabled = options.enabled !== false;
    this.action = options.action ?? 'block';
    this.rules = [...DEFAULT_THREAT_RULES, ...(options.customPatterns ?? [])];
    this.allowedPatterns = options.allowedPatterns ?? [];
  }

  /**
   * Scans a text string for prompt injection or jailbreak indicators.
   */
  public scan(text: string): SecurityScanResult {
    if (!this.enabled || !text) {
      return {
        safe: true,
        sanitizedText: text || '',
        violations: [],
      };
    }

    const violations: SecurityViolation[] = [];
    let sanitizedText = text;

    for (const rule of this.rules) {
      // Find all matches for this rule
      const flags = rule.regex.flags.includes('g')
        ? rule.regex.flags
        : `${rule.regex.flags}g`;
      const globalRegex = new RegExp(rule.regex.source, flags);

      let match: RegExpExecArray | null;
      while (true) {
        match = globalRegex.exec(text);
        if (match === null) break;

        const matchedText = match[0];

        // Prevent infinite loop on zero-length regex matches
        if (matchedText.length === 0) {
          globalRegex.lastIndex++;
          continue;
        }

        // Check if allowed
        const isAllowed = this.allowedPatterns.some((allowed) => {
          if (allowed.test(matchedText)) return true;
          const allowedClone = new RegExp(
            allowed.source,
            allowed.flags.replace('g', ''),
          );
          const textMatch = allowedClone.exec(text);
          if (textMatch && match) {
            const start = textMatch.index;
            const end = start + textMatch[0].length;
            return (
              match.index >= start && match.index + matchedText.length <= end
            );
          }
          return false;
        });
        if (isAllowed) {
          continue;
        }

        const violation: SecurityViolation = {
          category: rule.category,
          pattern: rule.regex.source,
          matchedText,
          action: this.action,
          timestamp: Date.now(),
        };
        violations.push(violation);

        if (this.action === 'sanitize') {
          const redactedReplacement = `[SECURITY_REDACTED: ${rule.category}]`;
          sanitizedText = sanitizedText.replace(
            matchedText,
            () => redactedReplacement,
          );
        }
      }
    }

    return {
      safe: violations.length === 0,
      sanitizedText,
      violations,
    };
  }

  /**
   * Scans an array of ChatMessage objects and applies the configured action.
   */
  public scanMessages(messages: ChatMessage[]): {
    safe: boolean;
    messages: ChatMessage[];
    violations: Array<SecurityViolation & { messageIndex: number }>;
  } {
    if (!this.enabled || !messages || messages.length === 0) {
      return {
        safe: true,
        messages: messages || [],
        violations: [],
      };
    }

    const allViolations: Array<SecurityViolation & { messageIndex: number }> =
      [];
    const updatedMessages: ChatMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (typeof msg.content === 'string') {
        const scanResult = this.scan(msg.content);
        if (!scanResult.safe) {
          for (const v of scanResult.violations) {
            allViolations.push({ ...v, messageIndex: i });
          }
        }
        updatedMessages.push({
          ...msg,
          content:
            this.action === 'sanitize' ? scanResult.sanitizedText : msg.content,
        });
      } else if (Array.isArray(msg.content)) {
        const updatedParts = msg.content.map((part) => {
          if (part.type === 'text' && typeof part.text === 'string') {
            const scanResult = this.scan(part.text);
            if (!scanResult.safe) {
              for (const v of scanResult.violations) {
                allViolations.push({ ...v, messageIndex: i });
              }
            }
            if (this.action === 'sanitize') {
              return {
                ...part,
                text: scanResult.sanitizedText,
              };
            }
          }
          return part;
        });
        updatedMessages.push({
          ...msg,
          content: updatedParts,
        });
      } else {
        updatedMessages.push(msg);
      }
    }

    return {
      safe: allViolations.length === 0,
      messages: updatedMessages,
      violations: allViolations,
    };
  }
}
