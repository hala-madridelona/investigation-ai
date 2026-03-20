import type {
  BaseToolInput,
  BaseToolOutput,
  EntityExtractionResult,
  EvidenceReference,
  InvestigationToolAdapter,
  InvestigationToolName,
  ToolErrorKind,
  ToolExecutionContext,
  ToolExecutionError,
  ToolResult,
  ToolSignal,
} from '../index.js';
import type { JsonObject, JsonValue } from '@investigation-ai/shared-types';
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

type ProviderResponseResolver<TInput extends BaseToolInput> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<unknown>;

const clampConfidence = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asArray = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const toJsonValue = (value: unknown): JsonValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonValue(entry)]),
    ) as JsonObject;
  }
  return String(value);
};

const toJsonObject = (value: Record<string, unknown>): JsonObject =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, toJsonValue(entry)]),
  ) as JsonObject;

const inferErrorKind = (status: number | undefined, message: string): ToolErrorKind => {
  const normalized = message.toLowerCase();
  if (status === 400 || normalized.includes('invalid')) return 'invalid_input';
  if (status === 401 || status === 403 || normalized.includes('auth')) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 408 || normalized.includes('timeout')) return 'timeout';
  if (status === 429 && normalized.includes('quota')) return 'quota';
  if (status === 429 || normalized.includes('rate limit')) return 'rate_limit';
  if (normalized.includes('quota')) return 'quota';
  if (status !== undefined && status >= 500) return 'dependency';
  if (normalized.includes('network')) return 'network';
  return 'unknown';
};

export const stableId = (
  toolName: InvestigationToolName,
  namespace: string,
  seed: string,
): string => {
  const input = `${toolName}:${namespace}:${seed}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${toolName}-${namespace}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const stableConfidence = (
  primary: number | undefined,
  fallback = 0.65,
  ...candidates: Array<number | undefined>
): number => {
  const values = [primary, ...candidates].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (values.length === 0) {
    return clampConfidence(fallback, fallback);
  }
  return clampConfidence(values.reduce((sum, value) => sum + value, 0) / values.length, fallback);
};

export const createEntity = (
  toolName: InvestigationToolName,
  kind: EntityExtractionResult['kind'],
  value: string,
  displayName: string,
  evidenceIds: string[],
  confidence?: number,
  attributes?: Record<string, unknown>,
): EntityExtractionResult => ({
  id: stableId(toolName, 'entity', `${kind}:${value}`),
  kind,
  value,
  displayName,
  confidence: stableConfidence(confidence, 0.7),
  evidenceIds,
  ...(attributes ? { attributes: toJsonObject(attributes) } : {}),
});

export const createSignal = (
  toolName: InvestigationToolName,
  kind: ToolSignal['kind'],
  name: string,
  value: ToolSignal['value'],
  entityIds: string[],
  evidenceIds: string[],
  confidence?: number,
  tags?: string[],
): ToolSignal => ({
  id: stableId(toolName, 'signal', `${kind}:${name}:${JSON.stringify(value)}`),
  kind,
  name,
  value,
  confidence: stableConfidence(confidence, 0.68),
  entityIds,
  evidenceIds,
  ...(tags && tags.length > 0 ? { tags } : {}),
});

export const createToolExecutionError = (
  toolName: InvestigationToolName,
  error: unknown,
): ToolExecutionError => {
  const record = asRecord(error);
  const status = asNumber(record?.status) ?? asNumber(record?.code);
  const message =
    asString(record?.message) ??
    (error instanceof Error ? error.message : undefined) ??
    `${toolName} provider execution failed.`;
  const kind = inferErrorKind(status, message);
  const retryAfterMs = asNumber(record?.retryAfterMs);
  const details = record ?? { rawError: String(error) };
  const mode =
    kind === 'timeout' ||
    kind === 'network' ||
    kind === 'rate_limit' ||
    kind === 'quota' ||
    kind === 'dependency'
      ? 'retryable'
      : 'terminal';

  return {
    kind,
    mode,
    message,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    details: {
      ...toJsonObject(details),
      toolName,
      ...(status !== undefined ? { status } : {}),
    },
  };
};

export const extractProviderResponse = async <TInput extends BaseToolInput>(
  toolName: InvestigationToolName,
  input: TInput,
  context: ToolExecutionContext,
  resolveRemote: ProviderResponseResolver<TInput>,
): Promise<unknown> => {
  const inlineResponse = asRecord(input.filters)?.providerResponse ?? context.metadata?.providerResponse;
  if (inlineResponse !== undefined) {
    return inlineResponse;
  }
  return resolveRemote(input, context);
};

export const fetchJson = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<unknown> => {
  let response: { ok: boolean; status: number; statusText: string; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> };
  try {
    const fetchFn = (globalThis as unknown as { fetch: (input: string, init?: unknown) => Promise<typeof response> }).fetch;
    response = await fetchFn(url, init);
  } catch (error) {
    throw {
      message: error instanceof Error ? error.message : 'Network failure while contacting provider',
      code: 'NETWORK_ERROR',
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const body = asRecord(payload);
    const nestedError = asRecord(body?.error);
    throw {
      status: response.status,
      message:
        asString(nestedError?.message) ??
        asString(body?.message) ??
        `${response.status} ${response.statusText}`,
      details: body ?? { body: payload },
      retryAfterMs: asNumber(response.headers.get('retry-after')),
    };
  }

  return payload;
};

export const asProviderRecord = asRecord;
export const asProviderArray = asArray;
export const asProviderString = asString;
export const asProviderNumber = asNumber;
export const toProviderJsonObject = toJsonObject;
export const toProviderJsonValue = toJsonValue;
export const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};
export const dedupeEvidenceIds = (evidence: EvidenceReference[]): string[] =>
  dedupeById(evidence).map((item) => item.id);
