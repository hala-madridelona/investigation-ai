import type {
  FinalReport,
  Incident,
  IncidentEvent,
  InvestigationState,
  JsonObject,
  PlanStep,
} from '@investigation-ai/shared-types';

export const workflowFriendlyStatuses = [
  'continue',
  'stop',
  'retry',
  'needs_human_review',
] as const;
export type WorkflowFriendlyStatus = (typeof workflowFriendlyStatuses)[number];

export const workflowTerminalStates = [
  'completed',
  'failed',
  'needs_human_review',
  'cancelled',
] as const;
export type WorkflowTerminalState = (typeof workflowTerminalStates)[number];

export const workflowRetryClassifications = [
  'none',
  'transport',
  'upstream_dependency',
  'rate_limited',
  'concurrency_conflict',
  'internal',
] as const;
export type WorkflowRetryClassification =
  (typeof workflowRetryClassifications)[number];

export interface WorkflowRetryPolicy {
  maxAttempts: number;
  initialDelaySeconds: number;
  maxDelaySeconds: number;
  multiplier: number;
  retryableErrors: WorkflowRetryClassification[];
}

export interface WorkflowTimeoutPolicy {
  requestTimeoutSeconds: number;
  overallTimeoutSeconds: number;
}

export interface WorkflowIdempotency {
  key: string;
  scope: 'workflow' | 'phase';
  replayed: boolean;
}

export interface WorkflowFailureDetail {
  code: string;
  message: string;
  retryable: boolean;
  classification: WorkflowRetryClassification;
  details?: JsonObject;
}

export interface WorkflowWarning {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: JsonObject;
}

export interface WorkflowPartialFailure {
  affectedStepIds: string[];
  failedDependencyCount: number;
  handling: 'degraded_continue' | 'retry_phase' | 'needs_human_review';
  warnings: WorkflowWarning[];
}

export interface WorkflowControl {
  status: WorkflowFriendlyStatus;
  nextPhase: '/plan' | '/execute' | '/evaluate' | '/finalize' | null;
  terminalState?: WorkflowTerminalState;
  reason: string;
  retryPolicy: WorkflowRetryPolicy;
  timeoutPolicy: WorkflowTimeoutPolicy;
  idempotency: WorkflowIdempotency;
  partialFailure?: WorkflowPartialFailure;
}

export interface WorkflowRequestContext {
  requestId: string;
  workflowExecutionId: string;
  correlationId: string;
  correlationIds?: string[];
  idempotencyKey: string;
  attempt: number;
  requestedAt: string;
  deadlineAt: string;
}

export interface WorkflowResponseMetadata {
  requestId: string;
  workflowExecutionId: string;
  correlationId: string;
  correlationIds?: string[];
  generatedAt: string;
  durationMs?: number;
}

export interface IntakeWebhookRequest {
  source: 'pagerduty';
  incident: IncidentEvent;
  dedupKey?: string;
  occurredAt?: string;
  payload?: JsonObject;
}

export interface WorkflowTrigger {
  workflow: 'investigation';
  action: 'start';
  incidentId: string;
  requestedAt: string;
  dedupKey?: string;
}

export interface WorkflowInput {
  trigger: WorkflowTrigger;
  incident: Incident;
  context: {
    source: 'intake-service';
    receivedAt: string;
    requestId: string;
    correlationIds?: string[];
    idempotencyKey: string;
    retryPolicy: WorkflowRetryPolicy;
    timeoutPolicy: WorkflowTimeoutPolicy;
  };
}

export interface IntakeWebhookResponse {
  accepted: true;
  incident: Incident;
  workflowInput: WorkflowInput;
  workflowTrigger: WorkflowTrigger;
  metadata: {
    receivedAt: string;
    source: 'pagerduty';
    requestId: string;
    correlationIds: string[];
  };
}

export interface InitInvestigationRequest {
  context: WorkflowRequestContext;
  incident: Incident;
}

export interface InitInvestigationResponse {
  phase: 'init';
  incidentId: string;
  state: InvestigationState;
  control: WorkflowControl;
  metadata: WorkflowResponseMetadata;
}

export interface PlanInvestigationRequest {
  context: WorkflowRequestContext;
  incidentId: string;
  maxSteps?: number;
}

export interface PlanInvestigationResponse {
  phase: 'plan';
  incidentId: string;
  state: InvestigationState;
  steps: PlanStep[];
  control: WorkflowControl;
  metadata: WorkflowResponseMetadata;
}

export interface ExecuteInvestigationRequest {
  context: WorkflowRequestContext;
  incidentId: string;
  stepIds: string[];
}

export interface ExecuteInvestigationResponse {
  phase: 'execute';
  incidentId: string;
  state: InvestigationState;
  executedStepIds: string[];
  control: WorkflowControl;
  metadata: WorkflowResponseMetadata;
}

export interface EvaluateInvestigationRequest {
  context: WorkflowRequestContext;
  incidentId: string;
  evidenceIds: string[];
}

export interface EvaluateInvestigationResponse {
  phase: 'evaluate';
  incidentId: string;
  state: InvestigationState;
  findingsSummary: {
    count: number;
    summaries: string[];
  };
  control: WorkflowControl;
  metadata: WorkflowResponseMetadata;
}

export interface FinalizeInvestigationRequest {
  context: WorkflowRequestContext;
  incidentId: string;
}

export interface FinalizeInvestigationResponse {
  phase: 'finalize';
  incidentId: string;
  report: FinalReport;
  state: InvestigationState;
  completed: true;
  control: WorkflowControl;
  metadata: WorkflowResponseMetadata;
}

export const defaultWorkflowRetryPolicy: WorkflowRetryPolicy = {
  maxAttempts: 3,
  initialDelaySeconds: 5,
  maxDelaySeconds: 60,
  multiplier: 2,
  retryableErrors: [
    'transport',
    'upstream_dependency',
    'rate_limited',
    'concurrency_conflict',
    'internal',
  ],
};

export const defaultWorkflowTimeoutPolicy: WorkflowTimeoutPolicy = {
  requestTimeoutSeconds: 30,
  overallTimeoutSeconds: 900,
};
