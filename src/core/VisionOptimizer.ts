/**
 * Zero-dependency In-Process Multimodal Vision & Audio Token Optimizer.
 *
 * Provides sub-millisecond image/audio header inspection, exact provider-specific
 * token estimation (OpenAI tile grid math, Anthropic megapixel ratio, Gemini fixed tiles),
 * FinOps cost projection, and automatic content part optimization for multimodal LLM requests.
 *
 * @author Roedy Rustam
 * @license MIT
 */

import type { ContentPart } from '../types/index.js';

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'unknown';
  mimeType: string;
  byteLength: number;
}

export interface VisionTokenEstimate {
  provider: string;
  tokens: number;
  estimatedCostUsd: number;
  detailMode: 'low' | 'high' | 'auto';
  tilesCount: number;
  width: number;
  height: number;
}

export interface AudioTokenEstimate {
  provider: string;
  estimatedDurationSeconds: number;
  tokens: number;
  estimatedCostUsd: number;
}

export interface VideoTokenEstimate {
  provider: string;
  durationSeconds: number;
  fps: number;
  mediaResolution: 'low' | 'medium' | 'high';
  tokens: number;
  estimatedCostUsd: number;
}

export interface VisionOptimizerOptions {
  defaultDetail?: 'low' | 'high' | 'auto';
  mediaResolution?: 'low' | 'medium' | 'high';
  maxAllowedTokensPerImage?: number;
  autoDownsampleDetail?: boolean;
}

export class VisionOptimizer {
  private defaultDetail: 'low' | 'high' | 'auto';
  private mediaResolution: 'low' | 'medium' | 'high';
  private maxAllowedTokensPerImage: number;
  private autoDownsampleDetail: boolean;

  constructor(options: VisionOptimizerOptions = {}) {
    this.defaultDetail = options.defaultDetail ?? 'auto';
    this.mediaResolution = options.mediaResolution ?? 'medium';
    this.maxAllowedTokensPerImage = options.maxAllowedTokensPerImage ?? 2000;
    this.autoDownsampleDetail = options.autoDownsampleDetail ?? true;
  }

