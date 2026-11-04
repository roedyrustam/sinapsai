import { describe, expect, it } from 'vitest';
import { DurableWorkflowEngine } from './DurableWorkflow.js';
import { InMemoryStorage } from './InMemoryStorage.js';

describe('Durable Agent Workflows & State Checkpoint Engine', () => {
  it('should initialize, record steps, and complete a workflow', async () => {
    const storage = new InMemoryStorage();
    const engine = new DurableWorkflowEngine({ storage });

    const cp = await engine.createWorkflow({
      workflowId: 'order_123',
      initialAgent: 'SalesAgent',
      initialMessages: [
        { role: 'user', content: 'I want to purchase a laptop.' },
      ],
      initialContext: { budget: 1500 },
    });

    expect(cp.status).toBe('pending');
    expect(cp.currentStep).toBe(0);
    expect(cp.currentAgent).toBe('SalesAgent');

    // Record Step 1: Tool Call
    const step1 = await engine.recordStep('order_123', {
      action: 'tool_call',
      details: { tool: 'searchInventory', item: 'laptop' },
      output: { inStock: true, price: 1200 },
      newMessages: [{ role: 'assistant', content: 'Checking inventory...' }],
      contextUpdates: { selectedItemPrice: 1200 },
    });

    expect(step1.currentStep).toBe(1);
    expect(step1.status).toBe('running');
    expect(step1.sharedContext.selectedItemPrice).toBe(1200);
    expect(step1.history.length).toBe(1);

    // Record Step 2: Handoff to PaymentAgent
    const step2 = await engine.recordStep('order_123', {
      action: 'handoff',
      agentName: 'PaymentAgent',
      details: { reason: 'Process credit card charge' },
    });

    expect(step2.currentStep).toBe(2);
    expect(step2.currentAgent).toBe('PaymentAgent');

    // Complete workflow
    const completed = await engine.completeWorkflow('order_123', {
      receiptId: 'rcpt_999',
      status: 'paid',
    });

    expect(completed.status).toBe('completed');
    expect((completed.finalOutput as { receiptId: string }).receiptId).toBe(
      'rcpt_999',
    );
  });

  it('should support resuming interrupted workflows', async () => {
    const storage = new InMemoryStorage();
    const engine = new DurableWorkflowEngine({ storage });

    await engine.createWorkflow({
      workflowId: 'agent_run_456',
      initialAgent: 'ResearchAgent',
      initialMessages: [
        { role: 'user', content: 'Analyze competitor AI models.' },
      ],
    });

    await engine.recordStep('agent_run_456', {
      action: 'tool_call',
      output: 'Competitor A uses mixture-of-experts.',
    });

    // Simulate process recovery
    const resumeState = await engine.resume('agent_run_456');
    expect(resumeState.canResume).toBe(true);
    expect(resumeState.resumeFromStep).toBe(1);
    expect(resumeState.agent).toBe('ResearchAgent');
    expect(resumeState.messages.length).toBe(1);
  });
});
