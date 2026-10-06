/**
 * Example 05: Running SinapsAI on Edge Runtimes (Cloudflare Workers, Bun, Deno, Vercel Edge)
 *
 * SinapsAI is 100% compliant with standard Web APIs (fetch, ReadableStream, TextDecoder, AbortController)
 * and requires ZERO Node-only modules (fs, net, http).
 */

import {
  AnthropicProvider,
  InMemoryStorage,
  OpenAiProvider,
  SinapsClient,
} from 'sinapsai';

// In Edge Runtimes like Cloudflare Workers, instantiate InMemoryStorage with autoSweep: false
// or let SinapsAI manage in-process circuit breaker state natively.
const storage = new InMemoryStorage({ autoSweep: false });

export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    const client = new SinapsClient({
      storage,
      strategy: 'failover',
      providers: [
        new OpenAiProvider({
          apiKey: env.OPENAI_API_KEY || 'sk-...',
          defaultModel: 'gpt-4o-mini',
        }),
        new AnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY || 'sk-ant-...',
          defaultModel: 'claude-3-5-haiku-20241022',
          modelMap: {
            'gpt-4o-mini': 'claude-3-5-haiku-20241022',
          },
        }),
      ],
    });

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are running in a Cloudflare Worker.' },
          { role: 'user', content: 'Say hello from the edge!' },
        ],
      });

      return new Response(JSON.stringify(completion), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
