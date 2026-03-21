import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import type {
  ActorMetadata,
  JsonObject,
  RecordMetadata,
  SourceMetadata,
} from '@investigation-ai/shared-types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Handler<T> = (context: RequestContext<T>) => Promise<void> | void;
export type Validator<T> = (input: unknown) => T;

export interface RequestObservabilityContext {
  requestId: string;
  correlationIds: string[];
  actor: ActorMetadata;
  source: SourceMetadata;
  incidentId?: string;
  investigationStepId?: string;
}

export interface RequestContext<T> {
  req: IncomingMessage;
  res: ServerResponse;
  body: T;
  requestId: string;
  observability: RequestObservabilityContext;
  logger: Logger;
}

export interface LogMetadata {
  incidentId?: string;
  investigationStepId?: string;
  correlationIds?: string[];
  actor?: ActorMetadata;
  source?: SourceMetadata;
  [key: string]: unknown;
}

export interface Logger {
  info: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
  child: (metadata: LogMetadata) => Logger;
}

export interface Route<T> {
  method: 'GET' | 'POST';
  path: string;
  validate?: Validator<T>;
  handler: Handler<T>;
}

export interface ServiceConfig {
  serviceName: string;
  port: number;
  logLevel: LogLevel;
}

export interface EnvConfig {
  PORT: number;
  LOG_LEVEL: LogLevel;
}

export const loadConfig = (env: NodeJS.ProcessEnv, defaultPort: number): EnvConfig => ({
  PORT: Number(env.PORT ?? defaultPort),
  LOG_LEVEL: parseLogLevel(env.LOG_LEVEL),
});

const parseLogLevel = (value?: string): LogLevel => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
};

const dedupe = (values: Array<string | undefined | null>): string[] =>
  [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];

export const createRequestObservabilityContext = (
  req: IncomingMessage,
  serviceName: string,
  requestId: string,
): RequestObservabilityContext => {
  const header = req.headers['x-correlation-id'];
  const headerValues = Array.isArray(header) ? header : [header];
  const correlationIds = dedupe([
    ...headerValues.flatMap((value) => (value ?? '').split(',').map((item) => item.trim())),
    requestId,
  ]);

  return {
    requestId,
    correlationIds,
    actor: {
      type: 'service',
      id: serviceName,
      displayName: serviceName,
    },
    source: {
      kind: 'http',
      id: req.url ?? 'unknown',
      displayName: req.method ?? 'unknown',
      origin: req.headers.host,
    },
  };
};

const mergeMetadata = (base: LogMetadata, metadata?: LogMetadata): LogMetadata => ({
  ...base,
  ...metadata,
  correlationIds: dedupe([...(base.correlationIds ?? []), ...(metadata?.correlationIds ?? [])]),
  actor: metadata?.actor ?? base.actor,
  source: metadata?.source ?? base.source,
});

const writeLog = (
  level: LogLevel,
  service: string,
  message: string,
  base: LogMetadata,
  metadata?: LogMetadata,
): void => {
  const payload = mergeMetadata(base, metadata);
  const line = JSON.stringify({
    level,
    service,
    message,
    incidentId: payload.incidentId ?? null,
    investigationStepId: payload.investigationStepId ?? null,
    correlationIds: payload.correlationIds ?? [],
    actor: payload.actor ?? null,
    source: payload.source ?? null,
    ...payload,
  });
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
};

export const createLogger = (service: string, level: LogLevel, baseMetadata: LogMetadata = {}): Logger => ({
  info: (message, metadata = {}) => writeLog(level, service, message, baseMetadata, metadata),
  error: (message, metadata = {}) => writeLog('error', service, message, baseMetadata, metadata),
  child: (metadata) => createLogger(service, level, mergeMetadata(baseMetadata, metadata)),
});

export interface RecordMetadataOptions {
  observedAt?: string;
  recordedAt?: string;
  actor: ActorMetadata;
  source: SourceMetadata;
  correlationIds: string[];
  incidentId?: string;
  investigationStepId?: string;
}

export const createRecordMetadata = (options: RecordMetadataOptions): RecordMetadata => ({
  observedAt: options.observedAt ?? new Date().toISOString(),
  recordedAt: options.recordedAt ?? new Date().toISOString(),
  actor: options.actor,
  source: options.source,
  correlationIds: dedupe(options.correlationIds),
  ...(options.incidentId ? { incidentId: options.incidentId } : {}),
  ...(options.investigationStepId ? { investigationStepId: options.investigationStepId } : {}),
});

export interface PersistencePolicyCatalog {
  postgres: string[];
  gcs: string[];
  reportArtifacts: string[];
  debugOnly: string[];
}

export const defaultPersistencePolicyCatalog: PersistencePolicyCatalog = {
  postgres: [
    'incident records and workflow state',
    'step summaries, findings, entity ids, evidence reference ids',
    'record metadata with timestamps, actor, source, and correlation ids',
  ],
  gcs: [
    'full raw tool payloads and large tool responses',
    'evidence objects referenced by durable evidence ids',
    'serialized report payloads for downstream delivery',
  ],
  reportArtifacts: [
    'final report json or markdown',
    'curated charts, attachments, and evidence manifests referenced by the final report',
  ],
  debugOnly: [
    'transient provider diagnostics',
    'redaction-safe truncated request or response snippets used to debug adapters',
  ],
};

export const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

export const sendJson = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
};

export const createService = (config: ServiceConfig, routes: Route<unknown>[]): void => {
  const rootLogger = createLogger(config.serviceName, config.logLevel, {
    actor: { type: 'service', id: config.serviceName, displayName: config.serviceName },
    source: { kind: 'http', id: config.serviceName, displayName: config.serviceName },
  });
  const server = createServer(async (req, res) => {
    const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
    const observability = createRequestObservabilityContext(req, config.serviceName, requestId);
    const logger = rootLogger.child({
      correlationIds: observability.correlationIds,
      actor: observability.actor,
      source: observability.source,
    });
    const startedAt = Date.now();
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'invalid_request' });
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true, service: config.serviceName });
        return;
      }
      const route = routes.find((candidate) => candidate.method === req.method && candidate.path === req.url);
      if (!route) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      const body = route.validate ? route.validate(await readJson(req)) : ({} as unknown);
      await route.handler({ req, res, body, requestId, observability, logger });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('request.failed', { requestId, method: req.method, path: req.url, error: message });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message });
      }
    } finally {
      logger.info('request.completed', {
        requestId,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: req.headers['user-agent'] ?? null,
      });
    }
  });

  server.listen(config.port);
};

export const asObject = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Expected an object payload');
  }
  return input as Record<string, unknown>;
};

export const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
};

export const asOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  return asString(value, field);
};

export const asStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
};

export const withCorrelationHeader = (
  payload: JsonObject,
  observability: RequestObservabilityContext,
): JsonObject => ({
  ...payload,
  correlationIds: observability.correlationIds,
});
