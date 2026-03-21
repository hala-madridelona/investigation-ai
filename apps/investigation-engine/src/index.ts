import { eq, inArray } from 'drizzle-orm';

import {
  createDatabaseClientFromEnv,
  incidents,
  investigationState,
  stepArtifacts,
  steps,
  toolCalls,
} from '@investigation-ai/db';
import { createInvestigationAdk } from './reasoning/google-adk.js';
import {
  asObject,
  asString,
  asStringArray,
  createRecordMetadata,
  createService,
  loadConfig,
  sendJson,
} from '@investigation-ai/service-runtime';
import type {
  FallbackSignalExtractionResponse,
  FinalReport,
  FinalReportDraftResponse,
  Finding,
  HypothesisGenerationResponse,
  Incident,
  InvestigationState,
  JsonObject,
  PlanStep,
  StructuredSignal,
  SummarizationResponse,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolOutput,
} from '@investigation-ai/shared-types';
import {
  getDefaultToolAdapter,
  isInvestigationToolName,
} from '@investigation-ai/tools';
import {
  defaultWorkflowRetryPolicy,
  defaultWorkflowTimeoutPolicy,
  type EvaluateInvestigationRequest,
  type EvaluateInvestigationResponse,
  type ExecuteInvestigationRequest,
  type ExecuteInvestigationResponse,
  type FinalizeInvestigationRequest,
  type FinalizeInvestigationResponse,
  type InitInvestigationRequest,
  type InitInvestigationResponse,
  type PlanInvestigationRequest,
  type PlanInvestigationResponse,
  type WorkflowControl,
  type WorkflowRequestContext,
  type WorkflowResponseMetadata,
} from '@investigation-ai/workflow-contracts';

const config = loadConfig(process.env, 3002);
const database = createDatabaseClientFromEnv(process.env);
const adk = createInvestigationAdk('gemini-2.5-pro');

const validateInit = (input: unknown): InitInvestigationRequest => {
  const payload = asObject(input);
  const incident = asObject(payload.incident);
  return {
    context: validateWorkflowContext(payload.context),
    incident: { id: asString(incident.id, 'incident.id') } as Incident,
  };
};

const validatePlan = (input: unknown): PlanInvestigationRequest => {
  const payload = asObject(input);
  const rawMaxSteps = payload.maxSteps;
  if (
    rawMaxSteps !== undefined &&
    (typeof rawMaxSteps !== 'number' ||
      !Number.isInteger(rawMaxSteps) ||
      rawMaxSteps <= 0)
  ) {
    throw new Error('maxSteps must be a positive integer');
  }
  return {
    context: validateWorkflowContext(payload.context),
    incidentId: asString(payload.incidentId, 'incidentId'),
    ...(rawMaxSteps === undefined ? {} : { maxSteps: rawMaxSteps as number }),
  };
};

const validateExecute = (input: unknown): ExecuteInvestigationRequest => {
  const payload = asObject(input);
  return {
    context: validateWorkflowContext(payload.context),
    incidentId: asString(payload.incidentId, 'incidentId'),
    stepIds: asStringArray(payload.stepIds ?? [], 'stepIds'),
  };
};

const validateEvaluate = (input: unknown): EvaluateInvestigationRequest => {
  const payload = asObject(input);
  return {
    context: validateWorkflowContext(payload.context),
    incidentId: asString(payload.incidentId, 'incidentId'),
    evidenceIds: asStringArray(payload.evidenceIds ?? [], 'evidenceIds'),
  };
};

const validateFinalize = (input: unknown): FinalizeInvestigationRequest => {
  const payload = asObject(input);
  return {
    context: validateWorkflowContext(payload.context),
    incidentId: asString(payload.incidentId, 'incidentId'),
  };
};

const validateWorkflowContext = (input: unknown): WorkflowRequestContext => {
  const context = asObject(input);
  const attempt = context.attempt ?? 1;
  if (
    typeof attempt !== 'number' ||
    !Number.isInteger(attempt) ||
    attempt <= 0
  ) {
    throw new Error('context.attempt must be a positive integer');
  }
  return {
    requestId: asString(context.requestId, 'context.requestId'),
    workflowExecutionId: asString(
      context.workflowExecutionId,
      'context.workflowExecutionId',
    ),
    correlationId: asString(context.correlationId, 'context.correlationId'),
    correlationIds: Array.isArray(context.correlationIds)
      ? context.correlationIds.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
      : [asString(context.correlationId, 'context.correlationId')],
    idempotencyKey: asString(context.idempotencyKey, 'context.idempotencyKey'),
    attempt,
    requestedAt: asString(context.requestedAt, 'context.requestedAt'),
    deadlineAt: asString(context.deadlineAt, 'context.deadlineAt'),
  };
};

