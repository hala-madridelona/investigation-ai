import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
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

const logLevelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class RequestValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(422, 'validation_error', message, details);
    this.name = 'RequestValidationError';
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

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
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
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
  shutdownTimeoutMs?: number;
}

export interface EnvConfig {
  PORT: number;
  LOG_LEVEL: LogLevel;
}

export const loadConfig = (
  env: NodeJS.ProcessEnv,
  defaultPort: number,
): EnvConfig => ({
  PORT: parsePort(env.PORT, defaultPort),
  LOG_LEVEL: parseLogLevel(env.LOG_LEVEL),
});

const parsePort = (value: string | undefined, defaultPort: number): number => {
  const resolved = value === undefined ? defaultPort : Number(value);
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 65535) {
    throw new ConfigValidationError(
      'PORT must be an integer between 1 and 65535',
    );
  }
  return resolved;
};

const parseLogLevel = (value?: string): LogLevel => {
  if (value === undefined || value.trim().length === 0) {
    return 'info';
  }
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
  ) {
    return value;
  }
  throw new ConfigValidationError(
    'LOG_LEVEL must be one of debug, info, warn, error',
  );
};

const dedupe = (values: Array<string | undefined | null>): string[] => [
  ...new Set(
    values.filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    ),
  ),
];

