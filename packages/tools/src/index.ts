import type { InvestigationSignal } from '@investigation-ai/shared-types';

export interface ToolExecutionContext {
  incidentId: string;
  correlationId: string;
}

export interface ToolAdapter<TResult> {
  name: string;
  execute(context: ToolExecutionContext): Promise<TResult>;
}

export interface SignalProvider extends ToolAdapter<InvestigationSignal[]> {}
