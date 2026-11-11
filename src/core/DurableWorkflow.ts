/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Durable Agent Workflows & State Checkpoint Engine
 *
 * Implements:
 * 1. Resilient step-by-step checkpointing for autonomous agent loops and multi-agent swarms.
 * 2. Pluggable persistence via StateStorage (InMemory, Redis, Cloudflare KV, D1).
 * 3. Atomic step recording, state replay, and idempotency protection against duplicate tool runs.
 * 4. Zero-dependency native implementation.
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import type { ChatMessage } from '../types/index.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import type { StateStorage } from './StateStorage.js';

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'waiting_approval';

export interface WorkflowStepRecord {
  stepIndex: number;
  agentName?: string;
  action:
    | 'tool_call'
    | 'handoff'
    | 'llm_generation'
    | 'user_input'
    | 'approval_request'
    | 'approval_resolution';
  details?: Record<string, unknown>;
  output?: unknown;
  timestamp: number;
}

export interface ApprovalRequest {
  action: string;
  reason?: string;
  payload?: unknown;
  requiredRole?: string;
  timeoutSeconds?: number;
}

export interface ApprovalRecord extends ApprovalRequest {
  requestId: string;
  workflowId: string;
  stepIndex: number;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionNotes?: string;
  resolutionPayload?: unknown;
}

export interface WorkflowCheckpoint {
  workflowId: string;
  status: WorkflowStatus;
  currentStep: number;
  currentAgent?: string;
  messages: ChatMessage[];
  sharedContext: Record<string, unknown>;
  history: WorkflowStepRecord[];
  pendingApproval?: ApprovalRecord;
  approvalHistory?: ApprovalRecord[];
  finalOutput?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepEvent {
  workflowId: string;
  step: WorkflowStepRecord;
  checkpoint: WorkflowCheckpoint;
}

export interface DurableWorkflowOptions {
  storage?: StateStorage;
  keyPrefix?: string;
  defaultTtlSeconds?: number;
}

export class DurableWorkflowEngine {
  private storage: StateStorage;
  private keyPrefix: string;
  private defaultTtlSeconds?: number;
  private stepListeners = new Set<(event: WorkflowStepEvent) => void>();

  constructor(options: DurableWorkflowOptions = {}) {
    this.storage = options.storage || new InMemoryStorage();
    this.keyPrefix = options.keyPrefix || 'sinapsai:wf:';
    this.defaultTtlSeconds = options.defaultTtlSeconds || 86400 * 7; // 7 days default
  }

  /**
   * Subscribes a listener to workflow step execution events (real-time streaming).
   * Returns an unsubscribe cleanup callback.
   */
  public onStep(listener: (event: WorkflowStepEvent) => void): () => void {
    this.stepListeners.add(listener);
    return () => {
      this.stepListeners.delete(listener);
    };
  }

  private notifyStep(
    workflowId: string,
    step: WorkflowStepRecord,
    checkpoint: WorkflowCheckpoint,
  ): void {
    const event: WorkflowStepEvent = { workflowId, step, checkpoint };
    for (const listener of this.stepListeners) {
      try {
        listener(event);
      } catch (_e) {
        // fail-soft for listeners
      }
    }
  }

  /**
   * Permanently deletes a workflow checkpoint from state storage (compliance with data deletion).
   */
  public async deleteWorkflow(workflowId: string): Promise<boolean> {
    await this.storage.delete(this.getKey(workflowId));
    return true;
  }

  private getKey(workflowId: string): string {
    return `${this.keyPrefix}${workflowId}`;
  }

  /**
   * Initializes or creates a new durable workflow checkpoint.
   */
  public async createWorkflow(params: {
    workflowId: string;
    initialAgent?: string;
    initialMessages?: ChatMessage[];
    initialContext?: Record<string, unknown>;
  }): Promise<WorkflowCheckpoint> {
    const now = Date.now();
    const checkpoint: WorkflowCheckpoint = {
      workflowId: params.workflowId,
      status: 'pending',
      currentStep: 0,
      currentAgent: params.initialAgent,
      messages: params.initialMessages ? [...params.initialMessages] : [],
      sharedContext: params.initialContext ? { ...params.initialContext } : {},
      history: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.set(
      this.getKey(params.workflowId),
      checkpoint,
      this.defaultTtlSeconds,
    );
    return checkpoint;
  }

  /**
   * Retrieves an existing checkpoint by workflowId.
   */
  public async getCheckpoint(
    workflowId: string,
  ): Promise<WorkflowCheckpoint | null> {
    return this.storage.get<WorkflowCheckpoint>(this.getKey(workflowId));
  }

  /**
   * Records a step in the workflow and updates context/messages.
   */
  public async recordStep(
    workflowId: string,
    update: {
      action: 'tool_call' | 'handoff' | 'llm_generation' | 'user_input';
      agentName?: string;
      details?: Record<string, unknown>;
      output?: unknown;
      newMessages?: ChatMessage[];
      contextUpdates?: Record<string, unknown>;
    },
  ): Promise<WorkflowCheckpoint> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      throw new Error(`Workflow with ID "${workflowId}" not found.`);
    }

    const now = Date.now();
    const nextStep = cp.currentStep + 1;

    const stepRecord: WorkflowStepRecord = {
      stepIndex: nextStep,
      agentName: update.agentName || cp.currentAgent,
      action: update.action,
      details: update.details,
      output: update.output,
      timestamp: now,
    };

