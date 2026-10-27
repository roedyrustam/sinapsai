# 🔒 Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.11.x  | :white_check_mark: |
| 2.10.x  | :white_check_mark: |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Built-in Security Architecture & Defenses

SinapsAI is engineered with defense-in-depth principles:
- **100% In-Process Execution**: Prompt payloads and API keys remain strictly in application memory space and are never proxied through external intermediate cloud gateways.
- **Multi-Agent Ping-Pong & Recursion Defense (`maxHandoffs`)**: Autonomous agent swarms enforce a strict delegation ceiling preventing infinite loops, token exhaustion, and runaway costs when agents have circular handoff relationships.
- **ReDoS Prevention**: All internal regex scanners in `SecurityGuardrails` and `PIIGuardrails` feature zero-length match advancing guards and clone state per execution to prevent infinite CPU loops.
- **Prototype Pollution Immunity**: Recursive JSON schema canonicalization in `GeminiAgentBooster` filters dangerous prototype attributes (`__proto__`, `constructor`, `prototype`).
- **Atomic Concurrency Protection**: Rate limit counters utilize atomic storage increment operations (`storage.increment`) preventing race conditions during burst traffic.
- **Two-Way Reversible PII Tokenization Vault**: Automatic masking with surrogate tokens prevents accidental sensitive data leaks (credit cards, SSNs, phone numbers, emails, JWTs) across non-streaming and streaming pipelines.
- **Prompt Injection Defense**: Multimodal inspection guards against system prompt overrides, delimiter hijacking, and jailbreaks.

## Reporting a Vulnerability

We take the security of SinapsAI seriously. Because SinapsAI processes API keys and sensitive prompts in memory, security is a first-class priority.

If you discover a security vulnerability:

1. **Do NOT open a public GitHub Issue.**
2. Send an email to the maintainer: `roedyrustam@gmail.com` (or create a private GitHub Security Advisory).
3. Include:
   - A description of the vulnerability.
   - Steps to reproduce or a minimal proof of concept.
   - Any potential impact on users.

We will acknowledge receipt within 48 hours and work with you on a timely resolution and disclosure plan.
