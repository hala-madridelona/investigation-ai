import type {
  BaseToolInput,
  BaseToolOutput,
  InvestigationToolAdapter,
  InvestigationToolName,
  ToolExecutionContext,
  ToolResult,
} from '../index.js';

export abstract class StubToolAdapter<
  TInput extends BaseToolInput,
  TOutput extends BaseToolOutput,
> implements InvestigationToolAdapter<TInput, TOutput>
{
  abstract readonly name: InvestigationToolName;

  async execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>> {
    return this.executeWithProvider(input, context);
  }

  protected abstract executeWithProvider(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>>;
}
