import { eq, inArray } from 'drizzle-orm';

import {
  createDatabaseClient,
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
import { getDefaultToolAdapter, type InvestigationToolName } from '@investigation-ai/tools';
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
const database = createDatabaseClient({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? 'require' : undefined,
});
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
    idempotencyKey: asString(context.idempotencyKey, 'context.idempotencyKey'),
    attempt,
    requestedAt: asString(context.requestedAt, 'context.requestedAt'),
    deadlineAt: asString(context.deadlineAt, 'context.deadlineAt'),
  };
};

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
    scope: 'phase',
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
  generatedAt: new Date().toISOString(),
});


const resolveRegisteredToolAdapter = (toolName: string) => {
  const knownTools = new Set<InvestigationToolName>([
    'gcp-logging',
    'firestore',
    'github',
    'cloud-monitoring',
    'grafana',
  ]);
  if (!knownTools.has(toolName as InvestigationToolName)) {
    return null;
  }
  return getDefaultToolAdapter(toolName as InvestigationToolName);
};

const createDefaultPlan = (incidentId: string, maxSteps = 3): PlanStep[] =>
  [
    {
      id: `${incidentId}-collect-context`,
      title: 'Collect incident context',
      objective: 'Gather baseline metadata and recent changes.',
      rationale: 'Deterministic bootstrap step before tool integrations exist.',
      status: 'ready' as const,
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
      status: 'pending' as const,
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
      status: 'pending' as const,
      dependsOn: [`${incidentId}-review-signals`],
      toolRequestIds: [],
      targetEntityIds: [],
      stopIf: [],
    },
  ].slice(0, maxSteps);

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
    rawSummary: `${request.toolName} executed for ${request.stepId} and captured ${request.targetEntityIds.length || state.entities.length || 1} investigation targets.${selectedAdapter ? ` Selected adapter: ${selectedAdapter.name}.` : ''}`,
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
      handler: async ({ body, res }) => {
        const request = body as InitInvestigationRequest;
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
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/plan',
      validate: validatePlan,
      handler: async ({ body, res }) => {
        const request = body as PlanInvestigationRequest;
        const state = (await loadState(request.incidentId)) ?? {
          incidentId: request.incidentId,
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
        state.plan = createDefaultPlan(
          request.incidentId,
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
                ? 'Plan generated successfully.'
                : 'No executable steps remain.',
          }),
          metadata: buildMetadata(request.context),
        };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/execute',
      validate: validateExecute,
      handler: async ({ body, res }) => {
        const request = body as ExecuteInvestigationRequest;
        const state = await loadState(request.incidentId);
        if (!state) {
          throw new Error(
            `Investigation state for ${request.incidentId} not found`,
          );
        }
        const planStepsById = new Map(
          state.plan.map((step) => [step.id, step]),
        );
        const completedPlanStepIds = new Set(
          state.steps
            .map((step) => step.planStep)
            .filter((planStep): planStep is PlanStep => Boolean(planStep))
            .filter((planStep) => planStep.status === 'completed')
            .map((planStep) => planStep.id),
        );
        const now = Date.now();
        const executedSteps: InvestigationState['steps'] = [];
        const latestResults: ToolExecutionResult[] = [];
        const warnings: Array<{
          code: string;
          message: string;
          retryable: boolean;
        }> = [];
        let failedDependencyCount = 0;

        for (const [index, stepId] of request.stepIds.entries()) {
          const planStep = planStepsById.get(stepId);
          if (!planStep) {
            warnings.push({
              code: 'UNKNOWN_PLAN_STEP',
              message: `Step ${stepId} does not exist in the current plan and was skipped.`,
              retryable: false,
            });
            failedDependencyCount += 1;
            continue;
          }
          const unmetDependencies = planStep.dependsOn.filter(
            (dependencyId) => !completedPlanStepIds.has(dependencyId),
          );
          if (unmetDependencies.length > 0) {
            warnings.push({
              code: 'STEP_DEPENDENCY_BLOCKED',
              message: `Step ${stepId} was skipped because dependencies were not completed: ${unmetDependencies.join(', ')}.`,
              retryable: true,
            });
            failedDependencyCount += unmetDependencies.length;
            continue;
          }

          const input = buildStepInput(request.incidentId, planStep, state);
          const isToolStep =
            planStep.title.toLowerCase().includes('collect') ||
            planStep.title.toLowerCase().includes('review');
          const startedAt = new Date(now + index * 10).toISOString();
          const completedAt = new Date(now + index * 10 + 5).toISOString();
          const toolRequest = isToolStep
            ? buildToolRequest(request.incidentId, planStep, state)
            : undefined;
          const output =
            isToolStep && toolRequest
              ? buildToolOutput(toolRequest, state)
              : buildReasoningOutput(request.incidentId, planStep, input);
          const result = toolRequest
            ? {
                requestId: toolRequest.id,
                incidentId: request.incidentId,
                stepId: planStep.id,
                status: 'success' as const,
                startedAt,
                completedAt,
                latencyMs: 5,
                output,
              }
            : undefined;
          const stepSummary = output.rawSummary;
          const stepFinding: Finding = {
            summary: stepSummary,
            confidence: output.confidence,
            entities: output.entities,
            evidenceRefs: output.evidenceRefs,
            structuredSignals: output.structuredSignals,
            metadata: {
              planStepId: planStep.id,
              executionType: isToolStep ? 'tool_call' : 'reasoning',
            },
            createdAt: completedAt,
          };
          const executedPlanStep: PlanStep = {
            ...planStep,
            status: 'completed',
            toolRequestIds: toolRequest
              ? [toolRequest.id]
              : planStep.toolRequestIds,
          };
          executedSteps.push({
            id: `${planStep.id}-execution`,
            incidentId: request.incidentId,
            stepIndex: state.steps.length + executedSteps.length,
            type: isToolStep ? 'tool_call' : 'reasoning',
            status: 'success',
            summary: stepSummary,
            ...(toolRequest?.toolName
              ? { toolName: toolRequest.toolName }
              : {}),
            planStep: executedPlanStep,
            input: toolRequest?.input ?? input,
            output,
            findings: [stepFinding],
            entityIds: output.entities.map((entity) => entity.id),
            createdAt: completedAt,
          });
          if (result) {
            latestResults.push(result);
          }
          completedPlanStepIds.add(planStep.id);
          state.findings.push(stepFinding);
        }

        state.plan = state.plan.map((planStep) => {
          const executedStep = executedSteps.find(
            (step) => step.planStep?.id === planStep.id,
          );
          if (executedStep?.planStep) {
            return executedStep.planStep;
          }
          if (
            request.stepIds.includes(planStep.id) &&
            !completedPlanStepIds.has(planStep.id)
          ) {
            return { ...planStep, status: 'skipped' };
          }
          return planStep;
        });
        state.steps = [...state.steps, ...executedSteps];
        state.lastToolResults = latestResults;
        state.lastSignals = extractSignalsFromResults(latestResults);
        state.metadata = {
          ...(state.metadata ?? {}),
          lastExecutedEvidenceIds: extractEvidenceIdsFromResults(latestResults),
          lastExecutedStepSummaries: executedSteps.map((step) => step.summary),
        };
        state.updatedAt = new Date().toISOString();
        await saveState(state);
        await persistExecutionRecords(
          request.incidentId,
          state.steps,
          new Map(latestResults.map((result) => [result.stepId, result])),
        );

        const executedStepIds = executedSteps
          .map((step) => step.planStep?.id)
          .filter((stepId): stepId is string => Boolean(stepId));
        if (request.stepIds.length === 0) {
          warnings.push({
            code: 'NO_STEPS_EXECUTED',
            message:
              'No step ids were supplied; evaluation will run with deterministic fallback behavior only if no persisted evidence exists.',
            retryable: false,
          });
        }
        const response: ExecuteInvestigationResponse = {
          phase: 'execute',
          incidentId: request.incidentId,
          state,
          executedStepIds,
          control: buildControl(request.context, {
            status: 'continue',
            nextPhase: '/evaluate',
            reason:
              'Execution completed and persisted concrete reasoning/tool outputs for evaluation.',
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
                        : 'retry_recommended',
                    warnings,
                  },
                }
              : {}),
          }),
          metadata: buildMetadata(request.context),
        };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/evaluate',
      validate: validateEvaluate,
      handler: async ({ body, res }) => {
        const request = body as EvaluateInvestigationRequest;
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
        state.findings = [
          {
            summary: summary.summary,
            confidence: latestEvidenceIds.length > 0 ? 0.7 : 0.4,
            ...(hypotheses.hypotheses[0]?.hypothesis
              ? { hypothesis: hypotheses.hypotheses[0].hypothesis }
              : {}),
            entities: [],
            evidenceRefs: evaluationEvidenceRefs,
            structuredSignals: state.lastSignals,
            metadata: {
              evidenceIds: latestEvidenceIds,
              llm: {
                summarizationOk: summaryResult.ok,
                hypothesisGenerationOk: hypothesisResult.ok,
                fallbackSignalExtractionOk: fallbackSignalResult.ok,
                openQuestions: hypotheses.openQuestions,
                missingInformation: summary.missingInformation,
                discardedSignals: validatedSignalExtraction.discardedSignals,
              },
            },
            createdAt: new Date().toISOString(),
          },
        ];
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
            status:
              state.iterationCount >= 2 || state.findings.length > 0
                ? 'stop'
                : 'continue',
            nextPhase:
              state.iterationCount >= 2 || state.findings.length > 0
                ? '/finalize'
                : '/plan',
            reason:
              state.iterationCount >= 2 || state.findings.length > 0
                ? 'Engine-controlled stop condition satisfied.'
                : 'Another planning iteration is required.',
            ...(latestEvidenceIds.length === 0
              ? {
                  partialFailure: {
                    affectedStepIds: [],
                    failedDependencyCount: 0,
                    handling: 'degraded_continue',
                    warnings: [
                      {
                        code: 'NO_EVIDENCE_IDS',
                        message:
                          'Evaluation proceeded with fallback signals because execution did not yield persisted evidence ids.',
                        retryable: false,
                      },
                    ],
                  },
                }
              : {}),
          }),
          metadata: buildMetadata(request.context),
        };
        sendJson(res, 200, response);
      },
    },
    {
      method: 'POST',
      path: '/finalize',
      validate: validateFinalize,
      handler: async ({ body, res }) => {
        const request = body as FinalizeInvestigationRequest;
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
          state.findings[0]?.summary ??
          `Investigation finalized for ${incident.title}.`;
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
          evidenceRefs: [],
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
        sendJson(res, 200, response);
      },
    },
  ],
);
