/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Zero-Dependency Multi-Tenant Virtual API Key Manager
 *
 * Implements:
 * 1. Cryptographically secure virtual key generation (`sk-sinaps-...`) using Web Crypto.
 * 2. SHA-256 key hashing (plaintext keys are never stored in memory).
 * 3. Per-key Model ACLs (`allowedModels`), Provider ACLs (`allowedProviders`),
 *    FinOps USD budget caps (`maxBudgetUsd`), sliding-window RPM/TPM limits,
 *    TTL expiration (`expiresAt`), instant revocation, and zero-downtime key rotation.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

export interface VirtualKeyOptions {
  /** Human-readable key label (e.g. "Engineering Team", "Free Tier Tenant"). */
  name: string;
  /** Tenant or organization identifier for multi-tenant attribution. */
  tenantId: string;
  /** Optional model allowlist (glob-like prefix or exact match, e.g. ['qwen3-turbo', 'gemini-4-*']). */
  allowedModels?: string[];
  /** Optional provider allowlist (e.g. ['qwen', 'gemini', 'openai']). */
  allowedProviders?: string[];
  /** Maximum cumulative USD spend allowed for this virtual key. */
  maxBudgetUsd?: number;
  /** Maximum requests per minute (sliding 60s window). */
  maxRpm?: number;
  /** Maximum tokens per minute (sliding 60s window). */
  maxTpm?: number;
  /** Optional expiration timestamp in Unix milliseconds. */
  expiresAt?: number;
  /** Custom key prefix (default: 'sk-sinaps-'). */
  prefix?: string;
  /** Arbitrary tenant metadata. */
  metadata?: Record<string, unknown>;
}

export interface VirtualKeyRecord {
  id: string;
  name: string;
  tenantId: string;
  keyPrefix: string;
  keyHash: string;
  allowedModels?: string[];
  allowedProviders?: string[];
  maxBudgetUsd?: number;
  maxRpm?: number;
  maxTpm?: number;
  expiresAt?: number;
  revoked: boolean;
  createdAt: number;
  lastUsedAt?: number;
  spentUsd: number;
  totalRequests: number;
  totalTokens: number;
  metadata?: Record<string, unknown>;
}

export interface IssuedVirtualKey {
  /** Plaintext secret key — returned ONLY once upon issuance or rotation. */
  apiKey: string;
  record: Omit<VirtualKeyRecord, 'keyHash'>;
}

export interface VirtualKeyAuthorizationResult {
  allowed: boolean;
  statusCode: 200 | 401 | 402 | 403 | 429;
  reason?: string;
  keyId?: string;
  tenantId?: string;
  record?: Omit<VirtualKeyRecord, 'keyHash'>;
}

export class VirtualKeyError extends Error {
  public readonly statusCode: 401 | 402 | 403 | 429;
  public readonly keyId?: string;
  public readonly tenantId?: string;

  constructor(
    message: string,
    statusCode: 401 | 402 | 403 | 429,
    keyId?: string,
    tenantId?: string,
  ) {
    super(message);
    this.name = 'VirtualKeyError';
    this.statusCode = statusCode;
    this.keyId = keyId;
    this.tenantId = tenantId;
  }
}

interface UsageWindowEntry {
  timestamp: number;
  tokens: number;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function generateSecureToken(prefix: string): string {
  const randomBytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(randomBytes);
  return `${prefix}${bytesToHex(randomBytes)}`;
}

function matchesPattern(value: string, pattern: string): boolean {
  const v = value.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === '*' || v === p) return true;
  if (p.endsWith('*')) {
    return v.startsWith(p.slice(0, -1));
  }
  return false;
}

function sanitizeRecord(
  record: VirtualKeyRecord,
): Omit<VirtualKeyRecord, 'keyHash'> {
  const { keyHash: _keyHash, ...safe } = record;
  return { ...safe };
}

export class VirtualKeyManager {
  private recordsById = new Map<string, VirtualKeyRecord>();
  private idByHash = new Map<string, string>();
  private usageWindows = new Map<string, UsageWindowEntry[]>();

