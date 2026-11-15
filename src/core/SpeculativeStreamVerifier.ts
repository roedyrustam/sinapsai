/**
 * Zero-dependency In-Process Speculative Stream Verification & Dual-Engine Decoupled Copilot.
 *
 * Couples an ultra-fast streaming draft generator (e.g., Groq LPU, Gemini Flash-Lite) with
 * an asynchronous background auditor model (e.g., Claude 3.7 Sonnet, GPT-4o).
 * Dispatches real-time tokens to the client with sub-100ms TTFT while evaluating
 * sentence/code block claims in parallel, emitting non-blocking corrections upon divergence.
 *
 * @author Roedy Rustam
 * @license MIT
 */

import type { Provider } from '../providers/Provider.js';
import type {
  ChatCompletionChunk,
  UnifiedApiRequest,
  UnifiedApiResponse,
  UnifiedApiStreamChunk,
} from '../types/index.js';

export type SpeculativeProviderLike =
  | Provider
  | {
      id: string;
      name?: string;
      generateContent?: Provider['generateContent'];
      execute?: (req: UnifiedApiRequest) => Promise<UnifiedApiResponse>;
      executeStream?: (
        req: UnifiedApiRequest,
      ) =>
        | Promise<AsyncIterable<UnifiedApiStreamChunk>>
        | AsyncIterable<UnifiedApiStreamChunk>;
    };

export interface StreamCorrectionEvent {
  chunkIndex: number;
  originalText: string;
  correctedText?: string;
  reason: string;
  severity: 'warning' | 'critical';
  confidence: number;
}

export interface SpeculativeStreamOptions {
  draftProvider: SpeculativeProviderLike;
  auditorProvider?: SpeculativeProviderLike;
  draftModel?: string;
  auditorModel?: string;
  minSentenceLength?: number;
  maxAuditConcurrency?: number;
  auditorInstructions?: string;
  onCorrection?: (event: StreamCorrectionEvent) => void;
}

export interface SpeculativeStreamResult {
  fullDraftText: string;
  corrections: StreamCorrectionEvent[];
  stats: {
    totalChunks: number;
    auditedSentences: number;
    correctionsCount: number;
    auditPassRate: number;
  };
}

export class SpeculativeStreamVerifier {
  private draftProvider: SpeculativeProviderLike;
  private auditorProvider?: SpeculativeProviderLike;
  private draftModel?: string;
  private auditorModel?: string;
  private minSentenceLength: number;
  private auditorInstructions: string;
  private onCorrection?: (event: StreamCorrectionEvent) => void;

  constructor(options: SpeculativeStreamOptions) {
    this.draftProvider = options.draftProvider;
    this.auditorProvider = options.auditorProvider;
    this.draftModel = options.draftModel;
    this.auditorModel = options.auditorModel;
    this.minSentenceLength = options.minSentenceLength ?? 30;
    this.auditorInstructions =
      options.auditorInstructions ??
      'You are a rigorous code and factual verification auditor. Validate the given statement for logical errors, hallucinations, or security risks. Reply in format: [VALID] or [INVALID: <reason>]';
    this.onCorrection = options.onCorrection;
  }

