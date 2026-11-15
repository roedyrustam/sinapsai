/**
 * SinapsAI - Example 48: Vision Token Optimizer, Speculative Stream Verification,
 * Dynamic Agent Persona Registry & Unified Hot-Path Pipeline (v3.5.0)
 *
 * Demonstrates:
 * 1. Multimodal Vision FinOps (`VisionOptimizer`): header inspection & detail downsampling.
 * 2. Speculative Stream Verification (`SpeculativeStreamVerifier`): fast draft + parallel auditor.
 * 3. Dynamic Persona Governance (`AgentPersonaRegistry`): ephemeral skill pruning & drift detection.
 * 4. Unified Hot-Path Pipeline: `useBrain` + `pinKvCache` + `ClusteredSemanticCache` + Auto-OTel Spans.
 *
 * Run with: npx tsx examples/48-vision-optimizer-speculative-stream-and-personas.ts
 */

import {
  AgentPersonaRegistry,
  type ContentPart,
  type Provider,
  SinapsClient,
  type SpeculativeProviderLike,
  type StreamCorrectionEvent,
  type UnifiedApiRequest,
  type UnifiedApiResponse,
  type UnifiedApiStreamChunk,
  VisionOptimizer,
} from '../src/index.js';

function createSyntheticPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length & tag
  bytes[11] = 13;
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

