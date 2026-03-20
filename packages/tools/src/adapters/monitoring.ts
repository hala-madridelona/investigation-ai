import type {
  BaseToolOutput,
  EntityExtractionResult,
  EvidenceReference,
  MetricsToolInput,
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

const buildMonitoringUrl = (projectId: string, filter: string): string =>
  `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?filter=${encodeURIComponent(filter)}`;

const parseNumericPoint = (point: Record<string, unknown> | null): number | null => {
  if (!point) return null;
  const value = asProviderRecord(point.value);
  const distribution = asProviderRecord(value?.distributionValue);
  const candidates = [value?.doubleValue, value?.int64Value, distribution?.count];
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

export class CloudMonitoringAdapter extends StubToolAdapter<MetricsToolInput, BaseToolOutput> {
  readonly name = 'cloud-monitoring' as const;

  protected async executeWithProvider(
    input: MetricsToolInput,
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
            message: 'cloud-monitoring requires metadata.gcpProjectId and metadata.accessToken when no providerResponse is supplied.',
          };
        }
        const metricFilter = input.metricNames?.length
          ? `metric.type = one_of(${input.metricNames.map((name) => `\"${name}\"`).join(',')})`
          : input.query;
        return fetchJson(buildMonitoringUrl(projectId, metricFilter), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      });

      const series = asProviderArray(asProviderRecord(response)?.timeSeries);
      const evidence: EvidenceReference[] = [];
      const entities: EntityExtractionResult[] = [];
      const signals: ToolSignal[] = [];

      for (const row of series) {
        const item = asProviderRecord(row);
        if (!item) continue;
        const metricType = asProviderString(asProviderRecord(item.metric)?.type) ?? 'unknown.metric';
        const resourceType = asProviderString(asProviderRecord(item.resource)?.type) ?? 'generic_resource';
        const points = asProviderArray(item.points).map((point) => asProviderRecord(point));
        const latestPoint = points[0] ?? null;
        const latestValue = parseNumericPoint(latestPoint);
        const evidenceId = stableId(this.name, 'evidence', `${metricType}:${resourceType}`);
        const capturedAt =
          asProviderString(asProviderRecord(latestPoint?.interval)?.endTime) ??
          asProviderString(asProviderRecord(latestPoint?.interval)?.startTime) ??
          context.now;
        const dashboardUrl = asProviderString(asProviderRecord(context.metadata)?.dashboardUrl);
        evidence.push({
          id: evidenceId,
          kind: 'metric_chart',
          title: `Metric ${metricType}`,
          ...(capturedAt ? { capturedAt } : {}),
          source: this.name,
          chartName: metricType,
          metricType,
          ...(dashboardUrl ? { dashboardUrl } : {}),
          metadata: {
            resourceType,
            pointCount: points.length,
          },
        });

        const metricEntities: EntityExtractionResult[] = [];
        const serviceName = asProviderString(asProviderRecord(item.resource)?.labels && asProviderRecord(asProviderRecord(item.resource)?.labels)?.service_name);
        if (serviceName) {
          metricEntities.push(createEntity(this.name, 'service', serviceName, serviceName, [evidenceId], 0.82));
        }
        entities.push(...metricEntities);
        signals.push(
          createSignal(
            this.name,
            latestValue !== null && latestValue > 0 ? 'metric' : 'observation',
            `metric:${metricType}`,
            {
              latestValue,
              resourceType,
              points: points.length,
            },
            metricEntities.map((entity) => entity.id),
            [evidenceId],
            stableConfidence(undefined, 0.8),
            ['provider:cloud-monitoring', `metric:${metricType}`],
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
          summary: `Parsed ${series.length} Cloud Monitoring time series.`,
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

export class GrafanaAdapter extends StubToolAdapter<MetricsToolInput, BaseToolOutput> {
  readonly name = 'grafana' as const;

  protected async executeWithProvider(
    input: MetricsToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    try {
      const response = await extractProviderResponse(this.name, input, context, async () => {
        const metadata = asProviderRecord(context.metadata);
        const grafanaUrl = asProviderString(metadata?.grafanaUrl);
        const apiKey = asProviderString(metadata?.grafanaApiKey);
        if (!grafanaUrl || !apiKey) {
          throw {
            status: 400,
            message: 'grafana requires metadata.grafanaUrl and metadata.grafanaApiKey when no providerResponse is supplied.',
          };
        }
        return fetchJson(`${grafanaUrl.replace(/\/$/, '')}/api/ds/query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            queries: [
              {
                refId: 'A',
                datasource: { type: 'prometheus', uid: input.dashboardUid ?? 'default' },
                expr: input.query,
              },
            ],
            from: input.timeRange?.start,
            to: input.timeRange?.end,
          }),
        });
      });

      const results = asProviderRecord(asProviderRecord(response)?.results);
      const resultA = asProviderRecord(results?.A);
      const frames = asProviderArray(resultA?.frames);
      const evidence: EvidenceReference[] = [];
      const signals: ToolSignal[] = [];
      const entities: EntityExtractionResult[] = [];

      for (const frame of frames) {
        const item = asProviderRecord(frame);
        if (!item) continue;
        const schema = asProviderRecord(item.schema);
        const fields = asProviderArray(schema?.fields);
        const title = asProviderString(item.name) ?? input.dashboardUid ?? 'Grafana frame';
        const evidenceId = stableId(this.name, 'evidence', `${title}:${JSON.stringify(fields)}`);
        const capturedAt = context.now;
        const dashboardUrl = asProviderString(asProviderRecord(context.metadata)?.grafanaDashboardUrl);
        evidence.push({
          id: evidenceId,
          kind: 'metric_chart',
          title,
          ...(capturedAt ? { capturedAt } : {}),
          source: this.name,
          chartName: title,
          metricType: input.query,
          ...(dashboardUrl ? { dashboardUrl } : {}),
          metadata: {
            frameFields: fields.length,
            ...(input.dashboardUid ? { dashboardUid: input.dashboardUid } : {}),
          },
        });
        signals.push(
          createSignal(
            this.name,
            'metric',
            `grafana:${title}`,
            { query: input.query, fieldCount: fields.length },
            [],
            [evidenceId],
            stableConfidence(undefined, 0.76),
            ['provider:grafana'],
          ),
        );
      }

      return {
        tool: this.name,
        status: 'success',
        output: {
          signals: dedupeById(signals),
          entities,
          evidence: dedupeById(evidence),
          summary: `Parsed ${frames.length} Grafana frame${frames.length === 1 ? '' : 's'}.`,
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