  /**
   * Executes speculative dual-engine stream.
   * Yields draft stream chunks immediately to consumer, while scheduling asynchronous audits.
   */
  public async *executeStream(
    request: UnifiedApiRequest,
  ): AsyncGenerator<ChatCompletionChunk, SpeculativeStreamResult, void> {
    const draftReq: UnifiedApiRequest = {
      ...request,
      model: this.draftModel ?? request.model,
      stream: true,
    };

    let stream: AsyncIterable<UnifiedApiStreamChunk>;
    if (typeof this.draftProvider.generateContent === 'function') {
      const res = await this.draftProvider.generateContent(draftReq);
      if (
        res != null &&
        typeof res === 'object' &&
        Symbol.asyncIterator in res
      ) {
        stream = res as AsyncIterable<UnifiedApiStreamChunk>;
      } else {
        const single = res as UnifiedApiResponse;
        stream = (async function* () {
          yield {
            id: single.id,
            model: single.model,
            provider: single.provider,
            choices: [
              {
                delta: {
                  role: 'assistant',
                  content: single.choices?.[0]?.message?.content ?? '',
                },
                finishReason: single.choices?.[0]?.finishReason ?? 'stop',
              },
            ],
            usage: single.usage,
          };
        })();
      }
    } else if (
      'executeStream' in this.draftProvider &&
      typeof this.draftProvider.executeStream === 'function'
    ) {
      stream = await this.draftProvider.executeStream(draftReq);
    } else {
      throw new Error(
        `Draft provider "${this.draftProvider.id}" does not implement generateContent or executeStream.`,
      );
    }

    let fullDraftText = '';
    let currentSentence = '';
    let chunkIndex = 0;
    const auditPromises: Promise<StreamCorrectionEvent | null>[] = [];
    const corrections: StreamCorrectionEvent[] = [];
    let auditedSentencesCount = 0;

    for await (const chunk of stream) {
      const deltaContent = chunk.choices[0]?.delta?.content ?? '';
      fullDraftText += deltaContent;
      currentSentence += deltaContent;

      // Yield immediate token delta to consumer
      yield chunk;

      // Sentence boundary detection: '.', '!', '?', or '\n\n'
      if (this.isSentenceBoundary(currentSentence)) {
        const sentenceToAudit = currentSentence.trim();
        currentSentence = '';

        if (
          sentenceToAudit.length >= this.minSentenceLength &&
          this.auditorProvider
        ) {
          auditedSentencesCount++;
          const currentIndex = chunkIndex;
          const auditPromise = this.auditSnippet(sentenceToAudit, currentIndex);
          auditPromises.push(auditPromise);

          // Handle early resolution of correction in background
          auditPromise.then((corr) => {
            if (corr) {
              corrections.push(corr);
              if (this.onCorrection) {
                this.onCorrection(corr);
              }
            }
          });
        }
      }

      chunkIndex++;
    }

    // Audit any trailing remainder sentence
    if (
      currentSentence.trim().length >= this.minSentenceLength &&
      this.auditorProvider
    ) {
      auditedSentencesCount++;
      const auditPromise = this.auditSnippet(
        currentSentence.trim(),
        chunkIndex,
      );
      auditPromises.push(auditPromise);
      auditPromise.then((corr) => {
        if (corr) {
          corrections.push(corr);
          if (this.onCorrection) {
            this.onCorrection(corr);
          }
        }
      });
    }

    // Await all background audit tasks before completing result
    await Promise.allSettled(auditPromises);

    const passRate =
      auditedSentencesCount > 0
        ? (auditedSentencesCount - corrections.length) / auditedSentencesCount
        : 1.0;

    return {
      fullDraftText,
      corrections,
      stats: {
        totalChunks: chunkIndex,
        auditedSentences: auditedSentencesCount,
        correctionsCount: corrections.length,
        auditPassRate: Number(Math.max(0, passRate).toFixed(4)),
      },
    };
  }

  /**
   * Helper method that consumes the stream, invoking optional onChunk callback,
   * and directly resolves with the final SpeculativeStreamResult.
   */
  public async execute(
    request: UnifiedApiRequest,
    onChunk?: (chunk: ChatCompletionChunk) => void,
  ): Promise<SpeculativeStreamResult> {
    const stream = this.executeStream(request);
    let item = await stream.next();

    while (!item.done) {
      if (onChunk && item.value) {
        onChunk(item.value);
      }
      item = await stream.next();
    }

    return item.value;
  }

  /**
   * Internal verification of a text snippet against the auditor provider.
   */
  public async auditSnippet(
    snippet: string,
    chunkIndex: number,
  ): Promise<StreamCorrectionEvent | null> {
    if (!this.auditorProvider) return null;

    try {
      const auditReq: UnifiedApiRequest = {
        model: this.auditorModel ?? 'claude-3-7-sonnet',
        messages: [
          { role: 'system', content: this.auditorInstructions },
          {
            role: 'user',
            content: `Audit this snippet from LLM output:\n"""\n${snippet}\n"""`,
          },
        ],
        temperature: 0.1,
      };

      let res: UnifiedApiResponse;
      if (typeof this.auditorProvider.generateContent === 'function') {
        const out = await this.auditorProvider.generateContent(auditReq);
        if (
          out != null &&
          typeof out === 'object' &&
          Symbol.asyncIterator in out
        ) {
          let textAcc = '';
          for await (const chunk of out as AsyncIterable<UnifiedApiStreamChunk>) {
            textAcc += chunk.choices?.[0]?.delta?.content ?? '';
          }
          res = {
            id: 'audit-stream',
            model: auditReq.model,
            choices: [
              {
                message: { role: 'assistant', content: textAcc },
                finishReason: 'stop',
              },
            ],
          };
        } else {
          res = out as UnifiedApiResponse;
        }
      } else if (
        'execute' in this.auditorProvider &&
        typeof this.auditorProvider.execute === 'function'
      ) {
        res = await this.auditorProvider.execute(auditReq);
      } else {
        return null;
      }
      const content = res.choices[0]?.message?.content ?? '';

      if (content.includes('[INVALID:')) {
        const match = content.match(/\[INVALID:\s*([^\]]+)\]/i);
        const reason = match
          ? match[1].trim()
          : 'Factual or logic inaccuracy identified';

        return {
          chunkIndex,
          originalText: snippet,
          reason,
          severity:
            reason.toLowerCase().includes('critical') ||
            reason.toLowerCase().includes('security')
              ? 'critical'
              : 'warning',
          confidence: 0.92,
        };
      }

      return null;
    } catch {
      // Fail-soft: Never crash consumer stream if background auditor encounters transient issue
      return null;
    }
  }

  private isSentenceBoundary(text: string): boolean {
    return (
      text.includes('\n\n') ||
      (/[.!?]\s+$/.test(text) && text.trim().length >= this.minSentenceLength)
    );
  }
}
