import type {
  BaseToolOutput,
  LoggingToolInput,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';
import { createToolExecutionEnvelope } from '../index.js';
import { StubToolAdapter } from './base.js';

export class GcpLoggingAdapter extends StubToolAdapter<LoggingToolInput, BaseToolOutput> {
  readonly name = 'gcp-logging' as const;

  protected async executeWithProvider(
    input: LoggingToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    const summary = 'GCP Logging adapter stub: provider SDK integration not implemented yet.';
    const rawOutput = {
      contentType: 'json' as const,
      content: {
        query: input.query,
        filters: input.filters ?? {},
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
