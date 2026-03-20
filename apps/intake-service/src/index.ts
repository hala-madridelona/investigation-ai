import type { IncidentEvent } from '@investigation-ai/shared-types';
import type { IntakeWebhookRequest } from '@investigation-ai/workflow-contracts';

export interface IntakeServiceContext {
  receivedAt: string;
  source: 'pagerduty';
}

export const createIntakeContext = (
  payload: IntakeWebhookRequest,
): IntakeServiceContext => ({
  receivedAt: new Date().toISOString(),
  source: payload.source,
});

export const normalizeIncidentEvent = (
  payload: IntakeWebhookRequest,
): IncidentEvent => ({
  incidentId: payload.incident.id,
  title: payload.incident.title,
  severity: payload.incident.severity,
});
