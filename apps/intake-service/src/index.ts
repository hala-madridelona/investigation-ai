import { eq } from 'drizzle-orm';

import { createDatabaseClientFromEnv, incidents } from '@investigation-ai/db';
import {
  asObject,
  asOptionalString,
  asString,
  createRecordMetadata,
  createService,
  loadConfig,
  RequestValidationError,
  sendJson,
  type Route,
} from '@investigation-ai/service-runtime';
import {
  incidentStatuses,
  severities,
  type Incident,
  type JsonObject,
} from '@investigation-ai/shared-types';
import type {
  IntakeWebhookRequest,
  IntakeWebhookResponse,
  WorkflowInput,
  WorkflowTrigger,
} from '@investigation-ai/workflow-contracts';
import {
  defaultWorkflowRetryPolicy,
  defaultWorkflowTimeoutPolicy,
} from '@investigation-ai/workflow-contracts';

const config = loadConfig(process.env, 3001);
const database = createDatabaseClientFromEnv(process.env);

const validateIntakeWebhook = (input: unknown): IntakeWebhookRequest => {
  const payload = asObject(input);
  const incidentInput = asObject(payload.incident);
  const severity = asString(
    incidentInput.severity,
    'incident.severity',
  ) as Incident['severity'];
  const status = (
    incidentInput.status === undefined
      ? 'pending'
      : asString(incidentInput.status, 'incident.status')
  ) as Incident['status'];

  if (!severities.includes(severity)) {
    throw new RequestValidationError(
      'incident.severity must be one of critical, high, medium, low',
    );
  }
  if (!incidentStatuses.includes(status)) {
    throw new RequestValidationError(
      'incident.status must be one of pending, running, completed, failed',
    );
  }

  return {
    source: asString(payload.source, 'source') as 'pagerduty',
    dedupKey: asOptionalString(payload.dedupKey, 'dedupKey'),
    occurredAt: asOptionalString(payload.occurredAt, 'occurredAt'),
    payload:
      payload.payload &&
      typeof payload.payload === 'object' &&
      !Array.isArray(payload.payload)
        ? (payload.payload as JsonObject)
        : undefined,
    incident: {
      id: asString(incidentInput.id, 'incident.id'),
      externalId: asOptionalString(
        incidentInput.externalId,
        'incident.externalId',
      ),
      title: asString(incidentInput.title, 'incident.title'),
      status,
      severity,
      serviceName: asString(incidentInput.serviceName, 'incident.serviceName'),
      summary: asOptionalString(incidentInput.summary, 'incident.summary'),
      payload:
        incidentInput.payload &&
        typeof incidentInput.payload === 'object' &&
        !Array.isArray(incidentInput.payload)
          ? (incidentInput.payload as JsonObject)
          : {},
      entities: [],
    },
  };
};

const normalizeIncident = (payload: IntakeWebhookRequest): Incident => ({
  externalId: payload.incident.externalId ?? payload.incident.id!,
  title: payload.incident.title.trim(),
  status: payload.incident.status ?? 'pending',
  severity: payload.incident.severity,
  serviceName: payload.incident.serviceName.trim(),
  ...(payload.incident.summary
    ? { summary: payload.incident.summary.trim() }
    : {}),
  payload: {
    ...(payload.incident.payload ?? {}),
    pagerDuty: payload.payload ?? {},
    dedupKey: payload.dedupKey ?? null,
    occurredAt: payload.occurredAt ?? null,
  },
  entities: payload.incident.entities ?? [],
});

const buildWorkflowTrigger = (
  incidentId: string,
  dedupKey?: string,
): WorkflowTrigger => ({
  workflow: 'investigation',
  action: 'start',
  incidentId,
  requestedAt: new Date().toISOString(),
  ...(dedupKey ? { dedupKey } : {}),
});

const buildWorkflowInput = (
  incident: Incident,
  workflowTrigger: WorkflowTrigger,
  requestId: string,
  correlationIds: string[],
  dedupKey?: string,
): WorkflowInput => ({
  trigger: workflowTrigger,
  incident,
  context: {
    source: 'intake-service',
    receivedAt: new Date().toISOString(),
    requestId,
    correlationIds,
    idempotencyKey: `workflow:investigation:${incident.id!}:${dedupKey ?? workflowTrigger.requestedAt}`,
    retryPolicy: defaultWorkflowRetryPolicy,
    timeoutPolicy: defaultWorkflowTimeoutPolicy,
  },
});

createService(
  {
    serviceName: 'intake-service',
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
  },
  [
    {
      method: 'POST',
      path: '/webhooks/pagerduty',
      validate: validateIntakeWebhook,
      handler: async ({
        body: request,
        res,
        requestId,
        logger,
        observability,
      }) => {
        const normalized = normalizeIncident(request);
        const incidentMetadata = createRecordMetadata({
          actor: observability.actor,
          source: { ...observability.source, id: request.source },
          correlationIds: observability.correlationIds,
        });
        const requestLogger = logger.child({
          incidentId: normalized.externalId,
        });
        const existing = await database.client.query.incidents.findFirst({
          where: eq(incidents.externalId, normalized.externalId),
        });

        const persistedIncident = existing
          ? (
              await database.client
                .update(incidents)
                .set({
                  title: normalized.title,
                  severity: normalized.severity,
                  status: normalized.status,
                  serviceName: normalized.serviceName,
                  payload: normalized.payload,
                  metadata: incidentMetadata as unknown as Record<
                    string,
                    unknown
                  >,
                  updatedAt: new Date(),
                })
                .where(eq(incidents.id, existing.id))
                .returning()
            )[0]
          : (
              await database.client
                .insert(incidents)
                .values({
                  externalId: normalized.externalId,
                  title: normalized.title,
                  severity: normalized.severity,
                  status: normalized.status,
                  serviceName: normalized.serviceName,
                  payload: normalized.payload,
                  metadata: incidentMetadata as unknown as Record<
                    string,
                    unknown
                  >,
                })
                .returning()
            )[0];

        requestLogger.info('intake.accepted', {
          requestId,
          incidentId: persistedIncident.id,
          externalId: persistedIncident.externalId,
          source: request.source,
        });

        const incident: Incident = {
          ...normalized,
          id: persistedIncident.id,
          createdAt: persistedIncident.createdAt.toISOString(),
          updatedAt: persistedIncident.updatedAt.toISOString(),
        };
        const workflowTrigger = buildWorkflowTrigger(
          persistedIncident.id,
          request.dedupKey,
        );

        const response: IntakeWebhookResponse = {
          accepted: true,
          incident,
          workflowInput: buildWorkflowInput(
            incident,
            workflowTrigger,
            requestId,
            observability.correlationIds,
            request.dedupKey,
          ),
          workflowTrigger,
          metadata: {
            receivedAt: new Date().toISOString(),
            source: 'pagerduty',
            requestId,
            correlationIds: observability.correlationIds,
          },
        };

        sendJson(res, 202, response);
      },
    } satisfies Route<IntakeWebhookRequest>,
  ],
);
