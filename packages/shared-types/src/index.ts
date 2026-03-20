export const severities = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof severities)[number];

export const incidentStatuses = [
  'pending',
  'running',
  'completed',
  'failed',
] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

export const investigationStatuses = ['running', 'complete', 'failed'] as const;
export type InvestigationStatus = (typeof investigationStatuses)[number];

export const investigationStepTypes = [
  'tool_call',
  'reasoning',
  'decision',
] as const;
export type InvestigationStepType = (typeof investigationStepTypes)[number];

export const investigationStepStatuses = [
  'pending',
  'success',
  'failed',
  'skipped',
] as const;
export type InvestigationStepStatus =
  (typeof investigationStepStatuses)[number];

export const evidenceKinds = [
  'log',
  'metric',
  'trace',
  'db_record',
  'deployment_event',
  'artifact',
  'report',
  'gcs_object',
  'external_link',
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export const entityKinds = [
  'requestId',
  'userId',
  'serviceName',
  'deploymentId',
] as const;
export type EntityKind = (typeof entityKinds)[number];

export const signalCategories = [
  'symptom',
  'cause',
  'correlation',
  'change',
  'impact',
] as const;
export type SignalCategory = (typeof signalCategories)[number];

export const toolExecutionStatuses = ['success', 'failed', 'partial'] as const;
export type ToolExecutionStatus = (typeof toolExecutionStatuses)[number];

export const planStepStatuses = [
  'pending',
  'ready',
  'in_progress',
  'completed',
  'skipped',
] as const;
export type PlanStepStatus = (typeof planStepStatuses)[number];

export const finalReportStatuses = [
  'resolved',
  'mitigated',
  'needs_handoff',
  'inconclusive',
] as const;
export type FinalReportStatus = (typeof finalReportStatuses)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };


export interface ActorMetadata {
  type: 'service' | 'user' | 'system' | 'tool';
  id: string;
  displayName?: string;
}

export interface SourceMetadata {
  kind: 'http' | 'workflow' | 'tool' | 'database' | 'storage' | 'report';
  id: string;
  displayName?: string;
  origin?: string;
}

export interface RecordMetadata {
  observedAt: string;
  recordedAt: string;
  actor: ActorMetadata;
  source: SourceMetadata;
  correlationIds: string[];
  incidentId?: string;
  investigationStepId?: string;
}

export const persistenceDestinations = [
  'postgres',
  'gcs',
  'report_artifact',
  'debug_only',
] as const;
export type PersistenceDestination = (typeof persistenceDestinations)[number];

export interface PersistenceRule {
  destination: PersistenceDestination;
  description: string;
  includes: string[];
  excludes: string[];
  retention: string;
}

export interface RawToolOutput {
  content: JsonValue;
  contentType: 'json' | 'text' | 'binary_ref';
  storageRef?: string;
  truncated?: boolean;
}

export interface FindingSummary {
  summary: string;
  evidenceRefs: string[];
  confidence: number;
}

export interface ToolExecutionEnvelope {
  rawOutput: RawToolOutput;
  findings: FindingSummary[];
  persistedAt?: string;
  metadata?: JsonObject;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  source: string;
  locator: string;
  capturedAt?: string;
  metadata?: JsonObject;
  recordMetadata?: RecordMetadata;
}

export interface EntityBase {
  id: string;
  kind: EntityKind;
  value: string;
  displayName: string;
  confidence: number;
  aliases: string[];
  evidenceRefs: string[];
  correlationKeys: Record<string, string>;
  metadata?: JsonObject;
}

export interface RequestIdEntity extends EntityBase {
  kind: 'requestId';
  protocol?: 'http' | 'grpc' | 'async';
}

export interface UserIdEntity extends EntityBase {
  kind: 'userId';
  provider?: string;
}

export interface ServiceNameEntity extends EntityBase {
  kind: 'serviceName';
  environment?: string;
}