async function main() {
  console.log(
    '=== SinapsAI v3.5.0: Vision FinOps, Speculative Stream, Personas & Unified Hot-Path ===\n',
  );

  // =========================================================================
  // PILLAR 1: Multimodal Vision Token Optimizer
  // =========================================================================
  console.log('--- 1. Multimodal Vision Token Optimizer ---');
  const vision = new VisionOptimizer({
    maxAllowedTokensPerImage: 500,
    autoDownsampleDetail: true,
  });

  const pngBytes = createSyntheticPngHeader(2048, 2048);
  const dimensions = vision.analyzeImage(pngBytes);
  console.log(
    `Detected Image: ${dimensions.format.toUpperCase()} ${dimensions.width}x${dimensions.height}`,
  );

  for (const providerName of ['openai', 'anthropic', 'gemini'] as const) {
    const estimate = vision.estimateVisionTokens(
      pngBytes,
      providerName,
      'high',
    );
    console.log(
      `  [${providerName}] high-detail estimate: ${estimate.tokens} tokens (tiles=${estimate.tilesCount}, ~$${estimate.estimatedCostUsd.toFixed(6)})`,
    );
  }

  const base64DataUri = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`;
  const rawParts: ContentPart[] = [
    { type: 'text', text: 'Inspect this 2048x2048 dashboard screenshot.' },
    { type: 'image_url', image_url: { url: base64DataUri, detail: 'high' } },
  ];

  const optimized = vision.optimizeContentParts(rawParts, 'openai');
  const imgPart = optimized.parts[1];
  const newDetail =
    imgPart && imgPart.type === 'image_url'
      ? imgPart.image_url.detail
      : 'unknown';
  console.log(
    `Optimized parts: optimizedCount=${optimized.optimizedCount}, detail=${newDetail}, savedTokensEstimated=${optimized.savedTokensEstimated}\n`,
  );

  // =========================================================================
  // PILLAR 2: Speculative Stream Verification (Fast Draft + Parallel Auditor)
  // =========================================================================
  console.log('--- 2. Speculative Stream Verification ---');
  const draftProvider: SpeculativeProviderLike = {
    id: 'fast-draft-mock',
    name: 'Fast Draft Mock',
    async *executeStream(): AsyncIterable<UnifiedApiStreamChunk> {
      const tokens = [
        'SinapsAI executes AI pipelines ',
        'with zero runtime dependencies. ',
        'Never skip security guardrails ',
        'in production database environments. ',
      ];
      for (const token of tokens) {
        yield {
          id: 'draft-chunk',
          model: 'groq-llama-fast',
          choices: [{ delta: { content: token }, finishReason: null }],
        };
      }
      yield {
        id: 'draft-end',
        model: 'groq-llama-fast',
        choices: [{ delta: {}, finishReason: 'stop' }],
      };
    },
  };

  const auditorProvider: Provider = {
    id: 'deep-auditor-mock',
    name: 'Deep Auditor Mock',
    async generateContent(req: UnifiedApiRequest): Promise<UnifiedApiResponse> {
      const prompt = String(req.messages[1]?.content ?? '');
      const verdict = prompt.includes('dependencies')
        ? '[VALID]'
        : '[INVALID: Verify security policy wording carefully before applying to production]';
      return {
        id: 'audit-res',
        model: 'claude-sonnet-auditor',
        choices: [
          {
            message: { role: 'assistant', content: verdict },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  const demoClient = new SinapsClient({
    providers: [auditorProvider],
    vision: { maxAllowedTokensPerImage: 500, autoDownsampleDetail: true },
  });

  const verifier = demoClient.createSpeculativeStream({
    draftProvider,
    auditorProvider,
    minSentenceLength: 20,
    onCorrection: (event: StreamCorrectionEvent) => {
      console.log(
        `  [AUDITOR CORRECTION @ chunk ${event.chunkIndex}] (${event.severity}) ${event.reason}`,
      );
    },
  });

  process.stdout.write('  Stream output: ');
  const streamResult = await verifier.execute(
    {
      model: 'groq-llama-fast',
      messages: [{ role: 'user', content: 'Summarize SinapsAI security.' }],
    },
    (chunk) => {
      process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
    },
  );
  console.log('\n  Stats:', JSON.stringify(streamResult.stats), '\n');

  // =========================================================================
  // PILLAR 3: AgentPersonaRegistry (Ephemeral Skill Pruning + Drift Check)
  // =========================================================================
  console.log('--- 3. Agent Persona Registry & Swarm Lifecycle ---');
  const personaRegistry = new AgentPersonaRegistry([
    {
      id: 'sec-auditor',
      name: 'SecOps',
      role: 'Zero-Trust Security Auditor',
      systemInstructions: 'Return concise JSON findings only.',
      styleGuidelines: ['Keep answers concise and use JSON format.'],
    },
  ]);

  personaRegistry.injectSkill('sec-auditor', {
    id: 'tls-hotfix',
    name: 'Temporary TLS Audit Checklist',
    instructions: 'Check TLS 1.3 cipher suites on DB endpoints.',
    turnsRemaining: 1,
  });

  const swarmMockProvider: Provider = {
    id: 'swarm-mock',
    name: 'Swarm Mock',
    async generateContent(req: UnifiedApiRequest): Promise<UnifiedApiResponse> {
      const isHotPath = req.messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('ap-southeast-1'),
      );
      const reply = isHotPath
        ? 'Primary cluster is located in ap-southeast-1 (Jakarta).'
        : 'Sorry! Checking plain status report without JSON object.';
      return {
        id: 'mock-resp-1',
        model: req.model || 'gpt-4o',
        provider: 'swarm-mock',
        choices: [
          {
            message: { role: 'assistant', content: reply },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 28, completionTokens: 12, totalTokens: 40 },
      };
    },
  };

  const hotClient = new SinapsClient({
    providers: [swarmMockProvider],
    personas: personaRegistry,
    clusteredCache: { similarityThreshold: 0.6, k: 2 },
    hooks: {
      onSemanticCacheHit: (_req, _res, similarity) => {
        console.log(
          `  [HOOK onSemanticCacheHit] Cluster hit at similarity=${similarity.toFixed(3)}`,
        );
      },
      onKvCachePartition: (partition) => {
        console.log(
          `  [HOOK onKvCachePartition] Cache-eligible=${partition.cacheEligible}, staticPrefixTokens=${partition.staticPrefixTokens}`,
        );
      },
    },
  });

  const swarm = hotClient.swarm({
    agents: [
      {
        id: 'sec-agent',
        name: 'SecOps',
        role: 'Zero-Trust Security Auditor',
        instructions: 'Perform a quick security check.',
        personaId: 'sec-auditor',
      },
    ],
    onPersonaDrift: (agentId, personaId, drift) => {
      console.log(
        `  [DRIFT DETECTED] agent=${agentId}, persona=${personaId}, score=${drift.score}, violations=${drift.violations.length}`,
      );
    },
  });

  const swarmResult = await swarm.run({
    task: 'Audit database TLS configuration.',
  });
  console.log(
    '  Pruned ephemeral skills:',
    JSON.stringify(swarmResult.prunedEphemeralSkills),
  );
  console.log(
    '  Persona drift summary:',
    JSON.stringify(swarmResult.personaDrift),
    '\n',
  );

  // =========================================================================
  // PILLAR 4: Unified Hot-Path (useBrain + pinKvCache + ClusteredCache + OTel)
  // =========================================================================
  console.log('--- 4. Unified Hot-Path Pipeline & Auto-OTel Spans ---');
  hotClient.clearRecordedSpans();
  await hotClient.brain.rememberFact(
    'Cluster primary region is ap-southeast-1 (Jakarta).',
  );

  const firstRes = await hotClient.chat.completions.create({
    model: 'gpt-4o',
    useBrain: true,
    useClusteredCache: true,
    pinKvCache: true,
    messages: [
      {
        role: 'system',
        content: 'You are an SRE copilot. Current time: 2026-11-15T12:00:00Z.',
      },
      { role: 'user', content: 'Where is the cluster primary region located?' },
    ],
  });
  console.log(`  Call 1 response: ${firstRes.choices[0].message.content}`);

  const secondRes = await hotClient.chat.completions.create({
    model: 'gpt-4o',
    useBrain: true,
    useClusteredCache: true,
    pinKvCache: true,
    messages: [
      {
        role: 'system',
        content: 'You are an SRE copilot. Current time: 2026-11-15T12:00:00Z.',
      },
      { role: 'user', content: 'Where is the primary region for the cluster?' },
    ],
  });
  console.log(`  Call 2 response: ${secondRes.choices[0].message.content}`);

  const recordedSpans = hotClient.getRecordedSpans();
  const otelPayload = hotClient.toOtelTraces();
  console.log(
    `  Auto-recorded GenAiSpans: ${recordedSpans.length} | OTLP exported spans: ${otelPayload.resourceSpans[0]?.scopeSpans[0]?.spans.length ?? 0}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
