import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Handler<T> = (context: RequestContext<T>) => Promise<void> | void;
export type Validator<T> = (input: unknown) => T;

export interface RequestContext<T> {
  req: IncomingMessage;
  res: ServerResponse;
  body: T;
  requestId: string;
  logger: Logger;
}

export interface Logger {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
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
  DATABASE_URL: string;
  DATABASE_SSL: boolean;
}

export const loadConfig = (env: NodeJS.ProcessEnv, defaultPort: number): EnvConfig => ({
  PORT: Number(env.PORT ?? defaultPort),
  LOG_LEVEL: parseLogLevel(env.LOG_LEVEL),
  DATABASE_URL: requiredString(env.DATABASE_URL, 'DATABASE_URL'),
  DATABASE_SSL: env.DATABASE_SSL === 'true',
});

const parseLogLevel = (value?: string): LogLevel => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
};

const requiredString = (value: string | undefined, name: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

export const createLogger = (service: string, level: LogLevel): Logger => ({
  info: (message, metadata = {}) => console.log(JSON.stringify({ level, service, message, ...metadata })),
  error: (message, metadata = {}) => console.error(JSON.stringify({ level: 'error', service, message, ...metadata })),
});

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
  const logger = createLogger(config.serviceName, config.logLevel);
  const server = createServer(async (req, res) => {
    const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
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
      await route.handler({ req, res, body, requestId, logger });
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
