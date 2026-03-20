import type {
  BaseToolOutput,
  EntityExtractionResult,
  EvidenceReference,
  LoggingToolInput,
  ToolExecutionContext,
  ToolResult,
  ToolSignal,
} from '../index.js';
import {
  asProviderArray,
  asProviderRecord,
  asProviderString,
  createEntity,
  createSignal,
  createToolExecutionError,
  dedupeById,
  extractProviderResponse,
  fetchJson,
  stableConfidence,
  stableId,
  StubToolAdapter,
} from './base.js';

const buildLoggingUrl = (projectId: string): string =>
  `https://logging.googleapis.com/v2/entries:list?alt=json&project=${encodeURIComponent(projectId)}`;

export class GcpLoggingAdapter extends StubToolAdapter<LoggingToolInput, BaseToolOutput> {
  readonly name = 'gcp-logging' as const;

  protected async executeWithProvider(
    input: LoggingToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    try {
      const response = await extractProviderResponse(this.name, input, context, async () => {
        const metadata = asProviderRecord(context.metadata);
        const projectId = asProviderString(metadata?.gcpProjectId) ?? asProviderString(metadata?.projectId);
        const accessToken = asProviderString(metadata?.accessToken);
        if (!projectId || !accessToken) {
          throw {
            status: 400,
            message: 'gcp-logging requires metadata.gcpProjectId and metadata.accessToken when no providerResponse is supplied.',
          };
        }
        return fetchJson(buildLoggingUrl(projectId), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            resourceNames: input.resourceNames?.length ? input.resourceNames : [`projects/${projectId}`],
            filter: input.query,
            pageSize: input.limit ?? 20,
            orderBy: 'timestamp desc',
          }),
        });
      });

      const entries = asProviderArray(asProviderRecord(response)?.entries);
      const evidence: EvidenceReference[] = [];
      const entities: EntityExtractionResult[] = [];
      const signals: ToolSignal[] = [];

      for (const entry of entries) {
        const record = asProviderRecord(entry);
        if (!record) continue;
        const logName = asProviderString(record.logName) ?? 'unknown-log';
        const insertId = asProviderString(record.insertId) ?? JSON.stringify(record);
        const capturedAt =
          asProviderString(record.timestamp) ?? asProviderString(record.receiveTimestamp) ?? context.now;
        const evidenceId = stableId(this.name, 'evidence', `${logName}:${insertId}`);
        const traceMetadata = asProviderString(record.trace);
        evidence.push({
          id: evidenceId,
          kind: 'log',
          title: asProviderString(record.textPayload) ?? `Log entry from ${logName}`,
          ...(capturedAt ? { capturedAt } : {}),
          source: this.name,
          logName,
          query: input.query,
          entryId: insertId,
          metadata: {
            severity: asProviderString(record.severity) ?? 'DEFAULT',
            resource: (asProviderRecord(record.resource) ?? {}) as never,
            ...(traceMetadata ? { trace: traceMetadata } : {}),
          },
        });

        const entryEntities: EntityExtractionResult[] = [];
        const trace = asProviderString(record.trace);
        if (trace) {
          entryEntities.push(createEntity(this.name, 'trace_id', trace, trace, [evidenceId], 0.92));
        }
        const spanId = asProviderString(record.spanId);
        if (spanId) {
          entryEntities.push(createEntity(this.name, 'span_id', spanId, spanId, [evidenceId], 0.9));
        }
        const labels = asProviderRecord(record.labels);
        const correlationId =
          asProviderString(labels?.correlation_id) ??
          asProviderString(labels?.correlationId) ??
          context.correlationIds[0];
        if (correlationId) {
          entryEntities.push(
            createEntity(this.name, 'correlation_id', correlationId, correlationId, [evidenceId], 0.88),
          );
        }
        const serviceName =
          asProviderString(asProviderRecord(record.resource)?.labels && asProviderRecord(asProviderRecord(record.resource)?.labels)?.service_name) ??
          asProviderString(asProviderRecord(record.resource)?.type);
        if (serviceName) {
          entryEntities.push(createEntity(this.name, 'service', serviceName, serviceName, [evidenceId], 0.8));
        }

        entities.push(...entryEntities);
        signals.push(
          createSignal(
            this.name,
            'observation',
            `log-entry:${logName}`,
            {
              severity: asProviderString(record.severity) ?? 'DEFAULT',
              insertId,
              ...(capturedAt ? { timestamp: capturedAt } : {}),
            },
            entryEntities.map((entity) => entity.id),
            [evidenceId],
            stableConfidence(undefined, 0.72),
            ['provider:gcp-logging', `log:${logName}`],
          ),
        );
      }

      return {
        tool: this.name,
        status: 'success',
        output: {
          signals: dedupeById(signals),
          entities: dedupeById(entities),
          evidence: dedupeById(evidence),
          summary: `Parsed ${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'} from Cloud Logging.`,
        },
      };
    } catch (error) {
      return {
        tool: this.name,
        status: 'error',
        error: createToolExecutionError(this.name, error),
      };
    }
  }
}
