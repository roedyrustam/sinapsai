/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
/**
 * Capabilities supported by a Groq model.
 */
export interface GroqModelCapabilities {
    /** Supports tool / function calling */
    tools: boolean;
    /** Supports JSON mode or json_schema structured output */
    jsonMode: boolean;
    /** Model has reasoning / chain-of-thought capability */
    reasoning: boolean;
    /** Model accepts vision (image) inputs */
    vision: boolean;
    /** Model is an audio transcription / translation model */
    audio: boolean;
}
/**
 * Per-model metadata entry.
 */
export interface GroqModelMeta {
    /** Model ID used in API requests */
    id: string;
    /** Human-readable display name */
    name: string;
    /** Maximum context window size in tokens */
    contextWindow: number;
    /** Maximum tokens the model can generate in a single completion */
    maxCompletionTokens: number;
    /** Model capabilities */
    capabilities: GroqModelCapabilities;
    /** Pricing per 1 million input tokens (USD). 0 means free tier. */
    inputPricePer1M: number;
    /** Pricing per 1 million output tokens (USD). 0 means free tier. */
    outputPricePer1M: number;
}
/**
 * Comprehensive model catalog aligned with https://console.groq.com/docs/models
 *
 * All context windows, max completion tokens, capabilities, and pricing are
 * sourced from the official Groq documentation (November 2026).
 */
export declare const GROQ_MODELS: Record<string, GroqModelMeta>;
/**
 * Set of model IDs that support `reasoning_format` and `reasoning_effort`.
 * When tools or JSON mode are active on these models, `reasoning_format`
 * must be `'parsed'` or `'hidden'` — never `'raw'`.
 */
export declare const GROQ_REASONING_MODELS: Set<string>;
/**
 * Options for the Groq audio transcription / translation API.
 */
export interface GroqAudioOptions {
    /** Model to use. Defaults to `whisper-large-v3-turbo`. */
    model?: string;
    /** Language of the input audio in ISO-639-1 format (e.g. `'en'`). */
    language?: string;
    /** Optional text prompt to guide the model's style or continue a previous segment. */
    prompt?: string;
    /** Sampling temperature between 0 and 1. Defaults to 0. */
    temperature?: number;
    /** Output transcript format. */
    responseFormat?: 'json' | 'text' | 'verbose_json' | 'srt' | 'vtt';
}
/**
 * Response from the Groq audio transcription / translation API.
 */
export interface GroqAudioResponse {
    /** The transcribed or translated text. */
    text: string;
    /** Language detected or specified. */
    language?: string;
    /** Duration of the audio in seconds. */
    duration?: number;
    /** Word-level or segment-level timing data (verbose_json only). */
    segments?: any[];
}
/**
 * A model entry returned by `GET /v1/models`.
 */
export interface GroqModelListEntry {
    id: string;
    object: string;
    created: number;
    owned_by: string;
}
export declare class GroqProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: ProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    get fallbackModels(): string[] | undefined;
    get defaultModel(): string | undefined;
    /**
     * Get the base URL for the Groq API.
     */
    private get baseUrl();
    resolveModel(model: string): string;
    /**
     * Look up static model metadata. Returns `undefined` for unknown models.
     */
    getModelMeta(modelId: string): GroqModelMeta | undefined;
    /**
     * Check whether a model ID is a known reasoning model.
     */
    isReasoningModel(modelId: string): boolean;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    /**
     * Fetch the list of currently available models from the Groq API.
     *
     * Calls `GET <baseUrl>/models` (OpenAI-compatible endpoint).
     */
    listModels(signal?: AbortSignal): Promise<GroqModelListEntry[]>;
    /**
     * Transcribe audio using Groq's Whisper endpoint.
     *
     * Calls `POST <baseUrl>/audio/transcriptions` with `multipart/form-data`.
     *
     * @param file  Audio file as `Blob`, `Buffer`, or `Uint8Array`.
     * @param options  Transcription options.
     */
    transcribeAudio(file: Blob | Uint8Array, options?: GroqAudioOptions): Promise<GroqAudioResponse>;
    /**
     * Translate audio to English using Groq's Whisper endpoint.
     *
     * Calls `POST <baseUrl>/audio/translations` with `multipart/form-data`.
     *
     * @param file  Audio file as `Blob`, `Buffer`, or `Uint8Array`.
     * @param options  Translation options.
     */
    translateAudio(file: Blob | Uint8Array, options?: GroqAudioOptions): Promise<GroqAudioResponse>;
    /**
     * Internal helper for audio transcription / translation requests.
     */
    private audioRequest;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
}
//# sourceMappingURL=GroqProvider.d.ts.map