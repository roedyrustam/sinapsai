/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

/**
 * Example 52: Multi-Tenant Virtual API Key Manager (ACLs, Budgets, RPM/TPM & Rotation)
 *
 * Demonstrates:
 * 1. Issuing SHA-256 hashed virtual keys (`sk-sinaps-...`) per tenant.
 * 2. Enforcing Model ACLs (`allowedModels`), Provider ACLs, FinOps USD budgets, and RPM limits.
 * 3. Zero-downtime key rotation and instant revocation.
 */

import { QwenProvider, SinapsClient } from 'sinapsai';

const client = new SinapsClient({
  providers: [
    new QwenProvider({ apiKey: process.env.QWEN_API_KEY || 'sk-qwen-demo' }),
  ],
});

async function main() {
  console.log('=== SinapsAI v3.8.0: Multi-Tenant Virtual API Keys ===\n');

  const freeTier = await client.virtualKeys.issueKey({
    name: 'Free Tier Tenant',
    tenantId: 'org-free-01',
    allowedModels: ['qwen3-turbo', 'gemini-4-carbon'],
    maxBudgetUsd: 1.0,
    maxRpm: 10,
  });

  console.log('Issued Key:', freeTier.apiKey);
  console.log('Stored Prefix:', freeTier.record.keyPrefix);

  const ok = await client.virtualKeys.authorizeRequest(freeTier.apiKey, {
    model: 'qwen3-turbo',
    provider: 'qwen',
  });
  console.log('Allowed qwen3-turbo:', ok.allowed, `(${ok.statusCode})`);

  const denied = await client.virtualKeys.authorizeRequest(freeTier.apiKey, {
    model: 'claude-opus-5-5',
    provider: 'anthropic',
  });
  console.log(
    'Denied claude-opus-5-5:',
    denied.allowed,
    `(${denied.statusCode} - ${denied.reason})`,
  );

  // Record spend and rotate key
  client.virtualKeys.recordSpend(freeTier.record.id, 0.02, 1200);
  const rotated = await client.virtualKeys.rotateKey(freeTier.record.id);
  console.log('Rotated Key Prefix:', rotated?.record.keyPrefix);
  console.log('All Keys:', client.virtualKeys.listKeys().length);
}

main().catch(console.error);
