import type { IncidentEvent, InvestigationReport } from '@investigation-ai/shared-types';

export interface IntakeWebhookRequest {
  source: 'pagerduty';
  incident: IncidentEvent;
}

export interface InitInvestigationRequest {
  incident: IncidentEvent;
}

export interface PlanInvestigationRequest {
  incidentId: string;
}

export interface ExecuteInvestigationRequest {
  incidentId: string;
  stepIds: string[];
}

export interface EvaluateInvestigationRequest {
  incidentId: string;
  evidenceIds: string[];
}

export interface FinalizeInvestigationRequest {
  report: InvestigationReport;
}
