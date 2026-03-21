import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { resolveDatabaseConnectionOptions, type DatabaseEnvironment } from './config.js';
import * as schema from './schema/index.js';

export type DatabaseSchema = typeof schema;
export type DatabaseClient = PostgresJsDatabase<DatabaseSchema>;
export type PostgresClient = Sql<Record<string, unknown>>;
export type { DatabaseEnvironment, DatabaseSslMode } from './config.js';

export interface DatabaseConnectionOptions {
  connectionString: string;
  max?: number;
  ssl?: boolean | 'require' | 'allow' | 'prefer' | 'verify-full';
}

export interface DatabaseConnection {
  client: DatabaseClient;
  sql: PostgresClient;
  schema: DatabaseSchema;
  close: () => Promise<void>;
}

export const schemaModules = Object.freeze([
  'incidents',
  'investigation_state',
  'steps',
  'step_artifacts',
  'findings',
  'feedback',
  'tool_calls',
] as const);

export const createDatabaseClient = (
  options: DatabaseConnectionOptions,
): DatabaseConnection => {
  const sql = postgres(options.connectionString, {
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
  });

  return {
    client: drizzle(sql, { schema }),
    sql,
    schema,
    close: async () => {
      await sql.end();
    },
  };
};

export const createDatabaseClientFromEnv = (
  env: DatabaseEnvironment,
  overrides: Pick<DatabaseConnectionOptions, 'max'> = {},
): DatabaseConnection =>
  createDatabaseClient({
    ...resolveDatabaseConnectionOptions(env),
    ...overrides,
  });

export * from './config.js';
export * from './schema/index.js';
