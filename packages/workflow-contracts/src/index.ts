import type {
  FinalReport,
  Incident,
  IncidentEvent,
  InvestigationState,
  JsonObject,
  PlanStep,
} from '@investigation-ai/shared-types';

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

export interface IntakeWebhookResponse {
  accepted: true;
  incident: Incident;
  workflowTrigger: WorkflowTrigger;
  metadata: {
    receivedAt: string;
    source: 'pagerduty';
    requestId: string;
  };
}

export interface InitInvestigationRequest {
  incident: Incident;
}

export interface InitInvestigationResponse {
  phase: 'init';
  incidentId: string;
  state: InvestigationState;
  next: '/plan';
}

export interface PlanInvestigationRequest {
  incidentId: string;
  maxSteps?: number;
}

export interface PlanInvestigationResponse {
  phase: 'plan';
  incidentId: string;
  state: InvestigationState;
  steps: PlanStep[];
  next: '/execute';
}

export interface ExecuteInvestigationRequest {
  incidentId: string;
  stepIds: string[];
}

export interface ExecuteInvestigationResponse {
  phase: 'execute';
  incidentId: string;
  state: InvestigationState;
  executedStepIds: string[];
  next: '/evaluate';
}

export interface EvaluateInvestigationRequest {
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
  next: '/finalize';
}

export interface FinalizeInvestigationRequest {
  incidentId: string;
}

export interface FinalizeInvestigationResponse {
  phase: 'finalize';
  incidentId: string;
  report: FinalReport;
  state: InvestigationState;
  completed: true;
}