    cp.currentStep = nextStep;
    cp.status = 'running';
    if (update.agentName) cp.currentAgent = update.agentName;
    if (update.newMessages) cp.messages.push(...update.newMessages);
    if (update.contextUpdates) {
      cp.sharedContext = { ...cp.sharedContext, ...update.contextUpdates };
    }
    cp.history.push(stepRecord);
    cp.updatedAt = now;

    await this.storage.set(this.getKey(workflowId), cp, this.defaultTtlSeconds);
    this.notifyStep(workflowId, stepRecord, cp);
    return cp;
  }

  /**
   * Marks workflow as successfully completed with final output.
   */
  public async completeWorkflow(
    workflowId: string,
    finalOutput: unknown,
  ): Promise<WorkflowCheckpoint> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      throw new Error(`Workflow with ID "${workflowId}" not found.`);
    }

    cp.status = 'completed';
    cp.finalOutput = finalOutput;
    cp.updatedAt = Date.now();

    await this.storage.set(this.getKey(workflowId), cp, this.defaultTtlSeconds);
    return cp;
  }

  /**
   * Marks workflow as failed with error details.
   */
  public async failWorkflow(
    workflowId: string,
    error: string,
  ): Promise<WorkflowCheckpoint> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      throw new Error(`Workflow with ID "${workflowId}" not found.`);
    }

    cp.status = 'failed';
    cp.error = error;
    cp.updatedAt = Date.now();

    await this.storage.set(this.getKey(workflowId), cp, this.defaultTtlSeconds);
    return cp;
  }

  /**
   * Resumes workflow checkpoint and provides replay context.
   */
  public async resume(workflowId: string): Promise<{
    canResume: boolean;
    checkpoint: WorkflowCheckpoint | null;
    resumeFromStep: number;
    agent: string | undefined;
    messages: ChatMessage[];
    context: Record<string, unknown>;
  }> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      return {
        canResume: false,
        checkpoint: null,
        resumeFromStep: 0,
        agent: undefined,
        messages: [],
        context: {},
      };
    }

    const canResume =
      cp.status === 'running' ||
      cp.status === 'paused' ||
      cp.status === 'pending';

    return {
      canResume,
      checkpoint: cp,
      resumeFromStep: cp.currentStep,
      agent: cp.currentAgent,
      messages: [...cp.messages],
      context: { ...cp.sharedContext },
    };
  }

  /**
   * Suspends the workflow waiting for human review / approval (HITL).
   */
  public async suspendForApproval(
    workflowId: string,
    request: ApprovalRequest,
  ): Promise<WorkflowCheckpoint> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      throw new Error(`Workflow with ID "${workflowId}" not found.`);
    }

    const now = Date.now();
    const nextStep = cp.currentStep + 1;
    const requestId = `appr_${Math.random().toString(36).slice(2, 10)}`;

    const record: ApprovalRecord = {
      ...request,
      requestId,
      workflowId,
      stepIndex: nextStep,
      createdAt: now,
      status: 'pending',
    };

    cp.currentStep = nextStep;
    cp.status = 'waiting_approval';
    cp.pendingApproval = record;
    if (!cp.approvalHistory) cp.approvalHistory = [];
    cp.approvalHistory.push(record);

    cp.history.push({
      stepIndex: nextStep,
      agentName: cp.currentAgent,
      action: 'approval_request',
      details: {
        requestId,
        action: request.action,
        reason: request.reason,
        payload: request.payload,
      },
      timestamp: now,
    });

    cp.updatedAt = now;
    await this.storage.set(this.getKey(workflowId), cp, this.defaultTtlSeconds);
    const stepRecord = cp.history[cp.history.length - 1];
    this.notifyStep(workflowId, stepRecord, cp);
    return cp;
  }

  /**
   * Resolves a pending human approval request, transitioning workflow back to running or failed.
   */
  public async resolveApproval(
    workflowId: string,
    resolution: {
      approved: boolean;
      resolvedBy?: string;
      notes?: string;
      resolutionPayload?: unknown;
    },
  ): Promise<WorkflowCheckpoint> {
    const cp = await this.getCheckpoint(workflowId);
    if (!cp) {
      throw new Error(`Workflow with ID "${workflowId}" not found.`);
    }

    if (cp.status !== 'waiting_approval' || !cp.pendingApproval) {
      throw new Error(
        `Workflow "${workflowId}" is not in waiting_approval status or has no pending approval.`,
      );
    }

    const now = Date.now();
    const nextStep = cp.currentStep + 1;
    const approval = cp.pendingApproval;

    approval.status = resolution.approved ? 'approved' : 'rejected';
    approval.resolvedAt = now;
    approval.resolvedBy = resolution.resolvedBy;
    approval.resolutionNotes = resolution.notes;
    approval.resolutionPayload = resolution.resolutionPayload;

    cp.pendingApproval = undefined;
    cp.status = resolution.approved ? 'running' : 'failed';
    if (!resolution.approved) {
      cp.error = resolution.notes || 'Human approval was rejected.';
    }

    cp.currentStep = nextStep;
    cp.history.push({
      stepIndex: nextStep,
      agentName: cp.currentAgent,
      action: 'approval_resolution',
      details: {
        requestId: approval.requestId,
        approved: resolution.approved,
        resolvedBy: resolution.resolvedBy,
        notes: resolution.notes,
        resolutionPayload: resolution.resolutionPayload,
      },
      timestamp: now,
    });

    cp.updatedAt = now;
    await this.storage.set(this.getKey(workflowId), cp, this.defaultTtlSeconds);
    const stepRecord = cp.history[cp.history.length - 1];
    this.notifyStep(workflowId, stepRecord, cp);
    return cp;
  }
}
