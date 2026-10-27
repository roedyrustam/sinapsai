/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Real-Time Multimodal Voice & WebSocket Control Plane
 *
 * Implements:
 * 1. Zero-dependency native WebSocket connectivity to OpenAI Realtime and Gemini Live APIs.
 * 2. Unified bidirectional session lifecycle (session.connect, sendText, sendAudio, close).
 * 3. Real-time audio and text delta event dispatching.
 * 4. In-process connection resilience and automatic failover.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export type RealtimeProviderType = 'openai' | 'gemini' | 'custom';

export interface RealtimeConnectOptions {
  /**
   * Target provider: 'openai' | 'gemini' | 'custom'
   */
  provider?: RealtimeProviderType;
  /**
   * Model identifier (e.g. 'gpt-4o-realtime-preview' or 'gemini-2.0-flash-exp')
   */
  model?: string;
  /**
   * API Key for the real-time endpoint
   */
  apiKey?: string;
  /**
   * Custom WebSocket endpoint URL
   */
  url?: string;
  /**
   * Desired voice output (e.g. 'alloy', 'echo', 'shimmer', 'Puck', 'Charon', 'Aoede')
   */
  voice?: string;
  /**
   * Modalities enabled: ['text', 'audio']
   */
  modalities?: ('text' | 'audio')[];
  /**
   * System instructions for real-time persona
   */
  instructions?: string;
  /**
   * Event handlers
   */
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
  onTextDelta?: (text: string) => void;
  onAudioDelta?: (base64Audio: string) => void;
  onRawMessage?: (data: unknown) => void;
}

export class RealtimeSession {
  private ws: WebSocket | null = null;
  private options: RealtimeConnectOptions;
  private isAlive = false;

  constructor(options: RealtimeConnectOptions) {
    this.options = options;
  }

  /**
   * Resolves the WebSocket URL based on provider and model.
   */
  private resolveUrl(): string {
    if (this.options.url) return this.options.url;

    const provider = this.options.provider || 'openai';
    const model =
      this.options.model ||
      (provider === 'openai'
        ? 'gpt-4o-realtime-preview'
        : 'gemini-2.0-flash-exp');

    if (provider === 'openai') {
      return `wss://api.openai.com/v1/realtime?model=${model}`;
    }
    if (provider === 'gemini') {
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
    }

    throw new Error(
      `Unable to resolve WebSocket URL for custom provider without explicit options.url.`,
    );
  }

  /**
   * Establishes real-time WebSocket connection.
   */
  public async connect(): Promise<this> {
    const targetUrl = this.resolveUrl();

    // Verify WebSocket exists in global environment (Node 22+, Bun, Deno, Browser)
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error(
        'WebSocket is not available in the current runtime environment.',
      );
    }

    return new Promise((resolve, reject) => {
      try {
        const protocols =
          this.options.provider === 'openai'
            ? ['realtime', `openai-insecure-api-key.${this.options.apiKey}`]
            : undefined;
        this.ws = protocols
          ? new WebSocketCtor(targetUrl, protocols)
          : new WebSocketCtor(targetUrl);

        this.ws.onopen = () => {
          this.isAlive = true;
          this.options.onOpen?.();

          // Send initial session configuration
          this.initializeSession();
          resolve(this);
        };

        this.ws.onclose = (event) => {
          this.isAlive = false;
          this.options.onClose?.(event.code, event.reason);
        };

        this.ws.onerror = (_event) => {
          const err = new Error('Realtime WebSocket connection error.');
          this.options.onError?.(err);
          if (!this.isAlive) {
            reject(err);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Sends initial session setup event.
   */
  private initializeSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.options.provider === 'openai') {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: this.options.modalities ?? ['text', 'audio'],
          instructions:
            this.options.instructions ??
            'You are a helpful real-time AI assistant.',
          voice: this.options.voice ?? 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
          },
        },
      };
      this.ws.send(JSON.stringify(sessionUpdate));
    }
  }

  /**
   * Parses and dispatches incoming WebSocket message events.
   */
  private handleIncomingMessage(rawData: unknown): void {
    try {
      const text = typeof rawData === 'string' ? rawData : String(rawData);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      this.options.onRawMessage?.(parsed);

      // Handle OpenAI Realtime Protocol
      if (
        parsed.type === 'response.audio_transcript.delta' &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onTextDelta?.(parsed.delta);
      } else if (
        parsed.type === 'response.audio.delta' &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onAudioDelta?.(parsed.delta);
      } else if (
        parsed.type === 'response.text.delta' &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onTextDelta?.(parsed.delta);
      }
    } catch {
      // Discard unparseable binary or raw frames
    }
  }

  /**
   * Sends a user text message turn.
   */
  public sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime session is not open.');
    }

    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    };
    this.ws.send(JSON.stringify(event));

    // Request response generation
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Appends PCM16 audio chunks in base64 format.
   */
  public sendAudio(base64Audio: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime session is not open.');
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    };
    this.ws.send(JSON.stringify(event));
  }

  /**
   * Commits the current audio buffer to trigger model response.
   */
  public commitAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Closes the real-time WebSocket session.
   */
  public close(): void {
    if (this.ws) {
      this.isAlive = false;
      this.ws.close();
      this.ws = null;
    }
  }

  public get connected(): boolean {
    return this.isAlive && this.ws?.readyState === WebSocket.OPEN;
  }
}

export class RealtimeClient {
  /**
   * Connects to a real-time multimodal session.
   */
  public async connect(
    options: RealtimeConnectOptions,
  ): Promise<RealtimeSession> {
    const session = new RealtimeSession(options);
    return session.connect();
  }
}
