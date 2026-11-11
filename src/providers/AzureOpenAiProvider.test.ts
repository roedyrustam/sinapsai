import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import { AzureOpenAiProvider } from './AzureOpenAiProvider.js';

describe('AzureOpenAiProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates missing resourceName and credentials', async () => {
    const providerWithoutResource = new AzureOpenAiProvider({
      apiKey: 'test-key',
    });

    await expect(
      providerWithoutResource.generateContent({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/resourceName \(or baseUrl\) must be configured/);

    const providerWithoutKey = new AzureOpenAiProvider({
      resourceName: 'my-corp',
    });

    await expect(
      providerWithoutKey.generateContent({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/apiKey or bearerToken must be provided/);
  });

  it('correctly sets api-key and Entra ID Bearer token headers', () => {
    const apiKeyProvider = new AzureOpenAiProvider({
      resourceName: 'my-corp',
      apiKey: 'secret-azure-api-key',
    });

    // biome-ignore lint/suspicious/noExplicitAny: private method test
    const headersKey = (apiKeyProvider as any).getAuthHeaders();
    expect(headersKey['api-key']).toBe('secret-azure-api-key');
    expect(headersKey['Content-Type']).toBe('application/json');

    const bearerProvider = new AzureOpenAiProvider({
      resourceName: 'my-corp',
      bearerToken: 'azure-entra-id-token',
    });

    // biome-ignore lint/suspicious/noExplicitAny: private method test
    const headersBearer = (bearerProvider as any).getAuthHeaders();
    expect(headersBearer.Authorization).toBe('Bearer azure-entra-id-token');
  });

  it('formats request payload for Azure OpenAI chat completions', () => {
    const provider = new AzureOpenAiProvider({
      resourceName: 'my-corp',
      apiKey: 'key',
      deploymentName: 'my-gpt4o-deployment',
      apiVersion: '2024-10-21',
    });

    const req: UnifiedApiRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User question' },
      ],
      temperature: 0.5,
      maxTokens: 1000,
      tools: [
        {
          type: 'function',
          function: {
            name: 'calc',
            parameters: { type: 'object' },
          },
        },
      ],
    };

    const { deployment, payload } = provider.formatRequest(req);
    expect(deployment).toBe('my-gpt4o-deployment');
    expect(payload.messages).toHaveLength(2);
    expect(payload.temperature).toBe(0.5);
    expect(payload.max_tokens).toBe(1000);
    expect(payload.tools).toHaveLength(1);
  });

  it('formats Azure OpenAI response with usage, cached tokens, and rate limits', () => {
    const provider = new AzureOpenAiProvider({
      resourceName: 'my-corp',
      apiKey: 'key',
    });

    const azureResponse = {
      id: 'chatcmpl-azure-123',
      model: 'gpt-4o',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Response from Azure',
            reasoning_content: 'Step 1: Analyzed.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
        prompt_tokens_details: {
          cached_tokens: 40,
        },
      },
    };

    const formatted = provider.formatResponse(azureResponse, 'my-gpt4o');
    expect(formatted.id).toBe('chatcmpl-azure-123');
    expect(formatted.choices[0].message.content).toBe('Response from Azure');
    expect(formatted.choices[0].message.reasoning_content).toBe(
      'Step 1: Analyzed.',
    );
    expect(formatted.usage?.cachedPromptTokens).toBe(40);
  });

  it('executes generateContent and targets expected Azure endpoint URL', async () => {
    const provider = new AzureOpenAiProvider({
      resourceName: 'contoso-ai',
      deploymentName: 'gpt-4o-prod',
      apiVersion: '2024-10-21',
      apiKey: 'secret-azure-key',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'x-ratelimit-remaining-requests': '100',
      }),
      json: async () => ({
        id: 'chatcmpl-123',
        choices: [
          {
            message: { role: 'assistant', content: 'Azure response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await provider.generateContent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    });

    expect('choices' in response).toBe(true);
    if ('choices' in response) {
      expect(response.choices[0].message.content).toBe('Azure response');
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(
      'https://contoso-ai.openai.azure.com/openai/deployments/gpt-4o-prod/chat/completions?api-version=2024-10-21',
    );
    expect(calledInit.headers['api-key']).toBe('secret-azure-key');
  });

  it('executes generateEmbedding with proper deployment endpoint', async () => {
    const provider = new AzureOpenAiProvider({
      resourceName: 'contoso-ai',
      apiKey: 'secret-azure-key',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await provider.generateEmbedding({
      model: 'text-embedding-3-small',
      input: 'azure search',
    });

    expect(response.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain(
      '/openai/deployments/text-embedding-3-small/embeddings?api-version=2024-10-21',
    );
  });
});
