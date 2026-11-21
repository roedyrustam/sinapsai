import { describe, expect, it } from 'vitest';
import type { ContentPart, ImageUrlContentPart } from '../types/index.js';
import { VisionOptimizer } from './VisionOptimizer.js';

describe('VisionOptimizer', () => {
  const optimizer = new VisionOptimizer({
    maxAllowedTokensPerImage: 1000,
    autoDownsampleDetail: true,
  });

  // Helper to generate a minimal mock PNG buffer (100x200)
  function createMockPng(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    // PNG Magic
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR length & type
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
    // Width & Height (Big-endian)
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return bytes;
  }

  // Helper to generate a minimal mock GIF buffer (320x240)
  function createMockGif(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(10);
    // GIF89a
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    // Width & Height (Little-endian)
    const view = new DataView(bytes.buffer);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    return bytes;
  }

  it('correctly analyzes binary PNG headers', () => {
    const png = createMockPng(1920, 1080);
    const result = optimizer.analyzeImage(png);

    expect(result.format).toBe('png');
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it('correctly analyzes binary GIF headers', () => {
    const gif = createMockGif(640, 480);
    const result = optimizer.analyzeImage(gif);

    expect(result.format).toBe('gif');
    expect(result.mimeType).toBe('image/gif');
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  it('correctly calculates OpenAI vision tile math for low and high detail', () => {
    const png = createMockPng(1920, 1080);

    // Low detail is always 85 tokens
    const lowEst = optimizer.estimateVisionTokens(png, 'openai', 'low');
    expect(lowEst.tokens).toBe(85);
    expect(lowEst.tilesCount).toBe(1);

    // High detail for 1920x1080:
    // Fits inside 2048x2048. Shortest side is 1080 -> scaled to 768 -> scale = 768 / 1080 = 0.7111
    // w = 1920 * 0.7111 = 1365. h = 768.
    // tilesW = ceil(1365 / 512) = 3. tilesH = ceil(768 / 512) = 2.
    // tilesCount = 6. tokens = 85 + 6 * 170 = 1105.
    const highEst = optimizer.estimateVisionTokens(png, 'openai', 'high');
    expect(highEst.tokens).toBe(1105);
    expect(highEst.tilesCount).toBe(6);
    expect(highEst.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('correctly calculates Anthropic megapixel ratio tokens', () => {
    const png = createMockPng(1000, 1000); // 1,000,000 pixels
    const est = optimizer.estimateVisionTokens(png, 'anthropic');

    // 1,000,000 / 750 = ~1334 tokens
    expect(est.tokens).toBe(Math.ceil(1000000 / 750));
    expect(est.provider).toBe('anthropic');
  });

  it('correctly calculates Google Gemini 258-token tiles', () => {
    const png = createMockPng(1500, 800);
    const est = optimizer.estimateVisionTokens(png, 'gemini');

    // tilesW = ceil(1500 / 768) = 2. tilesH = ceil(800 / 768) = 2. tiles = 4.
    // tokens = 4 * 258 = 1032.
    expect(est.tokens).toBe(1032);
    expect(est.tilesCount).toBe(4);
  });

  it('accurately estimates audio duration and token volume', () => {
    const audioEst = optimizer.estimateAudioTokens(
      { durationSeconds: 15 },
      'openai',
    );
    // 15s * 30 tokens/sec = 450 tokens
    expect(audioEst.tokens).toBe(450);
    expect(audioEst.estimatedDurationSeconds).toBe(15);

    const geminiAudio = optimizer.estimateAudioTokens(
      { durationSeconds: 10 },
      'gemini',
    );
    // 10s * 32 tokens/sec = 320 tokens
    expect(geminiAudio.tokens).toBe(320);
  });

  it('downsamples high detail to low detail when budget cap is exceeded', () => {
    const png = createMockPng(1920, 1080);
    const base64Data = Buffer.from(png).toString('base64');
    const dataUri = `data:image/png;base64,${base64Data}`;

    const parts: ContentPart[] = [
      { type: 'text', text: 'Analyze this dashboard screenshot:' },
      { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
    ];

    // High detail produces 1105 tokens, which exceeds maxAllowedTokensPerImage (1000)
    const result = optimizer.optimizeContentParts(parts, 'openai', {
      maxTokensPerImage: 1000,
    });

    expect(result.optimizedCount).toBe(1);
    expect(result.savedTokensEstimated).toBe(1105 - 85);
    const updatedPart = result.parts[1] as ImageUrlContentPart;
    expect(updatedPart.image_url.detail).toBe('low');
    expect(updatedPart.imageUrl?.detail).toBe('low');
  });

  it('supports camelCase imageUrl alias when normalizing and enforcing detail', () => {
    const png = createMockPng(1920, 1080);
    const base64Data = Buffer.from(png).toString('base64');
    const dataUri = `data:image/png;base64,${base64Data}`;

    const legacyPart = {
      type: 'image_url' as const,
      imageUrl: { url: dataUri, detail: 'high' as const },
    } as unknown as ImageUrlContentPart;

    const result = optimizer.optimizeContentParts([legacyPart], 'openai', {
      enforceDetail: 'low',
    });

    const updated = result.parts[0] as ImageUrlContentPart;
    expect(updated.image_url.detail).toBe('low');
    expect(updated.imageUrl?.detail).toBe('low');
  });

  it('estimates xAI Grok vision tiles, Gemini mediaResolution tiers, and video tokens', () => {
    const png = createMockPng(1000, 1000);
    const grokEst = optimizer.estimateVisionTokens(png, 'xai');
    expect(grokEst.tilesCount).toBe(9);
    expect(grokEst.tokens).toBe(9 * 256);

    const lowGem = optimizer.estimateVisionTokens(
      png,
      'gemini',
      undefined,
      'low',
    );
    expect(lowGem.tokens).toBe(258);

    const highGem = optimizer.estimateVisionTokens(
      png,
      'gemini',
      undefined,
      'high',
    );
    expect(highGem.tokens).toBeGreaterThanOrEqual(560);

    const vidLow = optimizer.estimateVideoTokens(
      { durationSeconds: 10, fps: 1, mediaResolution: 'low' },
      'gemini',
    );
    const vidHigh = optimizer.estimateVideoTokens(
      { durationSeconds: 10, fps: 1, mediaResolution: 'high' },
      'gemini',
    );
    expect(vidLow.tokens).toBe(10 * 70 + 10 * 32);
    expect(vidHigh.tokens).toBe(10 * 560 + 10 * 32);
  });

  it('estimates Qwen-VL dynamic 28x28 patch visual tokens', () => {
    const png560 = createMockPng(560, 560);
    const qwenStandard = optimizer.estimateVisionTokens(png560, 'qwen', 'auto');
    // 560/28 = 20 -> 20 * 20 = 400 patches
    expect(qwenStandard.tokens).toBe(400);

    const png1400 = createMockPng(1400, 1400);
    const qwenLow = optimizer.estimateVisionTokens(png1400, 'qwen', 'low');
    expect(qwenLow.tokens).toBe(256);
  });
});