const resolveIdempotencyScope = (
  idempotencyKey: string,
): WorkflowControl['idempotency']['scope'] =>
  idempotencyKey.split(':').length > 4 ? 'phase' : 'workflow';

const buildControl = (
  context: WorkflowRequestContext,
  values: Pick<
    WorkflowControl,
    'status' | 'nextPhase' | 'reason' | 'terminalState' | 'partialFailure'
  >,
): WorkflowControl => ({
  status: values.status,
  nextPhase: values.nextPhase,
  reason: values.reason,
  retryPolicy: defaultWorkflowRetryPolicy,
  timeoutPolicy: defaultWorkflowTimeoutPolicy,
  idempotency: {
    key: context.idempotencyKey,
    scope: resolveIdempotencyScope(context.idempotencyKey),
    replayed: false,
  },
  ...(values.terminalState ? { terminalState: values.terminalState } : {}),
  ...(values.partialFailure ? { partialFailure: values.partialFailure } : {}),
});

const buildMetadata = (
  context: WorkflowRequestContext,
): WorkflowResponseMetadata => ({
  requestId: context.requestId,
  workflowExecutionId: context.workflowExecutionId,
  correlationId: context.correlationId,
  correlationIds: context.correlationIds ?? [context.correlationId],
  generatedAt: new Date().toISOString(),
});

const resolveRegisteredToolAdapter = (toolName: string) =>
  isInvestigationToolName(toolName) ? getDefaultToolAdapter(toolName) : null;

const createDefaultPlan = (
  incidentId: string,
  state: InvestigationState,
  maxSteps = 3,
): PlanStep[] => {
  const targetEntityIds = state.entities.map((entity) => entity.id);
  const hasEvidence =
    state.lastToolResults.length > 0 ||
    state.findings.length > 0 ||
    state.lastSignals.length > 0;
  const basePlan: PlanStep[] = [
    {
      id: `${incidentId}-collect-context`,
      title: 'Collect incident context',
      objective: 'Gather baseline incident metadata and recent changes.',
      rationale:
        'Starts each execution window from initialized incident state.',
      status: 'ready',
      dependsOn: [],
      toolRequestIds: [],
      targetEntityIds,
      stopIf: [],
    },
    {
      id: `${incidentId}-review-signals`,
      title: 'Review current signals',
      objective: 'Summarize stored evidence and identify remaining gaps.',
      rationale: 'Builds the next execution window from persisted outputs.',
      status: 'pending',
      dependsOn: [`${incidentId}-collect-context`],
      toolRequestIds: [],
      targetEntityIds,
      stopIf: [],
    },
  ];

  if (!hasEvidence || state.iterationCount === 0) {
    basePlan.push({
      id: `${incidentId}-expand-evidence`,
      title: 'Expand evidence set',
      objective:
        'Capture additional evidence required to evaluate the incident.',
      rationale:
        'Keeps the workflow in execution mode until persisted evidence exists.',
      status: 'pending',
      dependsOn: [`${incidentId}-review-signals`],
      toolRequestIds: [],
      targetEntityIds,
      stopIf: [],
    });
  }

  return basePlan.slice(0, maxSteps);
};

const clampConfidence = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const validateSummaryOutput = (
  output: SummarizationResponse | undefined,
  fallbackSummary: string,
): SummarizationResponse => {
  const summary = asNonEmptyString(output?.summary) ?? fallbackSummary;
  const bullets = Array.isArray(output?.bullets)
    ? output.bullets
        .map((bullet) => ({
          text: asNonEmptyString(bullet.text),
          evidenceRefs: Array.isArray(bullet.evidenceRefs)
            ? bullet.evidenceRefs.filter((item) => typeof item === 'string')
            : [],
          confidence: clampConfidence(bullet.confidence, 0.5),
        }))
        .filter(
          (
            bullet,
          ): bullet is {
            text: string;
            evidenceRefs: string[];
            confidence: number;
          } => bullet.text !== null,
        )
    : [];
  const missingInformation = Array.isArray(output?.missingInformation)
    ? output.missingInformation.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  return { summary, bullets, missingInformation };
};

const validateHypothesesOutput = (
  output: HypothesisGenerationResponse | undefined,
): HypothesisGenerationResponse => ({
  hypotheses: Array.isArray(output?.hypotheses)
    ? output.hypotheses
        .map((item) => ({
          hypothesis: asNonEmptyString(item.hypothesis),
          rationale: asNonEmptyString(item.rationale),
          confidence: clampConfidence(item.confidence, 0.4),
          evidenceRefs: Array.isArray(item.evidenceRefs)
            ? item.evidenceRefs.filter((ref) => typeof ref === 'string')
            : [],
        }))
        .filter(
          (
            item,
          ): item is {
            hypothesis: string;
            rationale: string;
            confidence: number;
            evidenceRefs: string[];
          } => item.hypothesis !== null && item.rationale !== null,
        )
    : [],
  openQuestions: Array.isArray(output?.openQuestions)
    ? output.openQuestions.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [],
});