export interface DeploymentIdEntity extends EntityBase {
  kind: 'deploymentId';
  version?: string;
  environment?: string;
}

export type Entity =
  | RequestIdEntity
  | UserIdEntity
  | ServiceNameEntity
  | DeploymentIdEntity;

export interface StructuredSignal {
  name: string;
  category: SignalCategory;
  value: JsonValue;
  unit?: string;
  confidence: number;
  evidenceRefs: string[];
  entityIds: string[];
}

export interface ToolOutputSource {
  toolName: string;
  toolVersion?: string;
  executionId?: string;
}

export interface ToolOutput {
  rawSummary: string;
  rawOutput?: RawToolOutput;
  findings?: FindingSummary[];
  structuredSignals: StructuredSignal[];
  entities: Entity[];
  evidenceRefs: EvidenceRef[];
  confidence: number;
  source: ToolOutputSource;
  recordMetadata?: RecordMetadata;
}

export interface Incident {
  id?: string;
  externalId: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  serviceName: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  payload: JsonObject;
  entities: Entity[];
}

export type IncidentEvent = Incident;

export interface Finding {
  id?: string;
  incidentId?: string;
  summary: string;
  confidence: number;
  hypothesis?: string;
  entities: Entity[];
  evidenceRefs: EvidenceRef[];
  structuredSignals: StructuredSignal[];
  metadata?: JsonObject;
  recordMetadata?: RecordMetadata;
  createdAt?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  objective: string;
  rationale: string;
  status: PlanStepStatus;
  dependsOn: string[];
  toolRequestIds: string[];
  targetEntityIds: string[];
  stopIf: string[];
}

export interface ToolExecutionRequest {
  id: string;
  incidentId: string;
  stepId: string;
  toolName: string;
  rationale: string;
  input: JsonObject;
  targetEntityIds: string[];
  evidenceRefs: string[];
  correlationIds?: string[];
  requestedAt?: string;
  recordMetadata?: RecordMetadata;
}

export interface ToolExecutionResult {
  requestId: string;
  incidentId: string;
  stepId: string;
  status: ToolExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  error?: string;
  output: ToolOutput;
  recordMetadata?: RecordMetadata;
}

export interface InvestigationStep {
  id?: string;
  incidentId?: string;
  stepIndex: number;
  type: InvestigationStepType;
  status: InvestigationStepStatus;
  summary: string;
  toolName?: string;
  planStep?: PlanStep;
  input?: JsonObject | JsonValue[] | null;
  output?: ToolOutput | JsonObject | JsonValue[] | null;
  findings: Finding[];
  entityIds: string[];
  recordMetadata?: RecordMetadata;
  createdAt?: string;
}

export interface StopConditionEvaluation {
  shouldStop: boolean;
  reason: string;
  confidence: number;
  satisfiedConditions: string[];
  unsatisfiedConditions: string[];
  recommendedNextStepIds: string[];
}

export interface InvestigationState {
  incidentId: string;
  status: InvestigationStatus;
  iterationCount: number;
  stagnationCount: number;
  entities: Entity[];
  findings: Finding[];
  plan: PlanStep[];
  steps: InvestigationStep[];
  lastToolResults: ToolExecutionResult[];
  lastSignals: StructuredSignal[];
  stopCondition?: StopConditionEvaluation;
  metadata?: JsonObject;
  updatedAt?: string;
}

export interface FinalReport {
  incidentId: string;
  summary: string;
  conclusion: string;
  status: FinalReportStatus;
  findings: Finding[];
  entities: Entity[];
  timeline: InvestigationStep[];
  recommendations: string[];
  evidenceRefs: EvidenceRef[];
  recordMetadata?: RecordMetadata;
  createdAt?: string;
}

export type InvestigationReport = FinalReport;

export interface InitRequest {
  incident: Incident;
  initialEvidence: EvidenceRef[];
}

export interface InitResponse {
  incident: Incident;
  state: InvestigationState;
}

