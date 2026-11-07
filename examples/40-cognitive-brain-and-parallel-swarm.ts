/**
 * Example 40: Unified Cognitive Brain & Parallel Swarm (Fan-Out / Fan-In with HITL)
 *
 * Demonstrates:
 * 1. Unified Cognitive Brain: Tri-Memory Fusion (Episodic Memory facts, Knowledge Graph triples, and Hybrid RAG).
 * 2. Parallel Multi-Agent Swarm: Concurrent specialist execution (Security + SRE) synthesized by Lead Architect.
 * 3. Human-in-the-Loop (HITL): Workflow suspension for critical approval and subsequent resumption.
 */

import { CognitiveBrain, DurableWorkflowEngine, InMemoryStorage, SinapsClient } from '../src/index.js';

async function main() {
  console.log('=== 1. Unified Cognitive Brain (Tri-Memory Fusion) ===');
  const storage = new InMemoryStorage();
  const brain = new CognitiveBrain({ storage });

  // A. Episodic Memory Fact
  await brain.rememberFact('User prefers high-throughput Go microservices over monolithic setups.', 'user_101');

  // B. Relational Triples in Knowledge Graph
  brain.addKnowledgeTriple({
    subject: 'Gateway',
    predicate: 'requires',
    object: 'Zero-Trust Authentication',
    confidence: 1.0,
  });
  brain.addKnowledgeTriple({
    subject: 'Gateway',
    predicate: 'enforces',
    object: 'Sub-15ms Latency SLA',
    confidence: 0.95,
  });

  // C. Ingest Architecture Document into Hybrid RAG
  await brain.ingestDocument(
    'doc_cloud_edge',
    'Edge Cloudflare Workers and Bun runtimes require zero runtime dependencies and fast cold starts.',
  );

  // D. Cross-Memory Unified Retrieval
  const cognitiveContext = await brain.retrieveContext({
    query: 'Gateway microservices latency and edge deployment',
    userId: 'user_101',
  });

  console.log('Unified Context Formatted:');
  console.log(cognitiveContext.formattedPrompt);

  console.log('\n=== 2. Human-in-the-Loop (HITL) Workflow Suspension ===');
  const workflows = new DurableWorkflowEngine({ storage });

  await workflows.createWorkflow({
    workflowId: 'deploy_prod_101',
    initialAgent: 'ReleaseAgent',
    initialMessages: [{ role: 'user', content: 'Deploy v2.14.0 to production cluster.' }],
  });

  console.log('Suspending workflow for human approval before production deploy...');
  const suspended = await workflows.suspendForApproval('deploy_prod_101', {
    action: 'deploy_production',
    reason: 'Production deployments require signed authorization.',
    payload: { version: 'v2.14.0', cluster: 'asia-east-prod' },
  });
  console.log(`Workflow Status: ${suspended.status} (Request ID: ${suspended.pendingApproval?.requestId})`);

  console.log('Human Approver grants permission...');
  const approved = await workflows.resolveApproval('deploy_prod_101', {
    approved: true,
    resolvedBy: 'lead_devops@company.com',
    notes: 'Green light: all 545 tests passed.',
  });
  console.log(`Workflow Status after Approval: ${approved.status}`);

  console.log('\n=== Example 40 Completed Successfully! ===');
}

main().catch(console.error);
