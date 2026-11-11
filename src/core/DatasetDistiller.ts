/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * In-Process Synthetic Dataset Distiller & DPO Pair Curation
 *
 * Automatically captures, curates, and sanitizes production trajectories,
 * Actor-Critic feedback cycles, and high-scoring completions into standard JSONL
 * datasets for SFT and Direct Preference Optimization (DPO) fine-tuning.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage } from '../types/index.js';
import { extractPromptText } from '../utils/similarity.js';
import type { PIIGuardrails } from './PIIGuardrails.js';
import type { StateStorage } from './StateStorage.js';

export interface DpoRecord {
  id: string;
  prompt: string;
  chosen: string;
  rejected: string;
  scoreChosen?: number;
  scoreRejected?: number;
  critique?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SftRecord {
  id: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  score?: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface DatasetDistillerOptions {
  /**
   * Optional persistent storage (InMemoryStorage, RedisStorage, D1Storage, CloudflareKVStorage)
   */
  storage?: StateStorage;
  /**
   * Maximum records retained in the active in-memory buffer (default: 1000)
   */
  maxRecords?: number;
  /**
   * Whether to automatically sanitize personally identifiable information (PII)
   * before storing records into the dataset (default: true).
   */
  autoSanitizePii?: boolean;
  /**
   * Optional PIIGuardrails instance used for automatic PII redaction.
   */
  piiGuardrails?: PIIGuardrails;
  /**
   * Minimum quality score required to accept an SFT record (0.0 to 1.0, default: 0.80)
   */
  minScoreForSft?: number;
  /**
   * Minimum quality score required for chosen output in a DPO record (0.0 to 1.0, default: 0.70)
   */
  minScoreForDpo?: number;
}

export interface DistillerStats {
  dpoCount: number;
  sftCount: number;
  totalEstimatedTokens: number;
}

export class DatasetDistiller {
  private storage?: StateStorage;
  private maxRecords: number;
  private autoSanitizePii: boolean;
  private piiGuardrails?: PIIGuardrails;
  private minScoreForSft: number;
  private minScoreForDpo: number;

  private dpoRecords: DpoRecord[] = [];
  private sftRecords: SftRecord[] = [];

  constructor(options?: DatasetDistillerOptions) {
    this.storage = options?.storage;
    this.maxRecords = options?.maxRecords ?? 1000;
    this.autoSanitizePii = options?.autoSanitizePii ?? true;
    this.piiGuardrails = options?.piiGuardrails;
    this.minScoreForSft = options?.minScoreForSft ?? 0.8;
    this.minScoreForDpo = options?.minScoreForDpo ?? 0.7;
  }

  private sanitizeText(text: string): string {
    if (!this.autoSanitizePii || !this.piiGuardrails || !text) {
      return text;
    }
    return this.piiGuardrails.redact(text);
  }

  private sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
    if (!this.autoSanitizePii || !this.piiGuardrails || !messages) {
      return messages;
    }
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { ...m, content: this.sanitizeText(m.content) };
      }
      return m;
    });
  }

  /**
   * Records a Direct Preference Optimization (DPO) preference pair.
   * Format: { prompt, chosen, rejected }
   */
  async recordDpo(entry: {
    prompt: string | ChatMessage[];
    chosen: string;
    rejected: string;
    scoreChosen?: number;
    scoreRejected?: number;
    critique?: string;
    metadata?: Record<string, unknown>;
    id?: string;
    timestamp?: number;
  }): Promise<DpoRecord> {
    const rawPromptText =
      typeof entry.prompt === 'string'
        ? entry.prompt
        : extractPromptText(entry.prompt);

    const prompt = this.sanitizeText(rawPromptText);
    const chosen = this.sanitizeText(entry.chosen);
    const rejected = this.sanitizeText(entry.rejected);

    const record: DpoRecord = {
      id:
        entry.id ||
        `dpo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      prompt,
      chosen,
      rejected,
      scoreChosen: entry.scoreChosen,
      scoreRejected: entry.scoreRejected,
      critique: entry.critique ? this.sanitizeText(entry.critique) : undefined,
      timestamp: entry.timestamp || Date.now(),
      metadata: entry.metadata,
    };

    this.dpoRecords.push(record);
    if (this.dpoRecords.length > this.maxRecords) {
      this.dpoRecords.shift();
    }

    if (this.storage) {
      await this.storage.set(
        `distiller:dpo:${record.id}`,
        JSON.stringify(record),
        86400 * 30, // 30 days retention
      );
    }

    return record;
  }

  /**
   * Records a Supervised Fine-Tuning (SFT) trajectory.
   * Format: { messages }
   */
  async recordSft(entry: {
    messages: ChatMessage[];
    systemPrompt?: string;
    score?: number;
    metadata?: Record<string, unknown>;
    id?: string;
    timestamp?: number;
  }): Promise<SftRecord> {
    const sanitizedMessages = this.sanitizeMessages(entry.messages);
    const sanitizedSystem = entry.systemPrompt
      ? this.sanitizeText(entry.systemPrompt)
      : undefined;

    const record: SftRecord = {
      id:
        entry.id ||
        `sft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      messages: sanitizedMessages,
      systemPrompt: sanitizedSystem,
      score: entry.score,
      timestamp: entry.timestamp || Date.now(),
      metadata: entry.metadata,
    };

    this.sftRecords.push(record);
    if (this.sftRecords.length > this.maxRecords) {
      this.sftRecords.shift();
    }

    if (this.storage) {
      await this.storage.set(
        `distiller:sft:${record.id}`,
        JSON.stringify(record),
        86400 * 30, // 30 days retention
      );
    }

    return record;
  }

  /**
   * Exports all recorded DPO pairs in standard HuggingFace / TRL / Unsloth JSONL format.
   * Each line: {"prompt": "...", "chosen": "...", "rejected": "..."}
   */
  exportDpoJsonl(options?: { minScore?: number; limit?: number }): string {
    const minScore = options?.minScore ?? this.minScoreForDpo;
    let records = this.dpoRecords;

    if (minScore !== undefined) {
      records = records.filter(
        (r) => r.scoreChosen === undefined || r.scoreChosen >= minScore,
      );
    }

    if (options?.limit && options.limit > 0) {
      records = records.slice(-options.limit);
    }

    return records
      .map((r) =>
        JSON.stringify({
          prompt: r.prompt,
          chosen: r.chosen,
          rejected: r.rejected,
        }),
      )
      .join('\n');
  }

  /**
   * Exports all recorded SFT conversations in standard OpenAI / ShareGPT / Axolotl JSONL format.
   * Each line: {"messages": [...]}
   */
  exportSftJsonl(options?: { minScore?: number; limit?: number }): string {
    const minScore = options?.minScore ?? this.minScoreForSft;
    let records = this.sftRecords;

    if (minScore !== undefined) {
      records = records.filter(
        (r) => r.score === undefined || r.score >= minScore,
      );
    }

    if (options?.limit && options.limit > 0) {
      records = records.slice(-options.limit);
    }

    return records
      .map((r) =>
        JSON.stringify({
          messages: r.messages,
        }),
      )
      .join('\n');
  }

  /**
   * Returns all active DPO records
   */
  getDpoRecords(): DpoRecord[] {
    return [...this.dpoRecords];
  }

  /**
   * Returns all active SFT records
   */
  getSftRecords(): SftRecord[] {
    return [...this.sftRecords];
  }

  /**
   * Returns distillation telemetry and estimated token volume
   */
  getStats(): DistillerStats {
    let charCount = 0;
    for (const r of this.dpoRecords) {
      charCount += r.prompt.length + r.chosen.length + r.rejected.length;
    }
    for (const r of this.sftRecords) {
      for (const m of r.messages) {
        if (typeof m.content === 'string') {
          charCount += m.content.length;
        }
      }
    }

    return {
      dpoCount: this.dpoRecords.length,
      sftCount: this.sftRecords.length,
      totalEstimatedTokens: Math.round(charCount / 4),
    };
  }

  /**
   * Clears all in-memory records
   */
  async clear(): Promise<void> {
    this.dpoRecords = [];
    this.sftRecords = [];
  }
}
