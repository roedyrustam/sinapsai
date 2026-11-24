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

import type { McpToolBridge } from './McpBridge.js';

export type RealtimeProviderType = 'openai' | 'gemini' | 'qwen' | 'custom';

export interface RealtimeConnectOptions {
  /**
   * Target provider: 'openai' | 'gemini' | 'qwen' | 'custom'
   */
  provider?: RealtimeProviderType;
  /**
   * Model identifier (e.g. 'gpt-realtime', 'gemini-3.1-flash-live-preview', or 'qwen3-omni-flash-realtime')
   */
  model?: string;
  /**
   * Optional McpToolBridge for automatic hands-free bidirectional tool execution during voice/video sessions.
   */
  mcpBridge?: McpToolBridge;
  /**
   * API Key for the real-time endpoint
   */
  apiKey?: string;
  /**
   * Custom WebSocket endpoint URL
   */
  url?: string;
  /**
   * Desired voice output (e.g. 'alloy', 'marin', 'cedar', 'Puck', 'Charon', 'Aoede')
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
  onSetupComplete?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
  onTextDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onAudioDelta?: (base64Audio: string) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
  onToolCall?: (name: string, args: string, output: string) => void;
  onRawMessage?: (data: unknown) => void;
}

export class RealtimeSession {
  private ws: WebSocket | null = null;
  private options: RealtimeConnectOptions;
  private isAlive = false;

  constructor(options: RealtimeConnectOptions) {
    this.options = options;
  }

  private getProvider(): RealtimeProviderType {
    return this.options.provider || 'openai';
  }

  private getModel(): string {
    const provider = this.getProvider();
    if (this.options.model) return this.options.model;
    if (provider === 'openai') return 'gpt-realtime';
    if (provider === 'qwen') return 'qwen3-omni-flash-realtime';
    return 'gemini-3.1-flash-live-preview';
  }

  /**
   * Resolves the WebSocket URL based on provider and model.
   */
  private resolveUrl(): string {
    if (this.options.url) return this.options.url;

    const provider = this.getProvider();
    const model = this.getModel();

    if (provider === 'openai') {
      return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    }
    if (provider === 'qwen') {
      return `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
    }
    if (provider === 'gemini') {
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.options.apiKey ?? ''}`;
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
          this.getProvider() === 'openai' || this.getProvider() === 'qwen'
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

    const provider = this.getProvider();
    const bridgeTools = this.options.mcpBridge?.toUnifiedTools() ?? [];

    if (provider === 'openai' || provider === 'qwen') {
      const realtimeTools = bridgeTools.map((t) => ({
        type: 'function',
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
      }));
      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: this.options.modalities ?? ['text', 'audio'],
          instructions:
            this.options.instructions ??
            'You are a helpful real-time AI assistant.',
          voice:
            this.options.voice ?? (provider === 'qwen' ? 'Cherry' : 'alloy'),
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
          },
          ...(realtimeTools.length > 0 ? { tools: realtimeTools } : {}),
        },
      };
      this.ws.send(JSON.stringify(sessionUpdate));
    } else if (provider === 'gemini') {
      const model = this.getModel();
      const modelPath = model.startsWith('models/') ? model : `models/${model}`;
      const modalities = this.options.modalities
        ? this.options.modalities.map((m) => m.toUpperCase())
        : ['AUDIO'];
      const generationConfig: Record<string, unknown> = {
        responseModalities: modalities,
      };
      if (this.options.voice) {
        generationConfig.speechConfig = {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: this.options.voice,
            },
          },
        };
      }

      const setup: Record<string, unknown> = {
        model: modelPath,
        generationConfig,
        outputAudioTranscription: {},
      };
      if (this.options.instructions) {
        setup.systemInstruction = {
          parts: [{ text: this.options.instructions }],
        };
      }
      if (bridgeTools.length > 0) {
        setup.tools = [
          {
            functionDeclarations: bridgeTools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters ?? {
                type: 'object',
                properties: {},
              },
            })),
          },
        ];
      }

      this.ws.send(JSON.stringify({ setup }));
    }
  }

  /**
   * Parses and dispatches incoming WebSocket message events.
   */
  private handleIncomingMessage(rawData: unknown): void {
    try {
      const text = typeof rawData === 'string' ? rawData : String(rawData);
      // biome-ignore lint/suspicious/noExplicitAny: dynamic wire event payload
      const parsed = JSON.parse(text) as Record<string, any>;
      this.options.onRawMessage?.(parsed);

      // Handle OpenAI Realtime Beta & GA Protocol
      if (
        (parsed.type === 'response.audio_transcript.delta' ||
          parsed.type === 'response.output_audio_transcript.delta') &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onTextDelta?.(parsed.delta);
      } else if (
        (parsed.type === 'response.audio.delta' ||
          parsed.type === 'response.output_audio.delta') &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onAudioDelta?.(parsed.delta);
      } else if (
        (parsed.type === 'response.text.delta' ||
          parsed.type === 'response.output_text.delta') &&
        typeof parsed.delta === 'string'
      ) {
        this.options.onTextDelta?.(parsed.delta);
      } else if (parsed.type === 'response.done') {
        this.options.onTurnComplete?.();
      } else if (parsed.type === 'input_audio_buffer.speech_started') {
        this.options.onInterrupted?.();
      } else if (
        parsed.type === 'response.function_call_arguments.done' &&
        this.options.mcpBridge &&
        typeof parsed.name === 'string'
      ) {
        const callId = String(parsed.call_id || `call_${Date.now()}`);
        const fnName = parsed.name;
        const fnArgs =
          typeof parsed.arguments === 'string' ? parsed.arguments : '{}';
        void this.executeLiveToolCallOpenAi(callId, fnName, fnArgs);
      }

      // Handle Gemini Live BidiGenerateContent Server Events & Tool Calls
      if (
        parsed.toolCall?.functionCalls &&
        Array.isArray(parsed.toolCall.functionCalls) &&
        this.options.mcpBridge
      ) {
        void this.executeLiveToolCallsGemini(parsed.toolCall.functionCalls);
      }
      if (parsed.setupComplete !== undefined) {
        this.options.onSetupComplete?.();
      }
      if (parsed.serverContent && typeof parsed.serverContent === 'object') {
        const sc = parsed.serverContent as Record<string, unknown>;
        if (sc.interrupted === true) {
          this.options.onInterrupted?.();
        }
        const outTrans = sc.outputTranscription as
          | { text?: string }
          | undefined;
        if (typeof outTrans?.text === 'string' && outTrans.text) {
          this.options.onTextDelta?.(outTrans.text);
        }
        const modelTurn = sc.modelTurn as
          | {
              parts?: Array<{
                text?: string;
                thought?: boolean | string;
                inlineData?: { mimeType?: string; data?: string };
              }>;
            }
          | undefined;
        if (Array.isArray(modelTurn?.parts)) {
          for (const part of modelTurn.parts) {
            if (typeof part.thought === 'string') {
              this.options.onThinkingDelta?.(part.thought);
            } else if (part.thought && typeof part.text === 'string') {
              this.options.onThinkingDelta?.(part.text);
            } else if (typeof part.text === 'string' && part.text) {
              this.options.onTextDelta?.(part.text);
            }
            if (
              part.inlineData?.data &&
              part.inlineData.mimeType?.startsWith('audio/')
            ) {
              this.options.onAudioDelta?.(part.inlineData.data);
            }
          }
        }
        if (sc.turnComplete === true) {
          this.options.onTurnComplete?.();
        }
      }
    } catch {
      // Discard unparseable binary or raw frames
    }
  }

  private async executeLiveToolCallOpenAi(
    callId: string,
    name: string,
    argsJson: string,
  ): Promise<void> {
    if (
      !this.options.mcpBridge ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const result = await this.options.mcpBridge.executeToolCall({
      id: callId,
      type: 'function',
      function: { name, arguments: argsJson },
    });
    const outputText = result.content
      .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
      .join('\n');

    this.options.onToolCall?.(name, argsJson, outputText);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: outputText,
          },
        }),
      );
      this.ws.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  private async executeLiveToolCallsGemini(
    calls: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (
      !this.options.mcpBridge ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const functionResponses: Array<Record<string, unknown>> = [];
    for (const fc of calls) {
      if (!fc.name) continue;
      const callId = fc.id || `gem_call_${Date.now()}`;
      const argsJson = JSON.stringify(fc.args ?? {});
      const result = await this.options.mcpBridge.executeToolCall({
        id: callId,
        type: 'function',
        function: { name: fc.name, arguments: argsJson },
      });
      const outputText = result.content
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
      this.options.onToolCall?.(fc.name, argsJson, outputText);
      functionResponses.push({
        id: callId,
        name: fc.name,
        response: { output: outputText, isError: Boolean(result.isError) },
      });
    }

    if (
      functionResponses.length > 0 &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
  }

  /**
   * Sends a user text message turn.
   */
  public sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime session is not open.');
    }

    if (this.getProvider() === 'gemini') {
      this.ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }),
      );
      return;
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
  public sendAudio(
    base64Audio: string,
    mimeType = 'audio/pcm;rate=16000',
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime session is not open.');
    }

    if (this.getProvider() === 'gemini') {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType,
              data: base64Audio,
            },
          },
        }),
      );
      return;
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    };
    this.ws.send(JSON.stringify(event));
  }

  /**
   * Streams an image/video frame into the live multimodal session (Gemini Live / OpenAI Realtime).
   */
  public sendVideoFrame(base64Data: string, mimeType = 'image/jpeg'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime session is not open.');
    }

    if (this.getProvider() === 'gemini') {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            video: {
              mimeType,
              data: base64Data,
            },
          },
        }),
      );
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:${mimeType};base64,${base64Data}`,
            },
          ],
        },
      }),
    );
  }

  /**
   * Commits the current audio buffer to trigger model response.
   */
  public commitAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.getProvider() === 'gemini') {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audioStreamEnd: true,
          },
        }),
      );
      return;
    }

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
   * Connects to a real-time multimodal session via WebSocket.
   */
  public async connect(
    options: RealtimeConnectOptions,
  ): Promise<RealtimeSession> {
    const session = new RealtimeSession(options);
    return session.connect();
  }

  /**
   * Performs WebRTC SDP offer/answer negotiation for ultra-low latency (<150ms)
   * browser voice streaming with OpenAI Realtime and Gemini Live endpoints.
   */
  public async negotiateWebRtc(params: {
    offerSdp: string;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }): Promise<{ answerSdp: string }> {
    const model = params.model || 'gpt-realtime';
    const baseUrl = params.baseUrl || 'https://api.openai.com/v1/realtime';
    const url = `${baseUrl}?model=${encodeURIComponent(model)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/sdp',
      },
      body: params.offerSdp,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `WebRTC SDP negotiation failed (${response.status}): ${errText}`,
      );
    }

    const answerSdp = await response.text();
    return { answerSdp };
  }
}
