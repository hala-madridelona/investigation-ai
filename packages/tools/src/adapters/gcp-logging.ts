import type { BaseToolOutput, LoggingToolInput, ToolExecutionContext, ToolResult } from '../index.js';
import { StubToolAdapter } from './base.js';

export class GcpLoggingAdapter extends StubToolAdapter<LoggingToolInput, BaseToolOutput> {
  readonly name = 'gcp-logging' as const;

  protected async executeWithProvider(
    input: LoggingToolInput,
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
        summary: 'GCP Logging adapter stub: provider SDK integration not implemented yet.',
      },
    };
  }
}