export const createRequestObservabilityContext = (
  req: IncomingMessage,
  serviceName: string,
  requestId: string,
): RequestObservabilityContext => {
  const header = req.headers['x-correlation-id'];
  const headerValues = Array.isArray(header) ? header : [header];
  const correlationIds = dedupe([
    ...headerValues.flatMap((value) =>
      (value ?? '').split(',').map((item) => item.trim()),
    ),
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

const mergeMetadata = (
  base: LogMetadata,
  metadata?: LogMetadata,
): LogMetadata => {
  const actor = metadata?.actor ?? base.actor;
  const source = metadata?.source ?? base.source;

  return {
    ...base,
    ...metadata,
    correlationIds: dedupe([
      ...(base.correlationIds ?? []),
      ...(metadata?.correlationIds ?? []),
    ]),
    ...(actor ? { actor } : {}),
    ...(source ? { source } : {}),
  };
};

const shouldLog = (
  configuredLevel: LogLevel,
  messageLevel: LogLevel,
): boolean => logLevelOrder[messageLevel] >= logLevelOrder[configuredLevel];

const writeLog = (
  configuredLevel: LogLevel,
  messageLevel: LogLevel,
  service: string,
  message: string,
  base: LogMetadata,
  metadata?: LogMetadata,
): void => {
  if (!shouldLog(configuredLevel, messageLevel)) {
    return;
  }
  const payload = mergeMetadata(base, metadata);
  const line = JSON.stringify({
    severity: messageLevel.toUpperCase(),
    level: messageLevel,
    timestamp: new Date().toISOString(),
    service,
    message,
    incidentId: payload.incidentId ?? null,
    investigationStepId: payload.investigationStepId ?? null,
    correlationIds: payload.correlationIds ?? [],
    actor: payload.actor ?? null,
    source: payload.source ?? null,
    ...payload,
  });
  if (messageLevel === 'error' || messageLevel === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
};

export const createLogger = (
  service: string,
  level: LogLevel,
  baseMetadata: LogMetadata = {},
): Logger => ({
  debug: (message, metadata = {}) =>
    writeLog(level, 'debug', service, message, baseMetadata, metadata),
  info: (message, metadata = {}) =>
    writeLog(level, 'info', service, message, baseMetadata, metadata),
  warn: (message, metadata = {}) =>
    writeLog(level, 'warn', service, message, baseMetadata, metadata),
  error: (message, metadata = {}) =>
    writeLog(level, 'error', service, message, baseMetadata, metadata),
  child: (metadata) =>
    createLogger(service, level, mergeMetadata(baseMetadata, metadata)),
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

export const createRecordMetadata = (
  options: RecordMetadataOptions,
): RecordMetadata => ({
  observedAt: options.observedAt ?? new Date().toISOString(),
  recordedAt: options.recordedAt ?? new Date().toISOString(),
  actor: options.actor,
  source: options.source,
  correlationIds: dedupe(options.correlationIds),
  ...(options.incidentId ? { incidentId: options.incidentId } : {}),
  ...(options.investigationStepId
    ? { investigationStepId: options.investigationStepId }
    : {}),
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

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
};

export const sendJson = (
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
};

const getRequestPath = (req: IncomingMessage): string | null => {
  if (!req.url) {
    return null;
  }

  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return req.url.split('?')[0] ?? null;
  }
};

const normalizeError = (error: unknown): HttpError => {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return new HttpError(
      400,
      'invalid_json',
      'Request body must be valid JSON',
    );
  }

  if (error instanceof Error) {
    return new HttpError(500, 'internal_error', error.message);
  }

  return new HttpError(500, 'internal_error', 'Unknown error');
};

export const createService = (
  config: ServiceConfig,
  routes: Route<unknown>[],
): void => {
  const shutdownTimeoutMs = config.shutdownTimeoutMs ?? 10000;
  const rootLogger = createLogger(config.serviceName, config.logLevel, {
    actor: {
      type: 'service',
      id: config.serviceName,
      displayName: config.serviceName,
    },
    source: {
      kind: 'http',
      id: config.serviceName,
      displayName: config.serviceName,
    },
  });
  let isShuttingDown = false;

  const server = createServer(async (req, res) => {
    const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
    const path = getRequestPath(req);
    const observability = createRequestObservabilityContext(
      req,
      config.serviceName,
      requestId,
    );
    const logger = rootLogger.child({
      requestId,
      correlationIds: observability.correlationIds,
      actor: observability.actor,
      source: observability.source,
      method: req.method,
      path,
    });
    const startedAt = Date.now();

    res.setHeader('x-request-id', requestId);

    try {
      if (!path || !req.method) {
        throw new HttpError(
          400,
          'invalid_request',
          'Request path and method are required',
        );
      }

      if (isShuttingDown && !(req.method === 'GET' && path === '/health')) {
        throw new HttpError(
          503,
          'service_unavailable',
          'Service is shutting down',
        );
      }

      if (req.method === 'GET' && path === '/health') {
        sendJson(res, isShuttingDown ? 503 : 200, {
          ok: !isShuttingDown,
          service: config.serviceName,
          status: isShuttingDown ? 'shutting_down' : 'ok',
          requestId,
        });
        return;
      }

      const route = routes.find(
        (candidate) =>
          candidate.method === req.method && candidate.path === path,
      );
      if (!route) {
        const pathMatch = routes.some((candidate) => candidate.path === path);
        if (pathMatch) {
          throw new HttpError(
            405,
            'method_not_allowed',
            `Method ${req.method} is not allowed for ${path}`,
          );
        }
        throw new HttpError(404, 'not_found', `Route ${path} was not found`);
      }

      const body = route.validate
        ? route.validate(await readJson(req))
        : ({} as unknown);
      await route.handler({ req, res, body, requestId, observability, logger });
    } catch (error) {
      const normalizedError = normalizeError(error);
      const logMethod =
        normalizedError.statusCode >= 500 ? logger.error : logger.warn;
      logMethod('request.failed', {
        requestId,
        method: req.method,
        path,
        statusCode: normalizedError.statusCode,
        errorCode: normalizedError.code,
        error: normalizedError.message,
        details: normalizedError.details,
      });
      if (!res.headersSent) {
        sendJson(res, normalizedError.statusCode, {
          error: normalizedError.code,
          message: normalizedError.message,
          requestId,
        });
      }
    } finally {
      logger.info('request.completed', {
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: req.headers['user-agent'] ?? null,
      });
    }
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    rootLogger.info('service.shutdown.started', {
      signal,
      timeoutMs: shutdownTimeoutMs,
    });

    server.close((error) => {
      if (error) {
        rootLogger.error('service.shutdown.failed', {
          signal,
          error: error.message,
        });
        process.exitCode = 1;
        return;
      }

      rootLogger.info('service.shutdown.completed', { signal });
    });

    const forceShutdownTimer = setTimeout(() => {
      rootLogger.error('service.shutdown.timeout', {
        signal,
        timeoutMs: shutdownTimeoutMs,
      });
      process.exit(1);
    }, shutdownTimeoutMs);
    forceShutdownTimer.unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(config.port, () => {
    rootLogger.info('service.started', { port: config.port });
  });
};

export const asObject = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RequestValidationError('Expected an object payload');
  }
  return input as Record<string, unknown>;
};

export const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RequestValidationError(`${field} must be a non-empty string`);
  }
  return value;
};

export const asOptionalString = (
  value: unknown,
  field: string,
): string | undefined => {
  if (value === undefined) return undefined;
  return asString(value, field);
};

export const asStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RequestValidationError(`${field} must be an array of strings`);
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