  /**
   * Inspects raw image bytes or base64 data URIs to extract dimensions and format.
   * Completely zero-dependency via standard Web Buffer/Uint8Array header parsing.
   */
  public analyzeImage(
    input: string | Uint8Array | ArrayBuffer,
  ): ImageDimensions {
    const bytes = this.toBytes(input);

    if (bytes.length < 8) {
      return {
        width: 0,
        height: 0,
        format: 'unknown',
        mimeType: 'application/octet-stream',
        byteLength: bytes.length,
      };
    }

    // 1. PNG Header: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      if (bytes.length >= 24) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        const width = view.getUint32(16, false);
        const height = view.getUint32(20, false);
        return {
          width,
          height,
          format: 'png',
          mimeType: 'image/png',
          byteLength: bytes.length,
        };
      }
    }

    // 2. GIF Header: GIF87a or GIF89a
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    ) {
      if (bytes.length >= 10) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        const width = view.getUint16(6, true);
        const height = view.getUint16(8, true);
        return {
          width,
          height,
          format: 'gif',
          mimeType: 'image/gif',
          byteLength: bytes.length,
        };
      }
    }

    // 3. WebP Header: RIFF .... WEBP
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      const parsedWebp = this.parseWebp(bytes);
      if (parsedWebp) return parsedWebp;
    }

    // 4. JPEG Header: FF D8
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const parsedJpeg = this.parseJpeg(bytes);
      if (parsedJpeg) return parsedJpeg;
    }

    // Fallback: Default nominal square
    return {
      width: 1024,
      height: 1024,
      format: 'unknown',
      mimeType: 'image/jpeg',
      byteLength: bytes.length,
    };
  }

  /**
   * Estimates provider-specific vision token consumption and dollar cost.
   * Accurately replicates OpenAI 512px tile grid, Anthropic megapixel ratios, and Gemini tile formulas.
   */
  public estimateVisionTokens(
    input: string | Uint8Array | ArrayBuffer | ImageDimensions,
    provider = 'openai',
    detailOverride?: 'low' | 'high' | 'auto',
    mediaResolutionOverride?: 'low' | 'medium' | 'high',
  ): VisionTokenEstimate {
    const dims: ImageDimensions =
      typeof input === 'object' && 'format' in input
        ? (input as ImageDimensions)
        : this.analyzeImage(input as string | Uint8Array);

    const detail = detailOverride ?? this.defaultDetail;
    const normProvider = provider.toLowerCase();

    let tokens = 0;
    let tilesCount = 1;

    if (normProvider.includes('anthropic') || normProvider.includes('claude')) {
      // Anthropic token formula: ~1600 tokens per megapixel or ceil((width * height) / 750)
      const rawTokens = Math.ceil((dims.width * dims.height) / 750);
      tokens = Math.max(160, Math.min(rawTokens, 2400));
      tilesCount = Math.max(
        1,
        Math.ceil((dims.width * dims.height) / (512 * 512)),
      );
    } else if (
      normProvider.includes('gemini') ||
      normProvider.includes('google')
    ) {
      if (mediaResolutionOverride === 'low') {
        tilesCount = 1;
        tokens = 258;
      } else if (mediaResolutionOverride === 'high') {
        const tilesW = Math.ceil(dims.width / 768);
        const tilesH = Math.ceil(dims.height / 768);
        tilesCount = Math.max(1, tilesW * tilesH);
        tokens = Math.max(560, tilesCount * 258);
      } else {
        // Google Gemini 2.5/3.x/4: 258 tokens per 768px tile
        const tilesW = Math.ceil(dims.width / 768);
        const tilesH = Math.ceil(dims.height / 768);
        tilesCount = Math.max(1, tilesW * tilesH);
        tokens = tilesCount * 258;
      }
    } else if (normProvider.includes('xai') || normProvider.includes('grok')) {
      // xAI Grok 4.x Vision: 448x448 tile grid, 256 tokens per tile
      const tilesW = Math.max(1, Math.ceil(dims.width / 448));
      const tilesH = Math.max(1, Math.ceil(dims.height / 448));
      tilesCount = tilesW * tilesH;
      tokens = tilesCount * 256;
    } else {
      // OpenAI / GPT-5 / GPT-4o / Azure / default:
      // If detail: 'low', fixed 85 tokens.
      // If detail: 'high' or 'auto':
      // 1. Scale down to fit inside 2048x2048
      // 2. Scale shortest side to 768px
      // 3. Count 512x512 tiles, each tile is 170 tokens + 85 base tokens
      if (detail === 'low') {
        tokens = 85;
        tilesCount = 1;
      } else {
        let w = dims.width;
        let h = dims.height;

        // Step 1: Fit inside 2048x2048
        if (w > 2048 || h > 2048) {
          const ratio = Math.min(2048 / w, 2048 / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        // Step 2: Scale shortest side to 768
        const shortest = Math.min(w, h);
        if (shortest > 768) {
          const scale = 768 / shortest;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        // Step 3: Count 512x512 tiles
        const tilesW = Math.ceil(w / 512);
        const tilesH = Math.ceil(h / 512);
        tilesCount = Math.max(1, tilesW * tilesH);
        tokens = 85 + tilesCount * 170;
      }
    }

    // Cost estimation: Nominal vision input rate ~$2.50 per 1M tokens ($0.0025 / 1k tokens)
    const costPer1k = 0.0025;
    const estimatedCostUsd = (tokens / 1000) * costPer1k;

    return {
      provider,
      tokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      detailMode: detail,
      tilesCount,
      width: dims.width,
      height: dims.height,
    };
  }

  /**
   * Estimates audio token consumption from base64/buffer or duration.
   * Standardized across OpenAI Audio (~30 tok/sec) and Gemini Multimodal Audio (~32 tok/sec).
   */
  public estimateAudioTokens(
    input: { durationSeconds?: number; byteLength?: number },
    provider = 'openai',
  ): AudioTokenEstimate {
    let duration = input.durationSeconds;
    if (duration === undefined && input.byteLength) {
      // Nominal 16kHz 16-bit mono PCM is ~32,000 bytes per second; MP3 is ~16,000 bytes/sec
      duration = Math.max(1, Math.round(input.byteLength / 24000));
    }
    const safeDuration = Math.max(1, duration ?? 1);
    const normProvider = provider.toLowerCase();

    // Rates: ~30 tokens/sec on OpenAI, ~32 tokens/sec on Gemini
    const tokensPerSec = normProvider.includes('gemini') ? 32 : 30;
    const tokens = safeDuration * tokensPerSec;
    const costPer1k = 0.005; // $0.005 per 1k audio tokens
    const estimatedCostUsd = (tokens / 1000) * costPer1k;

    return {
      provider,
      estimatedDurationSeconds: safeDuration,
      tokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    };
  }

  /**
   * Estimates video token consumption for frontier multimodal models (Gemini 3/4, GPT-5).
   * Accounts for video frame sampling rate (`fps`) and `mediaResolution` ('low' | 'medium' | 'high').
   */
  public estimateVideoTokens(
    input: {
      durationSeconds: number;
      fps?: number;
      mediaResolution?: 'low' | 'medium' | 'high';
    },
    provider = 'gemini',
  ): VideoTokenEstimate {
    const safeDuration = Math.max(1, input.durationSeconds);
    const fps = Math.max(0.1, input.fps ?? 1);
    const resolution = input.mediaResolution ?? this.mediaResolution;

    // Gemini low mediaResolution ~100 tok/sec (66 frame + 32 audio); medium/default ~290 tok/sec (258 frame + 32 audio); high ~560 tok/sec
    const tokensPerFrame =
      resolution === 'low' ? 70 : resolution === 'high' ? 560 : 258;
    const audioTokensPerSec = provider.toLowerCase().includes('gemini')
      ? 32
      : 30;

    const frameTokens = Math.ceil(safeDuration * fps * tokensPerFrame);
    const audioTokens = Math.ceil(safeDuration * audioTokensPerSec);
    const tokens = frameTokens + audioTokens;
    const costPer1k = 0.0025;
    const estimatedCostUsd = (tokens / 1000) * costPer1k;

    return {
      provider,
      durationSeconds: safeDuration,
      fps,
      mediaResolution: resolution,
      tokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    };
  }

  /**
   * Scans and optimizes ContentPart array in a UnifiedApiRequest.
   * If an image exceeds maxAllowedTokensPerImage and autoDownsampleDetail is active,
   * downscales detail mode from 'high'/'auto' to 'low' to slash FinOps token waste.
   */
  public optimizeContentParts(
    parts: ContentPart[],
    provider = 'openai',
    options?: { maxTokensPerImage?: number; enforceDetail?: 'low' | 'high' },
  ): {
    parts: ContentPart[];
    optimizedCount: number;
    savedTokensEstimated: number;
  } {
    const maxTokens =
      options?.maxTokensPerImage ?? this.maxAllowedTokensPerImage;
    let optimizedCount = 0;
    let savedTokensEstimated = 0;

    const optimized = parts.map((part) => {
      if (part.type !== 'image_url') {
        return part;
      }

      const imgObj = part.image_url ?? part.imageUrl;
      if (!imgObj) {
        return part;
      }

      if (options?.enforceDetail) {
        const updatedImg = {
          ...imgObj,
          detail: options.enforceDetail,
        };
        return {
          ...part,
          image_url: updatedImg,
          ...(part.imageUrl ? { imageUrl: updatedImg } : {}),
        };
      }

      const estimate = this.estimateVisionTokens(
        imgObj.url,
        provider,
        imgObj.detail ?? 'high',
      );

      if (estimate.tokens > maxTokens && this.autoDownsampleDetail) {
        const lowEstimate = this.estimateVisionTokens(
          imgObj.url,
          provider,
          'low',
        );
        const saved = estimate.tokens - lowEstimate.tokens;
        optimizedCount++;
        savedTokensEstimated += Math.max(0, saved);

        const downsampledImg = {
          ...imgObj,
          detail: 'low' as const,
        };

        return {
          ...part,
          image_url: downsampledImg,
          imageUrl: downsampledImg,
        };
      }

      return part;
    });

    return {
      parts: optimized,
      optimizedCount,
      savedTokensEstimated,
    };
  }

  // --- Private Header Parsers ---

  private toBytes(input: string | Uint8Array | ArrayBuffer): Uint8Array {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    if (typeof input === 'string') {
      // If it is a base64 Data URI: data:image/png;base64,iVBOR...
      if (input.startsWith('data:') && input.includes(';base64,')) {
        const base64Data = input.split(';base64,')[1] ?? '';
        return this.decodeBase64Prefix(base64Data, 1024);
      }
      // If it is raw base64
      if (/^[A-Za-z0-9+/=]+$/.test(input.slice(0, 64))) {
        return this.decodeBase64Prefix(input, 1024);
      }
      // Fallback: utf-8 encode
      return new TextEncoder().encode(input.slice(0, 1024));
    }

    return new Uint8Array(0);
  }

  private decodeBase64Prefix(b64: string, maxBytes: number): Uint8Array {
    const safeB64 = b64.slice(0, Math.ceil((maxBytes * 4) / 3));
    if (typeof Buffer !== 'undefined') {
      return Uint8Array.from(Buffer.from(safeB64, 'base64'));
    }
    const binStr = atob(safeB64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  }

  private parseJpeg(bytes: Uint8Array): ImageDimensions | null {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = bytes[offset + 1];

      // SOF0 (Baseline), SOF1 (Extended), SOF2 (Progressive) markers have width & height
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 9 < bytes.length) {
          const height = view.getUint16(offset + 5, false);
          const width = view.getUint16(offset + 7, false);
          return {
            width,
            height,
            format: 'jpeg',
            mimeType: 'image/jpeg',
            byteLength: bytes.length,
          };
        }
      }

      // Variable size marker: skip marker payload
      if (offset + 3 < bytes.length) {
        const length = view.getUint16(offset + 2, false);
        offset += 2 + length;
      } else {
        break;
      }
    }

    return null;
  }

  private parseWebp(bytes: Uint8Array): ImageDimensions | null {
    if (bytes.length < 30) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // VP8 chunk (lossy)
    if (
      bytes[12] === 0x56 &&
      bytes[13] === 0x50 &&
      bytes[14] === 0x38 &&
      bytes[15] === 0x20
    ) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return {
        width,
        height,
        format: 'webp',
        mimeType: 'image/webp',
        byteLength: bytes.length,
      };
    }

    // VP8L chunk (lossless)
    if (
      bytes[12] === 0x56 &&
      bytes[13] === 0x50 &&
      bytes[14] === 0x38 &&
      bytes[15] === 0x4c
    ) {
      const b0 = bytes[21] ?? 0;
      const b1 = bytes[22] ?? 0;
      const b2 = bytes[23] ?? 0;
      const b3 = bytes[24] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return {
        width,
        height,
        format: 'webp',
        mimeType: 'image/webp',
        byteLength: bytes.length,
      };
    }

    // VP8X chunk (extended)
    if (
      bytes[12] === 0x56 &&
      bytes[13] === 0x50 &&
      bytes[14] === 0x38 &&
      bytes[15] === 0x58
    ) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return {
        width,
        height,
        format: 'webp',
        mimeType: 'image/webp',
        byteLength: bytes.length,
      };
    }

    return null;
  }
}
