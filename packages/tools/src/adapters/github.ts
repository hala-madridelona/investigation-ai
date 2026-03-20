import type { BaseToolOutput, GitHubToolInput, ToolExecutionContext, ToolResult } from '../index.js';
import { StubToolAdapter } from './base.js';

export class GitHubAdapter extends StubToolAdapter<GitHubToolInput, BaseToolOutput> {
  readonly name = 'github' as const;

  protected async executeWithProvider(
    input: GitHubToolInput,
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
        summary: 'GitHub adapter stub: provider SDK integration not implemented yet.',
      },
    };
  }
}
