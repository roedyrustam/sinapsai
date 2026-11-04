/**
 * Example 38: Durable Agent Workflows & State Checkpointing
 *
 * Demonstrates:
 * 1. Initializing a durable workflow engine backed by StateStorage.
 * 2. Step-by-step recording of agent tool calls, handoffs, and context.
 * 3. Resuming interrupted workflows to prevent duplicate executions.
 */

import { DurableWorkflowEngine, InMemoryStorage } from '../src/index.js';

async function main() {
  const storage = new InMemoryStorage();
  const engine = new DurableWorkflowEngine({ storage });

  console.log('--- 1. Creating Workflow ---');
  await engine.createWorkflow({
    workflowId: 'wf_order_882',
    initialAgent: 'InventoryAgent',
    initialMessages: [{ role: 'user', content: 'Order 2 Enterprise Server Units.' }],
    initialContext: { customerTier: 'platinum' },
  });

  console.log('--- 2. Executing Step 1 (Tool Call) ---');
  await engine.recordStep('wf_order_882', {
    action: 'tool_call',
    details: { tool: 'checkStock', sku: 'SERVER-ENT-2U' },
    output: { available: 5, unitPrice: 4500 },
    contextUpdates: { totalCost: 9000 },
  });

  console.log('--- 3. Executing Step 2 (Agent Handoff) ---');
  await engine.recordStep('wf_order_882', {
    action: 'handoff',
    agentName: 'BillingAgent',
    details: { reason: 'Charge corporate invoicing account' },
  });

  console.log('--- 4. Simulating Process Crash & Recovery ---');
  const recovery = await engine.resume('wf_order_882');
  console.log(`Can Resume: ${recovery.canResume}`);
  console.log(`Resume from Step: ${recovery.resumeFromStep}`);
  console.log(`Current Active Agent: ${recovery.agent}`);
  console.log(`Preserved Context:`, recovery.context);

  console.log('--- 5. Completing Workflow ---');
  const finished = await engine.completeWorkflow('wf_order_882', {
    invoiceId: 'INV-2026-99',
    status: 'billed',
  });
  console.log(`Final Status: ${finished.status}`);
}

main().catch(console.error);

