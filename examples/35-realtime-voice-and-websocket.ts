/**
 * Example 35: Realtime Multimodal Voice & WebSocket Client
 *
 * Demonstrates:
 * 1. Zero-dependency native WebSocket connectivity to OpenAI Realtime and Gemini Multimodal Live.
 * 2. Bidirectional full-duplex session management (sendText, sendAudio, commitAudio).
 * 3. Text delta and raw PCM16 audio delta streaming.
 * 4. Resilient session lifecycle and error handling.
 */

import { OpenAiProvider, SinapsClient } from '../src/index.js';

async function main() {
  console.log(
    '=== 1. Realtime Multimodal Voice & WebSocket Control Plane ===\n',
  );

  const client = new SinapsClient({
    providers: [
      new OpenAiProvider({
        apiKey: process.env.OPENAI_API_KEY || 'demo-openai-key',
      }),
    ],
  });

  console.log('Connecting to Realtime Session (OpenAI / Gemini Live)...');

  // Check if WebSocket is available in environment (Node.js 22+, Bun, Deno, Browser)
  if (typeof globalThis.WebSocket === 'undefined') {
    console.log(
      '⚠️ globalThis.WebSocket is not defined in this Node.js version (< v22).',
    );
    console.log(
      'Use Node.js 22+, Bun, Deno, or provide a WebSocket polyfill for real-time streaming.\n',
    );
    return;
  }

  try {
    const session = await client.realtime.connect({
      provider: 'openai',
      model: 'gpt-4o-realtime-preview',
      apiKey: process.env.OPENAI_API_KEY || 'demo-key',
      instructions:
        'You are a high-speed AI voice assistant for SinapsAI. Respond concisely.',
      voice: 'alloy',
      modalities: ['text', 'audio'],
      onOpen: () => {
        console.log('✅ Realtime WebSocket session established.');
      },
      onTextDelta: (delta: string) => {
        process.stdout.write(delta);
      },
      onAudioDelta: (base64Pcm: string) => {
        // In real apps, pipe this chunk directly to speaker output or AudioContext
        console.log(`[Audio Chunk received: ${base64Pcm.length} bytes]`);
      },
      onClose: (code: number, reason: string) => {
        console.log(`Session closed: [${code}] ${reason}`);
      },
      onError: (err: Error) => {
        console.error('Realtime error:', err.message);
      },
    });

    console.log(`Session Active: ${session.connected}`);

    // Sending a conversational text prompt
    console.log('\nSending user text turn: "What is SinapsAI?"');
    session.sendText('What is SinapsAI?');

    // Simulate sending an audio buffer slice
    console.log('Sending simulated PCM16 audio chunk...');
    session.sendAudio('//uQxAAAAAA...');
    session.commitAudio();

    // In a long-running app, keep session alive. Here, cleanly close.
    setTimeout(() => {
      console.log('\nClosing session cleanly...');
      session.close();
      console.log('Session closed successfully.');
    }, 1000);
  } catch (err) {
    console.log(
      'Expected mock network error when no live endpoint/key is provided:',
      (err as Error).message,
    );
  }
}

main().catch(console.error);
