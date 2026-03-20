import { eq } from 'drizzle-orm';

import { createDatabaseClient, incidents, investigationState, steps } from '@investigation-ai/db';
import {
  asObject,
  asString,
  asStringArray,
  createService,
  loadConfig,
  sendJson,
} from '@investigation-ai/service-runtime';
import type {
  FinalReport,
  Finding,
  Incident,
  InvestigationState,
  PlanStep,
} from '@investigation-ai/shared-types';
import type {
  EvaluateInvestigationRequest,
  EvaluateInvestigationResponse,
  ExecuteInvestigationRequest,
  ExecuteInvestigationResponse,
  FinalizeInvestigationRequest,
  FinalizeInvestigationResponse,
  InitInvestigationRequest,
  InitInvestigationResponse,
  PlanInvestigationRequest,
  PlanInvestigationResponse,
} from '@investigation-ai/workflow-contracts';

const config = loadConfig(process.env, 3002);
const database = createDatabaseClient({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? 'require' : undefined,
});

const validateInit = (input: unknown): InitInvestigationRequest => {
  const payload = asObject(input);
  const incident = asObject(payload.incident);
  return { incident: { id: asString(incident.id, 'incident.id') } as Incident };
};

const validatePlan = (input: unknown): PlanInvestigationRequest => {
  const payload = asObject(input);
  const rawMaxSteps = payload.maxSteps;
  if (rawMaxSteps !== undefined && (typeof rawMaxSteps !== 'number' || !Number.isInteger(rawMaxSteps) || rawMaxSteps <= 0)) {
    throw new Error('maxSteps must be a positive integer');
  }
  return { incidentId: asString(payload.incidentId, 'incidentId'), maxSteps: rawMaxSteps as number | undefined };
};

const validateExecute = (input: unknown): ExecuteInvestigationRequest => {
  const payload = asObject(input);
  return { incidentId: asString(payload.incidentId, 'incidentId'), stepIds: asStringArray(payload.stepIds ?? [], 'stepIds') };
};

const validateEvaluate = (input: unknown): EvaluateInvestigationRequest => {
  const payload = asObject(input);
  return { incidentId: asString(payload.incidentId, 'incidentId'), evidenceIds: asStringArray(payload.evidenceIds ?? [], 'evidenceIds') };
};

const validateFinalize = (input: unknown): FinalizeInvestigationRequest => {
  const payload = asObject(input);
  return { incidentId: asString(payload.incidentId, 'incidentId') };
};

const createDefaultPlan = (incidentId: string, maxSteps = 3): PlanStep[] =>
  [
    {
      id: `${incidentId}-collect-context`,
      title: 'Collect incident context',
      objective: 'Gather baseline metadata and recent changes.',
      rationale: 'Deterministic bootstrap step before tool integrations exist.',
      status: 'ready',
      dependsOn: [],
      toolRequestIds: [],
      targetEntityIds: [],
      stopIf: [],
    },
    {
      id: `${incidentId}-review-signals`,
      title: 'Review current signals',
      objective: 'Summarize known evidence and open questions.',
      rationale: 'Creates a stable handoff point for execution.',
      status: 'pending',
      dependsOn: [`${incidentId}-collect-context`],
      toolRequestIds: [],
      targetEntityIds: [],
      stopIf: [],
    },
    {
      id: `${incidentId}-prepare-report`,
      title: 'Prepare report draft',
      objective: 'Convert findings into a draft conclusion.',
      rationale: 'Ensures finalize has deterministic inputs.',
      status: 'pending',
      dependsOn: [`${incidentId}-review-signals`],
      toolRequestIds: [],
      targetEntityIds: [],
      stopIf: [],
    },
  ].slice(0, maxSteps);

