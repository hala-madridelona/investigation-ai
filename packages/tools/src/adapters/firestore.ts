import type { BaseToolOutput, FirestoreToolInput, ToolExecutionContext, ToolResult } from '../index.js';
import { StubToolAdapter } from './base.js';

export class FirestoreAdapter extends StubToolAdapter<FirestoreToolInput, BaseToolOutput> {
  readonly name = 'firestore' as const;

  protected async executeWithProvider(
    input: FirestoreToolInput,
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
        summary: 'Firestore adapter stub: provider SDK integration not implemented yet.',
      },
    };
  }
}