const validateFallbackSignalsOutput = (
  output: FallbackSignalExtractionResponse | undefined,
  evidenceIds: string[],
): FallbackSignalExtractionResponse => ({
  signals: Array.isArray(output?.signals)
    ? output.signals
        .map((signal) => {
          const name = asNonEmptyString(signal.name);
          const category = signal.category;
          if (
            name === null ||
            (category !== 'symptom' &&
              category !== 'cause' &&
              category !== 'correlation' &&
              category !== 'change' &&
              category !== 'impact')
          ) {
            return null;
          }
          return {
            name,
            category,
            value: signal.value ?? name,
            confidence: clampConfidence(signal.confidence, 0.4),
            evidenceRefs: Array.isArray(signal.evidenceRefs)
              ? signal.evidenceRefs.filter(
                  (ref): ref is string =>
                    typeof ref === 'string' && evidenceIds.includes(ref),
                )
              : [],
            entityIds: Array.isArray(signal.entityIds)
              ? signal.entityIds.filter(
                  (entityId): entityId is string =>
                    typeof entityId === 'string',
                )
              : [],
          };
        })
        .filter(
          (signal): signal is NonNullable<typeof signal> => signal !== null,
        )
    : [],
  discardedSignals: Array.isArray(output?.discardedSignals)
    ? output.discardedSignals.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [],
});

const validateFinalReportDraftOutput = (
  output: FinalReportDraftResponse | undefined,
  fallbackSummary: string,
): FinalReportDraftResponse => {
  const status = output?.status;
  return {
    summary: asNonEmptyString(output?.summary) ?? fallbackSummary,
    conclusion:
      asNonEmptyString(output?.conclusion) ??
      'Deterministic fallback conclusion used because ADK output was unavailable or invalid.',
    status:
      status === 'resolved' ||
      status === 'mitigated' ||
      status === 'needs_handoff' ||
      status === 'inconclusive'
        ? status
        : 'inconclusive',
    recommendations: Array.isArray(output?.recommendations)
      ? output.recommendations
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .slice(0, 5)
      : [],
  };
};

const buildDeterministicSignals = (evidenceIds: string[]): StructuredSignal[] =>
  evidenceIds.map((evidenceId, index) => ({
    name: `fallback-signal-${index + 1}`,
    category: 'correlation',
    value: evidenceId,
    confidence: 0.3,
    evidenceRefs: [evidenceId],
    entityIds: [],
  }));

const extractEvidenceIdsFromResults = (
  results: ToolExecutionResult[],
): string[] =>
  Array.from(
    new Set(
      results.flatMap((result) =>
        result.output.evidenceRefs.map((evidence) => evidence.id),
      ),
    ),
  );

const extractSignalsFromResults = (
  results: ToolExecutionResult[],
): StructuredSignal[] =>
  results.flatMap((result) =>
    result.output.structuredSignals.map((signal) => ({ ...signal })),
  );

const toToolStatus = (
  status: ToolExecutionResult['status'],
): 'success' | 'failed' => (status === 'failed' ? 'failed' : 'success');

const buildStepInput = (
  incidentId: string,
  planStep: PlanStep,
  state: InvestigationState,
): JsonObject => ({
  incidentId,
  planStepId: planStep.id,
  title: planStep.title,
  objective: planStep.objective,
  rationale: planStep.rationale,
  targetEntityIds: planStep.targetEntityIds,
  priorFindingSummaries: state.findings.map((finding) => finding.summary),
  priorSignalNames: state.lastSignals.map((signal) => signal.name),
  priorToolRequestIds: state.lastToolResults.map((result) => result.requestId),
});

const buildReasoningOutput = (
  incidentId: string,
  planStep: PlanStep,
  input: JsonObject,
): ToolOutput => ({
  rawSummary: `${planStep.title}: ${planStep.objective}`,
  structuredSignals: [
    {
      name: `${planStep.id}-reasoning-signal`,
      category: 'correlation',
      value: planStep.objective,
      confidence: 0.66,
      evidenceRefs: [`${planStep.id}-reasoning-evidence`],
      entityIds: planStep.targetEntityIds,
    },
  ],
  entities: [],
  evidenceRefs: [
    {
      id: `${planStep.id}-reasoning-evidence`,
      kind: 'report',
      source: 'investigation-engine',
      locator: `inline://incident/${incidentId}/plan-step/${planStep.id}/reasoning`,
      metadata: { input },
    },
  ],
  confidence: 0.66,
  source: {
    toolName: 'investigation-engine-reasoning',
    toolVersion: 'v1',
    executionId: `${planStep.id}-reasoning`,
  },
});

