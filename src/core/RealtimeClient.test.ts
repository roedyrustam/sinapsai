/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Tests for RealtimeClient and RealtimeSession
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, RealtimeSession } from './RealtimeClient.js';
import { SinapsClient } from './SinapsClient.js';

class MockWebSocket {
  public static OPEN = 1;
  public static CLOSED = 3;
  public readyState = 0;
  public url: string;
  public protocols?: string | string[];
  public sentMessages: string[] = [];
  public onopen?: () => void;
  public onclose?: (event: { code: number; reason: string }) => void;
  public onerror?: (event: unknown) => void;
  public onmessage?: (event: { data: unknown }) => void;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 5);
  }

  public send(data: string) {
    this.sentMessages.push(data);
  }

  public close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'Normal closure' });
  }

  public simulateMessage(data: unknown) {
    this.onmessage?.({ data });
  }
}

describe('RealtimeClient & RealtimeSession', () => {
  // biome-ignore lint/suspicious/noExplicitAny: mock global WebSocket
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // biome-ignore lint/suspicious/noExplicitAny: mock global WebSocket
    globalThis.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('connects to OpenAI Realtime and sends initial session config', async () => {
    const client = new RealtimeClient();
    const onOpen = vi.fn();
    const onTextDelta = vi.fn();

    const session = await client.connect({
      provider: 'openai',
      model: 'gpt-4o-realtime-preview',
      apiKey: 'sk-test-realtime',
      instructions: 'Be an ultra-concise assistant.',
      onOpen,
      onTextDelta,
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(session.connected).toBe(true);

    // Verify session.update was sent
    // biome-ignore lint/suspicious/noExplicitAny: mock inspection
    const ws = (session as any).ws as MockWebSocket;
    expect(ws.sentMessages.length).toBeGreaterThan(0);
    const initEvent = JSON.parse(ws.sentMessages[0]);
    expect(initEvent.type).toBe('session.update');
    expect(initEvent.session.instructions).toBe(
      'Be an ultra-concise assistant.',
    );

    // Simulate incoming delta
    ws.simulateMessage(
      JSON.stringify({
        type: 'response.text.delta',
        delta: 'Hello real-time!',
      }),
    );
    expect(onTextDelta).toHaveBeenCalledWith('Hello real-time!');

    session.close();
    expect(session.connected).toBe(false);
  });

  it('sends text and audio turns properly', async () => {
    const session = new RealtimeSession({
      provider: 'openai',
      apiKey: 'sk-test',
    });
    await session.connect();

    // biome-ignore lint/suspicious/noExplicitAny: mock inspection
    const ws = (session as any).ws as MockWebSocket;
    ws.sentMessages = []; // clear init

    session.sendText('Summarize audio stream');
    expect(ws.sentMessages.length).toBe(2);
    const textEvent = JSON.parse(ws.sentMessages[0]);
    expect(textEvent.type).toBe('conversation.item.create');
    expect(textEvent.item.content[0].text).toBe('Summarize audio stream');
    expect(JSON.parse(ws.sentMessages[1]).type).toBe('response.create');

    session.sendAudio('AQIDBA==');
    const audioEvent = JSON.parse(ws.sentMessages[2]);
    expect(audioEvent.type).toBe('input_audio_buffer.append');
    expect(audioEvent.audio).toBe('AQIDBA==');

    session.commitAudio();
    expect(JSON.parse(ws.sentMessages[3]).type).toBe(
      'input_audio_buffer.commit',
    );
    expect(JSON.parse(ws.sentMessages[4]).type).toBe('response.create');

    session.close();
  });

  it('dispatches audio delta and audio transcript delta events', async () => {
    const onAudioDelta = vi.fn();
    const onTextDelta = vi.fn();

    const session = new RealtimeSession({
      provider: 'openai',
      apiKey: 'key',
      onAudioDelta,
      onTextDelta,
    });
    await session.connect();

    // biome-ignore lint/suspicious/noExplicitAny: mock inspection
    const ws = (session as any).ws as MockWebSocket;

    ws.simulateMessage(
      JSON.stringify({
        type: 'response.audio.delta',
        delta: 'SGVsbG8gYXVkaW8=',
      }),
    );
    expect(onAudioDelta).toHaveBeenCalledWith('SGVsbG8gYXVkaW8=');

    ws.simulateMessage(
      JSON.stringify({
        type: 'response.audio_transcript.delta',
        delta: 'Transcribed text.',
      }),
    );
    expect(onTextDelta).toHaveBeenCalledWith('Transcribed text.');

    session.close();
  });

  it('resolves correct WebSocket URL for Gemini Live', async () => {
    const session = new RealtimeSession({
      provider: 'gemini',
      apiKey: 'gemini-key-123',
    });
    await session.connect();

    // biome-ignore lint/suspicious/noExplicitAny: mock inspection
    const ws = (session as any).ws as MockWebSocket;
    expect(ws.url).toContain('generativelanguage.googleapis.com');
    expect(ws.url).toContain('key=gemini-key-123');

    session.close();
  });

  it('integrates with SinapsClient directly via client.realtime', async () => {
    const client = new SinapsClient({
      providers: [
        {
          id: 'test',
          name: 'test',
          models: ['m'],
          apiKey: 'k',
        },
      ],
    });

    expect(client.realtime).toBeInstanceOf(RealtimeClient);
  });
});
