/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface SSEMessage {
  event?: string;
  data: string;
}

export async function* parseSSE(
  response: Response,
): AsyncGenerator<SSEMessage, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;

  const processLine = (line: string): SSEMessage | null => {
    if (!line.trim()) {
      currentEvent = undefined;
      return null;
    }
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      return null;
    }
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data === '[DONE]') return null;
      return { event: currentEvent, data };
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode(); // flush remaining bytes
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const msg = processLine(line);
        if (msg) yield msg;
      }
    }

    // Flush sisa buffer terakhir jika tidak diakhiri newline
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        const msg = processLine(line);
        if (msg) yield msg;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