const buildToolRequest = (
  incidentId: string,
  planStep: PlanStep,
  state: InvestigationState,
): ToolExecutionRequest => ({
  id: `${planStep.id}-tool-request`,
  incidentId,
  stepId: planStep.id,
  toolName: planStep.title.toLowerCase().includes('context')
    ? 'incident-context-tool'
    : 'signal-review-tool',
  rationale: planStep.rationale,
  input: buildStepInput(incidentId, planStep, state),
  targetEntityIds: planStep.targetEntityIds,
  evidenceRefs: extractEvidenceIdsFromResults(state.lastToolResults),
});

const buildToolOutput = (
  request: ToolExecutionRequest,
  state: InvestigationState,
): ToolOutput => {
  const selectedAdapter = resolveRegisteredToolAdapter(request.toolName);
  const evidenceId = `${request.stepId}-tool-evidence`;
  return {
    rawSummary: `${selectedAdapter?.name ?? request.toolName} executed for ${request.stepId} and captured ${request.targetEntityIds.length || state.entities.length || 1} investigation targets.`,
    structuredSignals: [
      {
        name: `${request.stepId}-tool-signal`,
        category: request.toolName.includes('context')
          ? 'change'
          : 'correlation',
        value: {
          objective:
            typeof request.input.objective === 'string'
              ? request.input.objective
              : request.stepId,
          targetCount: request.targetEntityIds.length,
          priorEvidenceCount: request.evidenceRefs.length,
        },
        confidence: 0.74,
        evidenceRefs: [evidenceId],
        entityIds: request.targetEntityIds,
      },
    ],
    entities: [],
    evidenceRefs: [
      {
        id: evidenceId,
        kind: 'artifact',
        source: request.toolName,
        locator: `inline://incident/${request.incidentId}/tool/${request.id}`,
        metadata: { input: request.input },
      },
    ],
    confidence: 0.74,
    source: {
      toolName: request.toolName,
      toolVersion: 'v1',
      executionId: request.id,
    },
  };
};

const persistExecutionRecords = async (
  incidentId: string,
  executedSteps: InvestigationState['steps'],
  resultsByStepId: Map<string, ToolExecutionResult>,
): Promise<void> => {
  const existingStepRecords = await database.client.query.steps.findMany({
    columns: { id: true },
    where: eq(steps.incidentId, incidentId),
  });
  const existingStepIds = existingStepRecords.map((record) => record.id);
  if (existingStepIds.length > 0) {
    await database.client
      .delete(toolCalls)
      .where(inArray(toolCalls.stepId, existingStepIds));
    await database.client
      .delete(stepArtifacts)
      .where(inArray(stepArtifacts.stepId, existingStepIds));
  }
  await database.client.delete(steps).where(eq(steps.incidentId, incidentId));
  if (executedSteps.length === 0) {
    return;
  }

  const insertedSteps = await database.client
    .insert(steps)
    .values(
      executedSteps.map((step) => ({
        incidentId,
        stepIndex: step.stepIndex,
        type: step.type,
        toolName: step.toolName ?? null,
        status: (step.status === 'failed' ? 'failed' : 'success') as const,
        input:
          (step.input as
            | Record<string, unknown>
            | unknown[]
            | null
            | undefined) ?? null,
        output:
          (step.output as
            | Record<string, unknown>
            | unknown[]
            | null
            | undefined) ?? null,
        summary: step.summary,
      })),
    )
    .returning({ id: steps.id, stepIndex: steps.stepIndex });

  const stepIdByIndex = new Map(
    insertedSteps.map((record) => [record.stepIndex, record.id]),
  );
  const toolCallRows: Array<{
    stepId: string;
    toolName: string;
    latencyMs: number;
    status: 'success' | 'failed';
  }> = [];
  const artifactRows: Array<{
    stepId: string;
    artifactType: 'logs' | 'report' | 'raw_output';
    gcsPath: string;
    metadata: Record<string, unknown>;
  }> = [];
  for (const step of executedSteps) {
    const insertedStepId = stepIdByIndex.get(step.stepIndex);
    if (!insertedStepId) continue;
    artifactRows.push({
      stepId: insertedStepId,
      artifactType: 'report',
      gcsPath: `inline://incident/${incidentId}/steps/${step.stepIndex}/input`,
      metadata: { kind: 'input', payload: step.input ?? null },
    });
    artifactRows.push({
      stepId: insertedStepId,
      artifactType: step.type === 'tool_call' ? 'raw_output' : 'report',
      gcsPath: `inline://incident/${incidentId}/steps/${step.stepIndex}/output`,
      metadata: {
        kind: 'output',
        payload: step.output ?? null,
        summary: step.summary,
      },
    });
    const toolResult = step.planStep
      ? resultsByStepId.get(step.planStep.id)
      : undefined;
    if (toolResult && step.toolName) {
      toolCallRows.push({
        stepId: insertedStepId,
        toolName: step.toolName,
        latencyMs: toolResult.latencyMs ?? 0,
        status: toToolStatus(toolResult.status),
      });
    }
  }
  if (artifactRows.length > 0) {
    await database.client.insert(stepArtifacts).values(artifactRows);
  }
  if (toolCallRows.length > 0) {
    await database.client.insert(toolCalls).values(toolCallRows);
  }
};