export interface PlanRequest {
  incident: Incident;
  state: InvestigationState;
  maxSteps?: number;
}

export interface PlanResponse {
  state: InvestigationState;
  steps: PlanStep[];
}

export interface ExecuteRequest {
  incident: Incident;
  state: InvestigationState;
  toolRequests: ToolExecutionRequest[];
}

export interface ExecuteResponse {
  state: InvestigationState;
  results: ToolExecutionResult[];
}

export interface EvaluateRequest {
  incident: Incident;
  state: InvestigationState;
  latestResults: ToolExecutionResult[];
}

export interface EvaluateResponse {
  state: InvestigationState;
  findings: Finding[];
  stopCondition: StopConditionEvaluation;
}

export interface FinalizeRequest {
  incident: Incident;
  state: InvestigationState;
}

export interface FinalizeResponse {
  report: FinalReport;
}

export const engineRoutes = {
  init: '/init',
  plan: '/plan',
  execute: '/execute',
  evaluate: '/evaluate',
  finalize: '/finalize',
} as const;

export interface EndpointContract<TPath extends string, TRequest, TResponse> {
  path: TPath;
  method: 'POST';
  request: TRequest;
  response: TResponse;
}

export type InitEndpointContract = EndpointContract<
  '/init',
  InitRequest,
  InitResponse
>;
export type PlanEndpointContract = EndpointContract<
  '/plan',
  PlanRequest,
  PlanResponse
>;
export type ExecuteEndpointContract = EndpointContract<
  '/execute',
  ExecuteRequest,
  ExecuteResponse
>;
export type EvaluateEndpointContract = EndpointContract<
  '/evaluate',
  EvaluateRequest,
  EvaluateResponse
>;
export type FinalizeEndpointContract = EndpointContract<
  '/finalize',
  FinalizeRequest,
  FinalizeResponse
>;

export const llmTaskKinds = [
  'summarization',
  'hypothesis_generation',
  'fallback_signal_extraction',
  'final_report_drafting',
] as const;
export type LlmTaskKind = (typeof llmTaskKinds)[number];

export interface LlmTaskEnvelope<TInput> {
  task: LlmTaskKind;
  instructionsVersion: 'v1';
  input: TInput;
  outputSchema: JsonObject;
  allowToolUse: false;
  allowLoopControl: false;
  allowPersistentStateMutation: false;
}

export interface SummaryBullet {
  text: string;
  evidenceRefs: string[];
  confidence: number;
}

export interface SummarizationRequest {
  incidentId: string;
  incidentTitle: string;
  findings: string[];
  evidenceIds: string[];
  maxBullets: number;
}

export interface SummarizationResponse {
  summary: string;
  bullets: SummaryBullet[];
  missingInformation: string[];
}

export interface HypothesisCandidate {
  hypothesis: string;
  rationale: string;
  confidence: number;
  evidenceRefs: string[];
}

export interface HypothesisGenerationRequest {
  incidentId: string;
  incidentSummary: string;
  findingSummaries: string[];
  maxHypotheses: number;
}

export interface HypothesisGenerationResponse {
  hypotheses: HypothesisCandidate[];
  openQuestions: string[];
}

export interface FallbackSignalCandidate {
  name: string;
  category: SignalCategory;
  value: JsonValue;
  confidence: number;
  evidenceRefs: string[];
  entityIds: string[];
}

export interface FallbackSignalExtractionRequest {
  incidentId: string;
  rawSignals: string[];
  knownEntityIds: string[];
  maxSignals: number;
}

export interface FallbackSignalExtractionResponse {
  signals: FallbackSignalCandidate[];
  discardedSignals: string[];
}

export interface FinalReportDraftRequest {
  incidentId: string;
  incidentTitle: string;
  summary: string;
  hypotheses: string[];
  findingSummaries: string[];
  recommendationLimit: number;
}

export interface FinalReportDraftResponse {
  summary: string;
  conclusion: string;
  status: FinalReportStatus;
  recommendations: string[];
}