const loadIncident = async (incidentId: string): Promise<Incident> => {
  const incident = await database.client.query.incidents.findFirst({ where: eq(incidents.id, incidentId) });
  if (!incident) {
    throw new Error(`Incident ${incidentId} not found`);
  }
  return {
    id: incident.id,
    externalId: incident.externalId,
    title: incident.title,
    status: incident.status,
    severity: incident.severity as Incident['severity'],
    serviceName: incident.serviceName,
    payload: incident.payload,
    entities: [],
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
};

const loadState = async (incidentId: string): Promise<InvestigationState | null> => {
  const record = await database.client.query.investigationState.findFirst({ where: eq(investigationState.incidentId, incidentId) });
  if (!record) return null;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  return {
    incidentId: record.incidentId,
    status: record.status,
    iterationCount: record.iterationCount,
    stagnationCount: record.stagnationCount,
    entities: Array.isArray(record.entities) ? (record.entities as InvestigationState['entities']) : [],
    findings: (metadata.findings as Finding[] | undefined) ?? [],
    plan: (metadata.plan as PlanStep[] | undefined) ?? [],
    steps: (metadata.steps as InvestigationState['steps'] | undefined) ?? [],
    lastToolResults: (metadata.lastToolResults as InvestigationState['lastToolResults'] | undefined) ?? [],
    lastSignals: Array.isArray(record.lastSignals) ? (record.lastSignals as InvestigationState['lastSignals']) : [],
    stopCondition: metadata.stopCondition as InvestigationState['stopCondition'] | undefined,
    metadata: metadata as InvestigationState['metadata'],
    updatedAt: record.updatedAt.toISOString(),
  };
};

const saveState = async (state: InvestigationState): Promise<void> => {
  const existing = await database.client.query.investigationState.findFirst({ where: eq(investigationState.incidentId, state.incidentId) });
  const values = {
    status: state.status,
    iterationCount: state.iterationCount,
    stagnationCount: state.stagnationCount,
    entities: state.entities,
    lastSignals: state.lastSignals,
    metadata: {
      ...(state.metadata ?? {}),
      findings: state.findings,
      plan: state.plan,
      steps: state.steps,
      lastToolResults: state.lastToolResults,
      stopCondition: state.stopCondition ?? null,
    },
    updatedAt: new Date(),
  };
  if (existing) {
    await database.client.update(investigationState).set(values).where(eq(investigationState.incidentId, state.incidentId));
    return;
  }
  await database.client.insert(investigationState).values({ incidentId: state.incidentId, ...values });
};

createService(
  { serviceName: 'investigation-engine', port: config.PORT, logLevel: config.LOG_LEVEL },
  [
    {
      method: 'POST',
      path: '/init',
      validate: validateInit,
      handler: async ({ body, res }) => {
        const incident = await loadIncident(body.incident.id!);
        const state: InvestigationState = {
          incidentId: incident.id!,
          status: 'running',
          iterationCount: 0,
          stagnationCount: 0,
          entities: incident.entities,
          findings: [],
          plan: [],
          steps: [],
          lastToolResults: [],
          lastSignals: [],
          metadata: { initializedBy: 'investigation-engine' },
          updatedAt: new Date().toISOString(),
        };
        await saveState(state);
        const response: InitInvestigationResponse = { phase: 'init', incidentId: incident.id!, state, next: '/plan' };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/plan',
      validate: validatePlan,
      handler: async ({ body, res }) => {
        const state = (await loadState(body.incidentId)) ?? {
          incidentId: body.incidentId,
          status: 'running',
          iterationCount: 0,
          stagnationCount: 0,
          entities: [],
          findings: [],
          plan: [],
          steps: [],
          lastToolResults: [],
          lastSignals: [],
          metadata: {},
          updatedAt: new Date().toISOString(),
        };
        state.plan = createDefaultPlan(body.incidentId, body.maxSteps ?? 3);
        state.iterationCount += 1;
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        const response: PlanInvestigationResponse = { phase: 'plan', incidentId: body.incidentId, state, steps: state.plan, next: '/execute' };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/execute',
      validate: validateExecute,
      handler: async ({ body, res }) => {
        const state = await loadState(body.incidentId);
        if (!state) {
          throw new Error(`Investigation state for ${body.incidentId} not found`);
        }
        state.steps = body.stepIds.map((stepId, index) => ({
          id: `${stepId}-execution`,
          incidentId: body.incidentId,
          stepIndex: index,
          type: 'reasoning',
          status: 'success',
          summary: `Executed placeholder logic for ${stepId}.`,
          findings: [],
          entityIds: [],
          createdAt: new Date().toISOString(),
        }));
        state.updatedAt = new Date().toISOString();
        await saveState(state);

        await database.client.delete(steps).where(eq(steps.incidentId, body.incidentId));
        if (state.steps.length > 0) {
          await database.client.insert(steps).values(
            state.steps.map((step) => ({
              incidentId: body.incidentId,
              stepIndex: step.stepIndex,
              type: step.type,
              status: 'success',
              input: null,
              output: { summary: step.summary },
              summary: step.summary,
              toolName: step.toolName ?? null,
            })),
          );
        }
        const response: ExecuteInvestigationResponse = {
          phase: 'execute',
          incidentId: body.incidentId,
          state,
          executedStepIds: body.stepIds,
          next: '/evaluate',
        };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/evaluate',
      validate: validateEvaluate,
      handler: async ({ body, res }) => {
        const state = await loadState(body.incidentId);
        if (!state) {
          throw new Error(`Investigation state for ${body.incidentId} not found`);
        }
        state.findings = [
          {
            summary: `Evaluation completed for ${body.evidenceIds.length} evidence identifiers.`,
            confidence: body.evidenceIds.length > 0 ? 0.7 : 0.4,
            entities: [],
            evidenceRefs: [],
            structuredSignals: [],
            metadata: { evidenceIds: body.evidenceIds },
            createdAt: new Date().toISOString(),
          },
        ];
        state.stagnationCount = body.evidenceIds.length === 0 ? state.stagnationCount + 1 : 0;
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        const response: EvaluateInvestigationResponse = {
          phase: 'evaluate',
          incidentId: body.incidentId,
          state,
          findingsSummary: {
            count: state.findings.length,
            summaries: state.findings.map((finding) => finding.summary),
          },
          next: '/finalize',
        };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/finalize',
      validate: validateFinalize,
      handler: async ({ body, res }) => {
        const [state, incident] = await Promise.all([loadState(body.incidentId), loadIncident(body.incidentId)]);
        if (!state) {
          throw new Error(`Investigation state for ${body.incidentId} not found`);
        }
        state.status = 'complete';
        state.updatedAt = new Date().toISOString();
        await saveState(state);

        const report: FinalReport = {
          incidentId: body.incidentId,
          summary: `Investigation finalized for ${incident.title}.`,
          conclusion: 'Deterministic placeholder conclusion pending tool integrations.',
          status: state.findings.length > 0 ? 'mitigated' : 'inconclusive',
          findings: state.findings,
          entities: state.entities,
          timeline: state.steps,
          recommendations: ['Connect tool integrations to replace placeholder execution results.'],
          evidenceRefs: [],
          createdAt: new Date().toISOString(),
        };
        const response: FinalizeInvestigationResponse = {
          phase: 'finalize',
          incidentId: body.incidentId,
          report,
          state,
          completed: true,
        };
        sendJson(res, 200, response);
      },
    },
  ],
);
