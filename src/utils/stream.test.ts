/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { parseSSE } from './stream.js';

describe('parseSSE', () => {
  it('should parse standard SSE events and data', async () => {
    const rawSSE =
      'event: update\ndata: {"step":1}\n\nevent: finish\ndata: {"step":2}\n\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawSSE));
        controller.close();
      },
    });

    const response = new Response(stream);
    const messages = [];
    for await (const msg of parseSSE(response)) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { event: 'update', data: '{"step":1}' },
      { event: 'finish', data: '{"step":2}' },
    ]);
  });

  it('should skip [DONE] data markers', async () => {
    const rawSSE = 'data: {"foo":"bar"}\n\ndata: [DONE]\n\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawSSE));
        controller.close();
      },
    });

    const response = new Response(stream);
    const messages = [];
    for await (const msg of parseSSE(response)) {
      messages.push(msg);
    }

    expect(messages).toEqual([{ event: undefined, data: '{"foo":"bar"}' }]);
  });

  it('should flush remaining buffer when stream ends without a trailing newline', async () => {
    // Note: No trailing \n after the last data line
    const chunk1 = 'data: first\n\n';
    const chunk2 = 'data: second';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk1));
        controller.enqueue(new TextEncoder().encode(chunk2));
        controller.close();
      },
    });

    const response = new Response(stream);
    const messages = [];
    for await (const msg of parseSSE(response)) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { event: undefined, data: 'first' },
      { event: undefined, data: 'second' },
    ]);
  });

  it('should reset currentEvent on empty line separator', async () => {
    const rawSSE = 'event: custom\ndata: payload1\n\n' + 'data: payload2\n\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawSSE));
        controller.close();
      },
    });

    const response = new Response(stream);
    const messages = [];
    for await (const msg of parseSSE(response)) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { event: 'custom', data: 'payload1' },
      { event: undefined, data: 'payload2' },
    ]);
  });

  it('should throw an error if response.body is not readable', async () => {
    const response = {
      body: null,
    } as unknown as Response;

    await expect(async () => {
      await parseSSE(response).next();
    }).rejects.toThrow('Response body is not readable');
  });
});
