import type { BaseToolOutput, MetricsToolInput, ToolExecutionContext, ToolResult } from '../index.js';
import { StubToolAdapter } from './base.js';

export class CloudMonitoringAdapter extends StubToolAdapter<MetricsToolInput, BaseToolOutput> {
  readonly name = 'cloud-monitoring' as const;

  protected async executeWithProvider(
    input: MetricsToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    void input;
    void context;

    return {
      tool: this.name,
      status: 'partial',
      output: {
        signals: [],
        entities: [],
        evidence: [],
        summary: 'Cloud Monitoring adapter stub: provider SDK integration not implemented yet.',
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
    void input;
    void context;

    return {
      tool: this.name,
      status: 'partial',
      output: {
        signals: [],
        entities: [],
        evidence: [],
        summary: 'Grafana adapter stub: provider SDK integration not implemented yet.',
      },
    };
  }
}