const loadIncident = async (incidentId: string): Promise<Incident> => {
  const incident = await database.client.query.incidents.findFirst({
    where: eq(incidents.id, incidentId),
  });
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

const loadState = async (
  incidentId: string,
): Promise<InvestigationState | null> => {
  const record = await database.client.query.investigationState.findFirst({
    where: eq(investigationState.incidentId, incidentId),
  });
  if (!record) return null;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const state: InvestigationState = {
    incidentId: record.incidentId,
    status: record.status,
    iterationCount: record.iterationCount,
    stagnationCount: record.stagnationCount,
    entities: Array.isArray(record.entities)
      ? (record.entities as InvestigationState['entities'])
      : [],
    findings: (metadata.findings as Finding[] | undefined) ?? [],
    plan: (metadata.plan as PlanStep[] | undefined) ?? [],
    steps: (metadata.steps as InvestigationState['steps'] | undefined) ?? [],
    lastToolResults:
      (metadata.lastToolResults as
        | InvestigationState['lastToolResults']
        | undefined) ?? [],
    lastSignals: Array.isArray(record.lastSignals)
      ? (record.lastSignals as InvestigationState['lastSignals'])
      : [],
    metadata: metadata as unknown as InvestigationState['metadata'],
    updatedAt: record.updatedAt.toISOString(),
  };
  if (metadata.stopCondition) {
    state.stopCondition =
      metadata.stopCondition as InvestigationState['stopCondition'];
  }
  return state;
};

const saveState = async (state: InvestigationState): Promise<void> => {
  const existing = await database.client.query.investigationState.findFirst({
    where: eq(investigationState.incidentId, state.incidentId),
  });
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
    } as unknown as JsonObject,
    updatedAt: new Date(),
  };
  if (existing) {
    await database.client
      .update(investigationState)
      .set(values)
      .where(eq(investigationState.incidentId, state.incidentId));
    return;
  }
  await database.client
    .insert(investigationState)
    .values({ incidentId: state.incidentId, ...values });
};

