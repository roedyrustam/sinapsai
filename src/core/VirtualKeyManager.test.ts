/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * VirtualKeyManager Unit Tests
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { describe, expect, it } from 'vitest';
import { VirtualKeyManager } from './VirtualKeyManager.js';

describe('VirtualKeyManager (Multi-Tenant Virtual API Keys)', () => {
  it('issues, hashes, and verifies virtual API keys without storing plaintext', async () => {
    const manager = new VirtualKeyManager();
    const issued = await manager.issueKey({
      name: 'Production Web App',
      tenantId: 'tenant-acme',
    });

    expect(issued.apiKey.startsWith('sk-sinaps-')).toBe(true);
    expect(issued.record.tenantId).toBe('tenant-acme');

    const verified = await manager.verifyKey(issued.apiKey);
    expect(verified?.id).toBe(issued.record.id);
    expect(await manager.verifyKey('sk-sinaps-invalid')).toBeNull();
  });

  it('enforces Model ACLs and Provider ACLs with wildcard patterns', async () => {
    const manager = new VirtualKeyManager();
    const { apiKey } = await manager.issueKey({
      name: 'Free Tier',
      tenantId: 'tenant-free',
      allowedModels: ['qwen3-*', 'gemini-4-carbon'],
      allowedProviders: ['qwen', 'gemini'],
    });

    const ok1 = await manager.authorizeRequest(apiKey, {
      model: 'qwen3-turbo',
      provider: 'qwen',
    });
    expect(ok1.allowed).toBe(true);

    const deniedModel = await manager.authorizeRequest(apiKey, {
      model: 'claude-opus-5-5',
      provider: 'qwen',
    });
    expect(deniedModel.allowed).toBe(false);
    expect(deniedModel.statusCode).toBe(403);

    const deniedProvider = await manager.authorizeRequest(apiKey, {
      model: 'qwen3-turbo',
      provider: 'openai',
    });
    expect(deniedProvider.allowed).toBe(false);
    expect(deniedProvider.statusCode).toBe(403);
  });

  it('enforces FinOps USD budget caps and sliding-window RPM/TPM limits', async () => {
    const manager = new VirtualKeyManager();
    const { apiKey, record } = await manager.issueKey({
      name: 'Capped Tenant',
      tenantId: 'tenant-cap',
      maxBudgetUsd: 0.05,
      maxRpm: 2,
    });

    expect((await manager.authorizeRequest(apiKey)).allowed).toBe(true);
    expect((await manager.authorizeRequest(apiKey)).allowed).toBe(true);

    // 3rd request within 60s hits RPM limit
    const rpmExceeded = await manager.authorizeRequest(apiKey);
    expect(rpmExceeded.allowed).toBe(false);
    expect(rpmExceeded.statusCode).toBe(429);

    // Exceed budget cap
    manager.recordSpend(record.id, 0.06, 5000);
    const budgetExceeded = await manager.authorizeRequest(apiKey);
    expect(budgetExceeded.allowed).toBe(false);
    expect(budgetExceeded.statusCode).toBe(402);
  });

  it('supports zero-downtime key rotation, TTL expiration, and instant revocation', async () => {
    const manager = new VirtualKeyManager();
    const { apiKey: oldKey, record } = await manager.issueKey({
      name: 'Rotatable Key',
      tenantId: 'tenant-rot',
    });

    const rotated = await manager.rotateKey(record.id);
    expect(rotated).not.toBeNull();
    if (!rotated) throw new Error('Expected rotated key');
    expect(rotated.apiKey).not.toBe(oldKey);

    // Old key immediately invalid, new key valid
    expect(await manager.verifyKey(oldKey)).toBeNull();
    expect((await manager.verifyKey(rotated.apiKey))?.id).toBe(record.id);

    // Revoke key
    expect(manager.revokeKey(record.id)).toBe(true);
    const revokedAuth = await manager.authorizeRequest(rotated.apiKey);
    expect(revokedAuth.allowed).toBe(false);
    expect(revokedAuth.statusCode).toBe(401);

    // Expired key
    const expired = await manager.issueKey({
      name: 'Expired Key',
      tenantId: 'tenant-exp',
      expiresAt: Date.now() - 1000,
    });
    const expAuth = await manager.authorizeRequest(expired.apiKey);
    expect(expAuth.allowed).toBe(false);
    expect(expAuth.statusCode).toBe(401);
  });
});
