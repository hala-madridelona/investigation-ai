import type {
  BaseToolOutput,
  FirestoreToolInput,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';
import { createToolExecutionEnvelope } from '../index.js';
import { StubToolAdapter } from './base.js';

export class FirestoreAdapter extends StubToolAdapter<FirestoreToolInput, BaseToolOutput> {
  readonly name = 'firestore' as const;

  protected async executeWithProvider(
    input: FirestoreToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    const summary = 'Firestore adapter stub: provider SDK integration not implemented yet.';
    const rawOutput = {
      contentType: 'json' as const,
      content: {
        query: input.query,
        documentPath: input.documentPath ?? null,
        collectionPath: input.collectionPath ?? null,
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