createService(
  {
    serviceName: 'investigation-engine',
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
  },
  [
    {
      method: 'POST',
      path: '/init',
      validate: validateInit,
      handler: async ({ body, res, logger }) => {
        const request = body as InitInvestigationRequest;
        const correlationIds = request.context.correlationIds ?? [
          request.context.correlationId,
        ];
        const requestLogger = logger.child({
          correlationIds,
          incidentId: request.incident.id,
        });
        const incident = await loadIncident(request.incident.id!);
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
          metadata: {
            initializedBy: 'investigation-engine',
            adkPolicy: 'engine-validated-only',
            recordMetadata: createRecordMetadata({
              actor: { type: 'service', id: 'investigation-engine' },
              source: { kind: 'workflow', id: 'init', displayName: 'init' },
              correlationIds,
              incidentId: incident.id,
            }),
          },
          updatedAt: new Date().toISOString(),
        };
        await saveState(state);
        const response: InitInvestigationResponse = {
          phase: 'init',
          incidentId: incident.id!,
          state,
          control: buildControl(request.context, {
            status: 'continue',
            nextPhase: '/plan',
            reason: 'Investigation state initialized successfully.',
          }),
          metadata: buildMetadata(request.context),
        };
        requestLogger.info('investigation.init.completed', {
          incidentId: incident.id,
          correlationIds,
        });
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/plan',
      validate: validatePlan,
      handler: async ({ body, res, logger }) => {
        const request = body as PlanInvestigationRequest;
        const correlationIds = request.context.correlationIds ?? [
          request.context.correlationId,
        ];
        const requestLogger = logger.child({
          correlationIds,
          incidentId: request.incidentId,
        });
        const state = await loadState(request.incidentId);
        if (!state) {
          throw new Error(
            `Investigation state for ${request.incidentId} must be initialized before planning`,
          );
        }
        const incident = await loadIncident(request.incidentId);
        state.entities = incident.entities;
        state.plan = createDefaultPlan(
          request.incidentId,
          state,
          request.maxSteps ?? 3,
        );
        state.iterationCount += 1;
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        const response: PlanInvestigationResponse = {
          phase: 'plan',
          incidentId: request.incidentId,
          state,
          steps: state.plan,
          control: buildControl(request.context, {
            status: state.plan.length > 0 ? 'continue' : 'stop',
            nextPhase: state.plan.length > 0 ? '/execute' : '/finalize',
            reason:
              state.plan.length > 0
                ? 'Plan generated successfully from initialized investigation state.'
                : 'No executable steps remain.',
          }),
          metadata: buildMetadata(request.context),
        };
        requestLogger.info('investigation.plan.completed', {
          incidentId: request.incidentId,
          correlationIds,
          stepCount: state.plan.length,
        });
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/execute',
      validate: validateExecute,
      handler: async ({ body, res, logger }) => {
        const request = body as ExecuteInvestigationRequest;
        const correlationIds = request.context.correlationIds ?? [
          request.context.correlationId,
        ];
        const requestLogger = logger.child({
          correlationIds,
          incidentId: request.incidentId,
        });
        const state = await loadState(request.incidentId);
        if (!state) {
          throw new Error(
            `Investigation state for ${request.incidentId} not found`,
          );
        }

        const plannedSteps = state.plan.filter((step) =>
          request.stepIds.includes(step.id),
        );
        const executedStepIds: string[] = [];
        const warnings: NonNullable<
          WorkflowControl['partialFailure']
        >['warnings'] = [];
        const resultsByStepId = new Map<string, ToolExecutionResult>();
        const executionSteps: InvestigationState['steps'] = [];

        for (const [index, planStep] of plannedSteps.entries()) {
          try {
            const reasoningInput = buildStepInput(
              request.incidentId,
              planStep,
              state,
            );
            const reasoningOutput = buildReasoningOutput(
              request.incidentId,
              planStep,
              reasoningInput,
            );
            const toolRequest = buildToolRequest(
              request.incidentId,
              planStep,
              state,
            );
            const toolOutput = buildToolOutput(toolRequest, state);
            const now = new Date().toISOString();
            const toolResult: ToolExecutionResult = {
              requestId: toolRequest.id,
              incidentId: request.incidentId,
              stepId: planStep.id,
              status: 'success',
              startedAt: now,
              completedAt: now,
              latencyMs: 0,
              output: {
                ...toolOutput,
                metadata: { reasoning: reasoningOutput, toolRequest },
              },
              recordMetadata: createRecordMetadata({
                actor: { type: 'service', id: 'investigation-engine' },
                source: {
                  kind: 'workflow',
                  id: 'execute',
                  displayName: planStep.id,
                },
                correlationIds,
                incidentId: request.incidentId,
                investigationStepId: planStep.id,
              }),
            };

            resultsByStepId.set(planStep.id, toolResult);
            executedStepIds.push(planStep.id);
            executionSteps.push({
              id: `${planStep.id}-execution`,
              incidentId: request.incidentId,
              stepIndex: index,
              type: 'tool_call',
              status: 'success',
              summary: toolOutput.rawSummary,
              toolName: toolRequest.toolName,
              planStep: {
                ...planStep,
                toolRequestIds: [toolRequest.id],
                status: 'completed',
              },
              input: reasoningInput,
              output: toolOutput,
              findings: [],
              entityIds: toolRequest.targetEntityIds,
              recordMetadata: createRecordMetadata({
                actor: { type: 'service', id: 'investigation-engine' },
                source: {
                  kind: 'workflow',
                  id: 'execute',
                  displayName: planStep.id,
                },
                correlationIds,
                incidentId: request.incidentId,
                investigationStepId: planStep.id,
              }),
              createdAt: now,
            });
          } catch (error) {
            warnings.push({
              code: 'EXECUTION_STEP_FAILED',
              message:
                error instanceof Error
                  ? error.message
                  : `Execution failed for ${planStep.id}.`,
              retryable: true,
              details: { stepId: planStep.id },
            });
          }
        }

        const failedDependencyCount =
          request.stepIds.length - executedStepIds.length;
        state.steps = executionSteps;
        state.lastToolResults = Array.from(resultsByStepId.values());
        state.lastSignals = extractSignalsFromResults(state.lastToolResults);
        state.plan = state.plan.map((step) =>
          executedStepIds.includes(step.id)
            ? {
                ...step,
                status: 'completed',
                toolRequestIds: [`${step.id}-tool-request`],
              }
            : step,
        );
        state.metadata = {
          ...(state.metadata ?? {}),
          lastExecutedEvidenceIds: extractEvidenceIdsFromResults(
            state.lastToolResults,
          ),
          lastExecutedStepIds: executedStepIds,
        };
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        await persistExecutionRecords(
          request.incidentId,
          state.steps,
          resultsByStepId,
        );

        const response: ExecuteInvestigationResponse = {
          phase: 'execute',
          incidentId: request.incidentId,
          state,
          executedStepIds,
          control: buildControl(request.context, {
            status:
              warnings.length > 0 && executedStepIds.length === 0
                ? 'retry'
                : 'continue',
            nextPhase:
              warnings.length > 0 && executedStepIds.length === 0
                ? '/execute'
                : '/evaluate',
            reason:
              warnings.length > 0 && executedStepIds.length === 0
                ? 'Execution encountered only retryable failures.'
                : 'Execution completed and persisted concrete outputs for evaluation.',
            ...(warnings.length > 0
              ? {
                  partialFailure: {
                    affectedStepIds: request.stepIds.filter(
                      (stepId) => !executedStepIds.includes(stepId),
                    ),
                    failedDependencyCount,
                    handling:
                      executedStepIds.length > 0
                        ? 'degraded_continue'
                        : 'retry_phase',
                    warnings,
                  },
                }
              : {}),
          }),
          metadata: buildMetadata(request.context),
        };
        requestLogger.info('investigation.execute.completed', {
          incidentId: request.incidentId,
          correlationIds,
          stepIds: request.stepIds,
        });
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/evaluate',
      validate: validateEvaluate,
      handler: async ({ body, res, logger }) => {
        const request = body as EvaluateInvestigationRequest;
        const correlationIds = request.context.correlationIds ?? [
          request.context.correlationId,
        ];
        const requestLogger = logger.child({
          correlationIds,
          incidentId: request.incidentId,
        });
        const state = await loadState(request.incidentId);
        if (!state) {
          throw new Error(
            `Investigation state for ${request.incidentId} not found`,
          );
        }

        const persistedEvidenceIds = Array.isArray(
          state.metadata?.lastExecutedEvidenceIds,
        )
          ? state.metadata.lastExecutedEvidenceIds.filter(
              (item): item is string => typeof item === 'string',
            )
          : [];
        const latestEvidenceIds = Array.from(
          new Set([
            ...request.evidenceIds,
            ...persistedEvidenceIds,
            ...extractEvidenceIdsFromResults(state.lastToolResults),
          ]),
        );
        const evaluationInputs = Array.from(
          new Set([
            ...state.steps.map((step) => step.summary),
            ...state.lastToolResults.map((result) => result.output.rawSummary),
          ]),
        );
        const deterministicSummary = `Evaluation completed for ${latestEvidenceIds.length} evidence identifiers.`;
        const summaryResult = await adk.summarize({
          incidentId: request.incidentId,
          incidentTitle: request.incidentId,
          findings: evaluationInputs,
          evidenceIds: latestEvidenceIds,
          maxBullets: 3,
        });
        const summary = validateSummaryOutput(
          summaryResult.output,
          deterministicSummary,
        );

        const hypothesisResult = await adk.generateHypotheses({
          incidentId: request.incidentId,
          incidentSummary: summary.summary,
          findingSummaries: evaluationInputs,
          maxHypotheses: 3,
        });
        const hypotheses = validateHypothesesOutput(hypothesisResult.output);

        const fallbackSignalResult = await adk.extractFallbackSignals({
          incidentId: request.incidentId,
          rawSignals:
            latestEvidenceIds.length > 0 ? latestEvidenceIds : evaluationInputs,
          knownEntityIds: state.entities.map((entity) => entity.id),
          maxSignals: 5,
        });
        const validatedSignalExtraction = validateFallbackSignalsOutput(
          fallbackSignalResult.output,
          latestEvidenceIds,
        );
        const deterministicSignals =
          buildDeterministicSignals(latestEvidenceIds);
        state.lastSignals =
          validatedSignalExtraction.signals.length > 0
            ? validatedSignalExtraction.signals.map((signal) => ({ ...signal }))
            : deterministicSignals;

        const evaluationEvidenceRefs = state.lastToolResults.flatMap((result) =>
          result.output.evidenceRefs.map((evidenceRef) => ({ ...evidenceRef })),
        );
        const newFinding: Finding = {
          summary: summary.summary,
          confidence: latestEvidenceIds.length > 0 ? 0.7 : 0.4,
          ...(hypotheses.hypotheses[0]?.hypothesis
            ? { hypothesis: hypotheses.hypotheses[0].hypothesis }
            : {}),
          entities: [],
          evidenceRefs: evaluationEvidenceRefs,
          structuredSignals: state.lastSignals,
          metadata: {
            evidenceIds: request.evidenceIds,
            outputKind: 'summarized_finding',
            llm: {
              summarizationOk: summaryResult.ok,
              hypothesisGenerationOk: hypothesisResult.ok,
              fallbackSignalExtractionOk: fallbackSignalResult.ok,
              openQuestions: hypotheses.openQuestions,
              missingInformation: summary.missingInformation,
              discardedSignals: validatedSignalExtraction.discardedSignals,
            },
          },
          recordMetadata: createRecordMetadata({
            actor: { type: 'service', id: 'investigation-engine' },
            source: {
              kind: 'workflow',
              id: 'evaluate',
              displayName: 'evaluate',
            },
            correlationIds,
            incidentId: request.incidentId,
          }),
          createdAt: new Date().toISOString(),
        };
        state.findings = [...state.findings, newFinding];
        state.stagnationCount =
          latestEvidenceIds.length === 0 ? state.stagnationCount + 1 : 0;
        state.stopCondition = {
          shouldStop: false,
          reason:
            'Loop termination remains engine-controlled; ADK output is advisory only.',
          confidence: 1,
          satisfiedConditions: [],
          unsatisfiedConditions: ['finalize_requested'],
          recommendedNextStepIds: state.plan
            .filter((step) => step.status !== 'completed')
            .map((step) => step.id)
            .slice(0, 1),
        };
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        const response: EvaluateInvestigationResponse = {
          phase: 'evaluate',
          incidentId: request.incidentId,
          state,
          findingsSummary: {
            count: state.findings.length,
            summaries: state.findings.map((finding) => finding.summary),
          },
          control: buildControl(request.context, {
            status: latestEvidenceIds.length > 0 ? 'stop' : 'continue',
            nextPhase: latestEvidenceIds.length > 0 ? '/finalize' : '/plan',
            reason:
              latestEvidenceIds.length > 0
                ? 'Stored evidence produced findings that are ready to finalize.'
                : 'Evaluation needs another planning iteration to gather persisted evidence.',
            ...(latestEvidenceIds.length === 0
              ? {
                  partialFailure: {
                    affectedStepIds: request.evidenceIds,
                    failedDependencyCount: request.evidenceIds.length,
                    handling: 'degraded_continue',
                    warnings: [
                      {
                        code: 'NO_PERSISTED_EVIDENCE',
                        message:
                          'Evaluation derived findings from stored state but still needs persisted evidence for a final report.',
                        retryable: false,
                      },
                    ],
                  },
                }
              : {}),
          }),
          metadata: buildMetadata(request.context),
        };
        requestLogger.info('investigation.evaluate.completed', {
          incidentId: request.incidentId,
          correlationIds,
          evidenceCount: request.evidenceIds.length,
        });
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/finalize',
      validate: validateFinalize,
      handler: async ({ body, res, logger }) => {
        const request = body as FinalizeInvestigationRequest;
        const correlationIds = request.context.correlationIds ?? [
          request.context.correlationId,
        ];
        const requestLogger = logger.child({
          correlationIds,
          incidentId: request.incidentId,
        });
        const [state, incident] = await Promise.all([
          loadState(request.incidentId),
          loadIncident(request.incidentId),
        ]);
        if (!state) {
          throw new Error(
            `Investigation state for ${request.incidentId} not found`,
          );
        }

        const deterministicSummary =
          state.findings.length > 0
            ? state.findings.map((finding) => finding.summary).join(' ')
            : `Investigation finalized for ${incident.title}.`;
        const finalDraftResult = await adk.draftFinalReport({
          incidentId: request.incidentId,
          incidentTitle: incident.title,
          summary: deterministicSummary,
          hypotheses: state.findings
            .map((finding) => finding.hypothesis)
            .filter((value): value is string => typeof value === 'string'),
          findingSummaries: state.findings.map((finding) => finding.summary),
          recommendationLimit: 3,
        });
        const finalDraft = validateFinalReportDraftOutput(
          finalDraftResult.output,
          deterministicSummary,
        );

        state.status = 'complete';
        state.updatedAt = new Date().toISOString();
        state.metadata = {
          ...(state.metadata ?? {}),
          llm: {
            finalReportDraftOk: finalDraftResult.ok,
          },
        };
        await saveState(state);

        const report: FinalReport = {
          incidentId: request.incidentId,
          summary: finalDraft.summary,
          conclusion: finalDraft.conclusion,
          status:
            state.findings.length > 0 ? finalDraft.status : 'inconclusive',
          findings: state.findings,
          entities: state.entities,
          timeline: state.steps,
          recommendations:
            finalDraft.recommendations.length > 0
              ? finalDraft.recommendations
              : [
                  'Connect a real Google ADK transport to enrich this draft while keeping orchestration deterministic.',
                ],
          evidenceRefs: state.findings.flatMap(
            (finding) => finding.evidenceRefs,
          ),
          recordMetadata: createRecordMetadata({
            actor: { type: 'service', id: 'investigation-engine' },
            source: { kind: 'report', id: 'finalize', displayName: 'finalize' },
            correlationIds,
            incidentId: request.incidentId,
          }),
          createdAt: new Date().toISOString(),
        };
        const response: FinalizeInvestigationResponse = {
          phase: 'finalize',
          incidentId: request.incidentId,
          report,
          state,
          completed: true,
          control: buildControl(request.context, {
            status: 'stop',
            nextPhase: null,
            terminalState: 'completed',
            reason: 'Final report created successfully.',
          }),
          metadata: buildMetadata(request.context),
        };
        requestLogger.info('investigation.finalize.completed', {
          incidentId: request.incidentId,
          correlationIds,
          findingCount: state.findings.length,
        });
        sendJson(res, 200, response);
      },
    },
  ],
);