  /**
   * Issues a new cryptographically secure virtual API key.
   * The plaintext `apiKey` is returned once; only its SHA-256 hash is retained.
   */
  public async issueKey(options: VirtualKeyOptions): Promise<IssuedVirtualKey> {
    const prefix = options.prefix || 'sk-sinaps-';
    const apiKey = generateSecureToken(prefix);
    const keyHash = await sha256Hex(apiKey);
    const id = `vk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const record: VirtualKeyRecord = {
      id,
      name: options.name,
      tenantId: options.tenantId,
      keyPrefix: `${apiKey.slice(0, Math.min(apiKey.length, prefix.length + 6))}...`,
      keyHash,
      allowedModels: options.allowedModels
        ? [...options.allowedModels]
        : undefined,
      allowedProviders: options.allowedProviders
        ? [...options.allowedProviders]
        : undefined,
      maxBudgetUsd: options.maxBudgetUsd,
      maxRpm: options.maxRpm,
      maxTpm: options.maxTpm,
      expiresAt: options.expiresAt,
      revoked: false,
      createdAt: Date.now(),
      spentUsd: 0,
      totalRequests: 0,
      totalTokens: 0,
      metadata: options.metadata ? { ...options.metadata } : undefined,
    };

    this.recordsById.set(id, record);
    this.idByHash.set(keyHash, id);

    return {
      apiKey,
      record: sanitizeRecord(record),
    };
  }

  /**
   * Verifies a raw virtual API key and returns its metadata record if valid.
   */
  public async verifyKey(
    rawKey: string,
  ): Promise<Omit<VirtualKeyRecord, 'keyHash'> | null> {
    if (!rawKey) return null;
    const hash = await sha256Hex(rawKey);
    const id = this.idByHash.get(hash);
    if (!id) return null;
    const record = this.recordsById.get(id);
    if (!record || record.revoked) return null;
    if (record.expiresAt !== undefined && Date.now() > record.expiresAt) {
      return null;
    }
    return sanitizeRecord(record);
  }

  /**
   * Authorizes an incoming request against key validity, expiration,
   * Model ACL, Provider ACL, FinOps USD budget, and sliding-window RPM/TPM limits.
   */
  public async authorizeRequest(
    rawKey: string,
    context?: {
      model?: string;
      provider?: string;
      estimatedTokens?: number;
    },
  ): Promise<VirtualKeyAuthorizationResult> {
    if (!rawKey) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Missing virtual API key',
      };
    }

    const hash = await sha256Hex(rawKey);
    const id = this.idByHash.get(hash);
    if (!id) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Invalid virtual API key',
      };
    }

    const record = this.recordsById.get(id);
    if (!record) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Virtual API key not found',
      };
    }

    if (record.revoked) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Virtual API key has been revoked',
        keyId: record.id,
        tenantId: record.tenantId,
      };
    }

    const now = Date.now();
    if (record.expiresAt !== undefined && now > record.expiresAt) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Virtual API key has expired',
        keyId: record.id,
        tenantId: record.tenantId,
      };
    }

    // Model ACL check
    const reqModel = context?.model;
    if (reqModel && record.allowedModels && record.allowedModels.length > 0) {
      const permitted = record.allowedModels.some((pattern) =>
        matchesPattern(reqModel, pattern),
      );
      if (!permitted) {
        return {
          allowed: false,
          statusCode: 403,
          reason: `Model '${reqModel}' is not permitted for virtual key '${record.name}'`,
          keyId: record.id,
          tenantId: record.tenantId,
        };
      }
    }

    // Provider ACL check
    const reqProvider = context?.provider;
    if (
      reqProvider &&
      record.allowedProviders &&
      record.allowedProviders.length > 0
    ) {
      const permitted = record.allowedProviders.some((pattern) =>
        matchesPattern(reqProvider, pattern),
      );
      if (!permitted) {
        return {
          allowed: false,
          statusCode: 403,
          reason: `Provider '${reqProvider}' is not permitted for virtual key '${record.name}'`,
          keyId: record.id,
          tenantId: record.tenantId,
        };
      }
    }

    // Budget cap check
    if (
      record.maxBudgetUsd !== undefined &&
      record.spentUsd >= record.maxBudgetUsd
    ) {
      return {
        allowed: false,
        statusCode: 402,
        reason: `Budget cap ($${record.maxBudgetUsd.toFixed(4)}) exceeded for virtual key '${record.name}'`,
        keyId: record.id,
        tenantId: record.tenantId,
      };
    }

    // Sliding-window 60s RPM & TPM check
    const windowCutoff = now - 60_000;
    const history = (this.usageWindows.get(record.id) || []).filter(
      (entry) => entry.timestamp >= windowCutoff,
    );
    this.usageWindows.set(record.id, history);

    if (record.maxRpm !== undefined && history.length >= record.maxRpm) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `RPM limit (${record.maxRpm}/min) exceeded for virtual key '${record.name}'`,
        keyId: record.id,
        tenantId: record.tenantId,
      };
    }

    const windowTokens = history.reduce((sum, e) => sum + e.tokens, 0);
    const projectedTokens = windowTokens + (context?.estimatedTokens ?? 0);
    if (record.maxTpm !== undefined && projectedTokens > record.maxTpm) {
      return {
        allowed: false,
        statusCode: 429,
        reason: `TPM limit (${record.maxTpm}/min) exceeded for virtual key '${record.name}'`,
        keyId: record.id,
        tenantId: record.tenantId,
      };
    }

    // Record request slot immediately in the sliding window
    history.push({ timestamp: now, tokens: context?.estimatedTokens ?? 0 });
    record.lastUsedAt = now;
    record.totalRequests += 1;

    return {
      allowed: true,
      statusCode: 200,
      keyId: record.id,
      tenantId: record.tenantId,
      record: sanitizeRecord(record),
    };
  }

  /**
   * Records actual post-response USD spend and token consumption for a virtual key.
   */
  public recordSpend(keyId: string, costUsd: number, tokens = 0): void {
    const record = this.recordsById.get(keyId);
    if (!record) return;
    record.spentUsd = Number(
      (record.spentUsd + Math.max(0, costUsd)).toFixed(6),
    );
    record.totalTokens += Math.max(0, tokens);
    record.lastUsedAt = Date.now();

    if (tokens > 0) {
      const history = this.usageWindows.get(keyId) || [];
      history.push({ timestamp: Date.now(), tokens });
      this.usageWindows.set(keyId, history);
    }
  }

  /**
   * Immediately revokes a virtual API key.
   */
  public revokeKey(keyId: string): boolean {
    const record = this.recordsById.get(keyId);
    if (!record) return false;
    record.revoked = true;
    return true;
  }

  /**
   * Rotates the secret token of an existing virtual key while preserving
   * its tenant attribution, ACLs, and cumulative spend metrics.
   */
  public async rotateKey(keyId: string): Promise<IssuedVirtualKey | null> {
    const record = this.recordsById.get(keyId);
    if (!record || record.revoked) return null;

    this.idByHash.delete(record.keyHash);
    const apiKey = generateSecureToken('sk-sinaps-');
    const newHash = await sha256Hex(apiKey);
    record.keyHash = newHash;
    record.keyPrefix = `${apiKey.slice(0, 16)}...`;
    this.idByHash.set(newHash, record.id);

    return {
      apiKey,
      record: sanitizeRecord(record),
    };
  }

  /**
   * Lists all virtual key metadata records (never exposes hashes or secrets).
   */
  public listKeys(tenantId?: string): Array<Omit<VirtualKeyRecord, 'keyHash'>> {
    const all = Array.from(this.recordsById.values());
    const filtered = tenantId
      ? all.filter((r) => r.tenantId === tenantId)
      : all;
    return filtered.map(sanitizeRecord);
  }

  /**
   * Returns whether any virtual keys have been registered.
   */
  public hasKeys(): boolean {
    return this.recordsById.size > 0;
  }
}
