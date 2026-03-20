import type {
  BaseToolOutput,
  GitHubToolInput,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';
import { createToolExecutionEnvelope } from '../index.js';
import { StubToolAdapter } from './base.js';

export class GitHubAdapter extends StubToolAdapter<GitHubToolInput, BaseToolOutput> {
  readonly name = 'github' as const;

  protected async executeWithProvider(
    input: GitHubToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    const summary = 'GitHub adapter stub: provider SDK integration not implemented yet.';
    const rawOutput = {
      contentType: 'json' as const,
      content: {
        query: input.query,
        repository: input.repository ?? null,
        issueOrPullRequestNumber: input.issueOrPullRequestNumber ?? null,
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
