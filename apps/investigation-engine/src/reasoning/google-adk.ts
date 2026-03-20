import { InMemoryRunner, InMemorySessionService, LlmAgent } from '@google/adk';

import type {
  FallbackSignalExtractionRequest,
  FallbackSignalExtractionResponse,
  FinalReportDraftRequest,
  FinalReportDraftResponse,
  HypothesisGenerationRequest,
  HypothesisGenerationResponse,
  JsonObject,
  LlmTaskEnvelope,
  LlmTaskKind,
  SummarizationRequest,
  SummarizationResponse,
} from '@investigation-ai/shared-types';

export interface LlmCallResult<TOutput> {
  ok: boolean;
  task: LlmTaskKind;
  output?: TOutput;
  error?: string;
}

export interface InvestigationAdk {
  summarize: (
    input: SummarizationRequest,
  ) => Promise<LlmCallResult<SummarizationResponse>>;
  generateHypotheses: (
    input: HypothesisGenerationRequest,
  ) => Promise<LlmCallResult<HypothesisGenerationResponse>>;
  extractFallbackSignals: (
    input: FallbackSignalExtractionRequest,
  ) => Promise<LlmCallResult<FallbackSignalExtractionResponse>>;
  draftFinalReport: (
    input: FinalReportDraftRequest,
  ) => Promise<LlmCallResult<FinalReportDraftResponse>>;
}

const summarizationSchema = {
  type: 'object',
  required: ['summary', 'bullets', 'missingInformation'],
} satisfies JsonObject;

const hypothesisSchema = {
  type: 'object',
  required: ['hypotheses', 'openQuestions'],
} satisfies JsonObject;

const fallbackSignalSchema = {
  type: 'object',
  required: ['signals', 'discardedSignals'],
} satisfies JsonObject;

const finalReportSchema = {
  type: 'object',
  required: ['summary', 'conclusion', 'status', 'recommendations'],
} satisfies JsonObject;

const buildEnvelope = <TInput>(
  task: LlmTaskKind,
  input: TInput,
  outputSchema: JsonObject,
): LlmTaskEnvelope<TInput> => ({
  task,
  instructionsVersion: 'v1',
  input,
  outputSchema,
  allowToolUse: false,
  allowLoopControl: false,
  allowPersistentStateMutation: false,
});

const renderPrompt = <TInput>(envelope: LlmTaskEnvelope<TInput>): string =>
  [
    'You are a deterministic subroutine for an investigation engine.',
    'Return JSON only. Do not call tools. Do not decide loop termination. Do not mutate persistent state.',
    'Follow the outputSchema exactly and omit markdown.',
    `task=${envelope.task}`,
    `instructionsVersion=${envelope.instructionsVersion}`,
    `outputSchema=${JSON.stringify(envelope.outputSchema)}`,
    `input=${JSON.stringify(envelope.input)}`,
  ].join('\n');

const collectText = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item));
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  return [
    ...collectText(record.text),
    ...collectText(record.content),
    ...collectText(record.parts),
    ...collectText(record.messages),
    ...collectText(record.events),
    ...collectText(record.response),
  ];
};

const parseStructuredOutput = <TOutput>(rawText: string): TOutput => {
  const trimmed = rawText.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('ADK response did not contain a JSON object');
  }
  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as TOutput;
};

const callTask = async <TInput, TOutput>(
  model: string,
  task: LlmTaskKind,
  input: TInput,
  outputSchema: JsonObject,
): Promise<LlmCallResult<TOutput>> => {
  const sessionService = new InMemorySessionService();
  const agent = new LlmAgent({
    name: `${task}_worker`,
    description: `Structured ${task} worker for the investigation engine`,
    model,
    instruction:
      'Return a single JSON object. Tool usage, loop control, and state mutation are forbidden.',
    tools: [],
  });
  const runner = new InMemoryRunner(agent, {
    appName: 'investigation-engine',
    sessionService,
  });

  try {
    const envelope = buildEnvelope(task, input, outputSchema);
    const result = await runner.runAsync({
      userId: 'investigation-engine',
      sessionId: `${task}-${Date.now()}`,
      newMessage: {
        role: 'user',
        parts: [{ text: renderPrompt(envelope) }],
      },
    });
    const rawText = collectText(result).join('\n');
    return {
      ok: true,
      task,
      output: parseStructuredOutput<TOutput>(rawText),
    };
  } catch (error) {
    return {
      ok: false,
      task,
      error: error instanceof Error ? error.message : 'Unknown ADK error',
    };
  }
};

export const createInvestigationAdk = (model: string): InvestigationAdk => ({
  summarize: (input) =>
    callTask<SummarizationRequest, SummarizationResponse>(
      model,
      'summarization',
      input,
      summarizationSchema,
    ),
  generateHypotheses: (input) =>
    callTask<HypothesisGenerationRequest, HypothesisGenerationResponse>(
      model,
      'hypothesis_generation',
      input,
      hypothesisSchema,
    ),
  extractFallbackSignals: (input) =>
    callTask<FallbackSignalExtractionRequest, FallbackSignalExtractionResponse>(
      model,
      'fallback_signal_extraction',
      input,
      fallbackSignalSchema,
    ),
  draftFinalReport: (input) =>
    callTask<FinalReportDraftRequest, FinalReportDraftResponse>(
      model,
      'final_report_drafting',
      input,
      finalReportSchema,
    ),
});
