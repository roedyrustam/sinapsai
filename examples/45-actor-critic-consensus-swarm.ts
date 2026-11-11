/**
 * Example 45: Actor-Critic Self-Correcting Consensus Swarm & Streaming Durable Workflows
 *
 * Demonstrates:
 * 1. Actor-Critic self-correcting feedback loops between worker and reviewer specialist agents.
 * 2. Automated revision iterations guided by objective rubric scores until approval.
 * 3. Real-time durable workflow event streaming with live onStep listeners and checkpoint deletion.
 */

import {
  type CreateChatCompletionRequest,
  DurableWorkflowEngine,
  type Provider,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== 1. Actor-Critic Consensus Swarm Demo ===\n');

  let callCount = 0;
  const mockProvider: Provider = {
    id: 'mock-llm',
    name: 'Mock LLM Provider',
    generateContent: async (_req: CreateChatCompletionRequest) => {
      callCount++;
      // Iteration 1: Actor draft (has a bug)
      if (callCount === 1) {
        return {
          id: 'res-actor-1',
          model: 'mock',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'def calculate_tax(income):\n    return income * 0.50 # initial draft',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      // Iteration 1: Critic review (requests revision)
      if (callCount === 2) {
        return {
          id: 'res-critic-1',
          model: 'mock',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'STATUS: NEEDS_REVISION\nSCORE: 0.4\nCRITIQUE: 50% flat tax is too high. Implement progressive tax brackets (10% under 50k, 20% over 50k).',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      // Iteration 2: Actor revised draft (fixed according to critique)
      if (callCount === 3) {
        return {
          id: 'res-actor-2',
          model: 'mock',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'def calculate_tax(income):\n    if income <= 50000:\n        return income * 0.10\n    return 5000 + (income - 50000) * 0.20',
              },
              finishReason: 'stop',
            },
          ],
        };
      }
      // Iteration 2: Critic review (approves)
      return {
        id: 'res-critic-2',
        model: 'mock',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                'STATUS: APPROVED\nSCORE: 0.95\nCRITIQUE: Excellent progressive tax bracket calculation.',
            },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  const client = new SinapsClient({
    providers: [mockProvider],
  });

  const swarm = client.swarm({
    agents: [
      {
        id: 'tax_coder',
        name: 'Senior Tax Software Engineer',
        role: 'Implementer',
        instructions: 'Write accurate financial tax calculation functions.',
      },
      {
        id: 'tax_auditor',
        name: 'Principal Tax Auditor',
        role: 'Reviewer',
        instructions: 'Rigorously audit financial logic against tax codes.',
      },
    ],
  });

  console.log('Running Actor-Critic Loop between [tax_coder] and [tax_auditor]...');

  const result = await swarm.runActorCritic({
    actorAgentId: 'tax_coder',
    criticAgentId: 'tax_auditor',
    task: 'Write a Python function calculate_tax(income) supporting progressive tax brackets.',
    maxRevisions: 3,
    minScore: 0.8,
    onIteration: (ev) => {
      console.log(`\n--- Iteration ${ev.iteration} ---`);
      console.log(`Score: ${ev.score ?? 'N/A'}`);
      console.log(`Approved: ${ev.approved}`);
      console.log(`Critic Feedback: ${ev.criticFeedback}`);
    },
  });

  console.log('\n=== Actor-Critic Result ===');
  console.log(`Approved: ${result.approved}`);
  console.log(`Total Revisions: ${result.totalRevisions}`);
  console.log(`Final Output:\n${result.finalContent}`);

  console.log('\n=== 2. Streaming Durable Workflows Demo ===\n');
  const engine = new DurableWorkflowEngine();

  const unsubscribe = engine.onStep((ev) => {
    console.log(`[LIVE STREAM] Workflow: ${ev.workflowId} | Action: ${ev.step.action} (Step #${ev.step.stepIndex})`);
  });

  await engine.createWorkflow({
    workflowId: 'payroll_run_001',
    initialAgent: 'PayrollWorker',
  });

  await engine.recordStep('payroll_run_001', {
    action: 'tool_call',
    details: { function: 'calculate_tax' },
    output: { netPay: 42000 },
  });

  await engine.suspendForApproval('payroll_run_001', {
    action: 'disburse_funds',
    reason: 'Monthly payroll disbursement exceeds $25,000 threshold',
  });

  unsubscribe();

  // Test compliance cleanup
  await engine.deleteWorkflow('payroll_run_001');
  console.log('Checkpoint purged in compliance with data privacy regulations.');

  console.log('\n✅ Actor-Critic Swarm and Streaming Durable Workflows validated successfully.');
}

main().catch(console.error);
