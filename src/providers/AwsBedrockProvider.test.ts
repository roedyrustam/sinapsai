import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedApiRequest } from '../types/index.js';
import {
  AwsBedrockProvider,
  BEDROCK_MODELS,
  sha256Hex,
  signAwsRequest,
} from './AwsBedrockProvider.js';

describe('AWS Bedrock SigV4 Signer', () => {
  it('computes sha256 hex correctly', async () => {
    const hash = await sha256Hex('hello world');
    expect(hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('derives signing key and produces standard authorization header', async () => {
    const date = new Date('2026-11-11T12:00:00Z');
    const signed = await signAwsRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet/converse',
      body: JSON.stringify({ prompt: 'test' }),
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'bedrock',
      date,
    });

    expect(signed['content-type']).toBe('application/json');
    expect(signed.host).toBe('bedrock-runtime.us-east-1.amazonaws.com');
    expect(signed['x-amz-date']).toBe('20261111T120000Z');
    expect(signed.authorization).toContain('AWS4-HMAC-SHA256');
    expect(signed.authorization).toContain(
      'Credential=AKIAIOSFODNN7EXAMPLE/20261111/us-east-1/bedrock/aws4_request',
    );
    expect(signed.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-date',
    );
    expect(signed.authorization).toContain('Signature=');
  });

  it('includes security token header when sessionToken is provided', async () => {
    const date = new Date('2026-11-11T12:00:00Z');
    const signed = await signAwsRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-west-2.amazonaws.com/model/amazon.nova-pro/converse',
      body: '{}',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      sessionToken: 'SESSIONTOKEN123',
      region: 'us-west-2',
      service: 'bedrock',
      date,
    });

    expect(signed['x-amz-security-token']).toBe('SESSIONTOKEN123');
    expect(signed.authorization).toContain('x-amz-security-token');
  });
});

describe('AwsBedrockProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates missing credentials', async () => {
    const provider = new AwsBedrockProvider({
      region: 'us-east-1',
      accessKeyId: '',
      secretAccessKey: '',
    });

    const req: UnifiedApiRequest = {
      model: BEDROCK_MODELS.CLAUDE_3_5_SONNET,
      messages: [{ role: 'user', content: 'hello' }],
    };

    await expect(provider.generateContent(req)).rejects.toThrow(
      /AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be provided/,
    );
  });

  it('formats request payload for Bedrock Converse API with tools and system messages', () => {
    const provider = new AwsBedrockProvider({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      region: 'us-east-1',
    });

    const req: UnifiedApiRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'system', content: 'You are an AWS security expert.' },
        { role: 'user', content: 'Check bucket configuration.' },
      ],
      maxTokens: 2048,
      temperature: 0.2,
      tools: [
        {
          type: 'function',
          function: {
            name: 'check_s3_bucket',
            description: 'Check S3 bucket policy',
            parameters: {
              type: 'object',
              properties: { bucket: { type: 'string' } },
            },
          },
        },
      ],
    };

    const { modelId, payload } = provider.formatRequest(req);
    expect(modelId).toBe('claude-3-5-sonnet');
    expect(payload.system).toEqual([
      { text: 'You are an AWS security expert.' },
    ]);
    expect(payload.messages).toEqual([
      { role: 'user', content: [{ text: 'Check bucket configuration.' }] },
    ]);
    expect(payload.inferenceConfig).toEqual({
      maxTokens: 2048,
      temperature: 0.2,
    });
    // biome-ignore lint/suspicious/noExplicitAny: Bedrock toolConfig test
    const toolConfig = payload.toolConfig as any;
    expect(toolConfig.tools[0].toolSpec.name).toBe('check_s3_bucket');
  });

  it('formats Bedrock Converse response into UnifiedApiResponse', () => {
    const provider = new AwsBedrockProvider({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      region: 'us-east-1',
    });

    const bedrockResponse = {
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'S3 bucket is secure.' },
            {
              toolUse: {
                toolUseId: 'tool_s3_1',
                name: 'check_s3_bucket',
                input: { bucket: 'prod-data' },
              },
            },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      },
    };

    const formatted = provider.formatResponse(
      bedrockResponse,
      'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    );

    expect(formatted.model).toBe(
      'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    );
    expect(formatted.choices[0].message.content).toBe('S3 bucket is secure.');
    expect(formatted.choices[0].finishReason).toBe('tool_calls');
    expect(formatted.choices[0].message.tool_calls).toHaveLength(1);
    expect(formatted.choices[0].message.tool_calls?.[0].id).toBe('tool_s3_1');
    expect(formatted.choices[0].message.tool_calls?.[0].function.name).toBe(
      'check_s3_bucket',
    );
    expect(formatted.usage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    });
  });

  it('performs end-to-end generateContent call with mocked fetch', async () => {
    const provider = new AwsBedrockProvider({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      region: 'us-east-1',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello from AWS Bedrock Claude!' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 15, outputTokens: 20, totalTokens: 35 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await provider.generateContent({
      model: BEDROCK_MODELS.CLAUDE_3_7_SONNET,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect('choices' in response).toBe(true);
    if ('choices' in response) {
      expect(response.choices[0].message.content).toBe(
        'Hello from AWS Bedrock Claude!',
      );
      expect(response.choices[0].finishReason).toBe('stop');
      expect(response.usage?.totalTokens).toBe(35);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('/model/');
    expect(callArgs[1].headers.authorization).toContain('AWS4-HMAC-SHA256');
  });
});
