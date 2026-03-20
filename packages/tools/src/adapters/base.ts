import type {
  BaseToolInput,
  BaseToolOutput,
  InvestigationToolAdapter,
  InvestigationToolName,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';
import { createToolRecordMetadata } from '../index.js';

export abstract class StubToolAdapter<
  TInput extends BaseToolInput,
  TOutput extends BaseToolOutput,
> implements InvestigationToolAdapter<TInput, TOutput>
{
  abstract readonly name: InvestigationToolName;

  async execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>> {
    const result = await this.executeWithProvider(input, context);
    return {
      ...result,
      recordMetadata: result.recordMetadata ?? createToolRecordMetadata(context),
    };
  }

  protected abstract executeWithProvider(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>>;
}
