import type { JsonObject, JsonValue } from '@investigation-ai/shared-types';
import {
  CloudMonitoringAdapter,
  GrafanaAdapter,
  FirestoreAdapter,
  GcpLoggingAdapter,
  GitHubAdapter,
} from './adapters/index.js';

export const investigationToolNames = [
  'gcp-logging',
  'firestore',
  'github',
  'cloud-monitoring',
  'grafana',
] as const;

export type InvestigationToolName = (typeof investigationToolNames)[number];

export const evidenceReferenceKinds = ['log', 'metric_chart', 'query', 'external_url'] as const;
export type EvidenceReferenceKind = (typeof evidenceReferenceKinds)[number];

export const extractedEntityKinds = [
  'incident',
  'correlation_id',
  'request_id',
  'trace_id',
  'span_id',
  'service',
  'user',
  'repository',
  'deployment',
  'document',
] as const;
export type ExtractedEntityKind = (typeof extractedEntityKinds)[number];

export const toolSignalKinds = [
  'observation',
  'metric',
  'anomaly',
  'correlation',
  'change_event',
] as const;
export type ToolSignalKind = (typeof toolSignalKinds)[number];

export const toolErrorKinds = [
  'auth',
  'rate_limit',
  'timeout',
  'network',
  'quota',
  'invalid_input',
  'not_found',
  'conflict',
  'dependency',
  'internal',
  'unknown',
] as const;
export type ToolErrorKind = (typeof toolErrorKinds)[number];

export const toolFailureModes = ['retryable', 'terminal'] as const;
export type ToolFailureMode = (typeof toolFailureModes)[number];

export interface ToolAuthContext {
  actorId?: string;
  subject?: string;
  scopes: string[];
  tokenRef?: string;
  metadata?: JsonObject;
}

export interface ToolExecutionContext {
  incidentId: string;
  correlationIds: string[];
  auth: ToolAuthContext;
  requestId?: string;
  executionId?: string;
  now?: string;
  metadata?: JsonObject;
}

export interface BaseToolInput {
  query: string;
  limit?: number;
  filters?: JsonObject;
  timeRange?: {
    start: string;
    end: string;
  };
}

export interface BaseToolOutput {
  signals: ToolSignal[];
  entities: EntityExtractionResult[];
  evidence: EvidenceReference[];
  summary?: string;
}

export interface ToolSignal {
  id: string;
  kind: ToolSignalKind;
  name: string;
  value: JsonValue;
  confidence: number;
  tags?: string[];
  entityIds: string[];
  evidenceIds: string[];
}

interface EvidenceReferenceBase {
  id: string;
  kind: EvidenceReferenceKind;
  title: string;
  capturedAt?: string;
  source: InvestigationToolName;
  metadata?: JsonObject;
}

export interface LogEvidenceReference extends EvidenceReferenceBase {
  kind: 'log';
  logName: string;
  query: string;
  entryId?: string;
}

export interface MetricChartEvidenceReference extends EvidenceReferenceBase {
  kind: 'metric_chart';
  chartName: string;
  metricType: string;
  dashboardUrl?: string;
}

export interface QueryEvidenceReference extends EvidenceReferenceBase {
  kind: 'query';
  queryLanguage: string;
  queryText: string;
}

export interface ExternalUrlEvidenceReference extends EvidenceReferenceBase {
  kind: 'external_url';
  url: string;
  label?: string;
}

export type EvidenceReference =
  | LogEvidenceReference
  | MetricChartEvidenceReference
  | QueryEvidenceReference
  | ExternalUrlEvidenceReference;

export interface EntityExtractionResult {
  id: string;
  kind: ExtractedEntityKind;
  value: string;
  displayName: string;
  confidence: number;
  evidenceIds: string[];
  attributes?: JsonObject;
}

export interface ToolErrorBase {
  kind: ToolErrorKind;
  mode: ToolFailureMode;
  message: string;
  retryAfterMs?: number;
  details?: JsonObject;
}

export interface RetryableToolError extends ToolErrorBase {
  mode: 'retryable';
}

export interface TerminalToolError extends ToolErrorBase {
  mode: 'terminal';
}

export type ToolExecutionError = RetryableToolError | TerminalToolError;

export interface ToolResult<TOutput extends BaseToolOutput = BaseToolOutput> {
  tool: InvestigationToolName;
  status: 'success' | 'partial' | 'error';
  output?: TOutput;
  error?: ToolExecutionError;
}

export interface InvestigationToolAdapter<
  TInput extends BaseToolInput = BaseToolInput,
  TOutput extends BaseToolOutput = BaseToolOutput,
> {
  readonly name: InvestigationToolName;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

export class InvestigationToolRegistry {
  private readonly adapters = new Map<InvestigationToolName, InvestigationToolAdapter>();

  register<TInput extends BaseToolInput, TOutput extends BaseToolOutput>(
    adapter: InvestigationToolAdapter<TInput, TOutput>,
  ): this {
    this.adapters.set(adapter.name, adapter as InvestigationToolAdapter);
    return this;
  }

  get(name: InvestigationToolName): InvestigationToolAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): InvestigationToolAdapter[] {
    return [...this.adapters.values()];
  }
}

export interface LoggingToolInput extends BaseToolInput {
  resourceNames?: string[];
}

export interface FirestoreToolInput extends BaseToolInput {
  collectionPath?: string;
  documentPath?: string;
}

export interface GitHubToolInput extends BaseToolInput {
  repository?: string;
  issueOrPullRequestNumber?: number;
}

export interface MetricsToolInput extends BaseToolInput {
  metricNames?: string[];
  dashboardUid?: string;
}

export {
  CloudMonitoringAdapter,
  GrafanaAdapter,
  FirestoreAdapter,
  GcpLoggingAdapter,
  GitHubAdapter,
};

export const createDefaultToolRegistry = (): InvestigationToolRegistry =>
  new InvestigationToolRegistry()
    .register(new GcpLoggingAdapter())
    .register(new FirestoreAdapter())
    .register(new GitHubAdapter())
    .register(new CloudMonitoringAdapter())
    .register(new GrafanaAdapter());
