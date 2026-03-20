import type {
  BaseToolOutput,
  MetricsToolInput,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';
import { createToolExecutionEnvelope } from '../index.js';
import { StubToolAdapter } from './base.js';

export class CloudMonitoringAdapter extends StubToolAdapter<MetricsToolInput, BaseToolOutput> {
  readonly name = 'cloud-monitoring' as const;

  protected async executeWithProvider(
    input: MetricsToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    const summary = 'Cloud Monitoring adapter stub: provider SDK integration not implemented yet.';
    const rawOutput = {
      contentType: 'json' as const,
      content: {
        query: input.query,
        metricNames: input.metricNames ?? [],
        dashboardUid: input.dashboardUid ?? null,
        correlationIds: context.correlationIds,
      },
    };
    const findings = [{ summary, evidenceRefs: [], confidence: 0.1 }];

    return {
      tool: this.name,
      status: 'partial',
      execution: createToolExecutionEnvelope(rawOutput, findings),
      output: {
        rawOutput,
        findings,
        signals: [],
        entities: [],
        evidence: [],
        summary,
      },
    };
  }
}

export class GrafanaAdapter extends StubToolAdapter<MetricsToolInput, BaseToolOutput> {
  readonly name = 'grafana' as const;

  protected async executeWithProvider(
    input: MetricsToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    const summary = 'Grafana adapter stub: provider SDK integration not implemented yet.';
    const rawOutput = {
      contentType: 'json' as const,
      content: {
        query: input.query,
        metricNames: input.metricNames ?? [],
        dashboardUid: input.dashboardUid ?? null,
        correlationIds: context.correlationIds,
      },
    };
    const findings = [{ summary, evidenceRefs: [], confidence: 0.1 }];

    return {
      tool: this.name,
      status: 'partial',
      execution: createToolExecutionEnvelope(rawOutput, findings),
      output: {
        rawOutput,
        findings,
        signals: [],
        entities: [],
        evidence: [],
        summary,
      },
    };
  }
}
