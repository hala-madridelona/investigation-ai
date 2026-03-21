export const databaseConnectionModes = ['url', 'host', 'socket'] as const;
export type DatabaseConnectionMode = (typeof databaseConnectionModes)[number];

export const databaseSslModes = [
  'disable',
  'require',
  'allow',
  'prefer',
  'verify-full',
] as const;
export type DatabaseSslMode = (typeof databaseSslModes)[number];

export interface DatabaseEnvironment {
  DATABASE_URL?: string;
  DATABASE_CONNECTION_MODE?: string;
  DATABASE_HOST?: string;
  DATABASE_PORT?: string;
  DATABASE_NAME?: string;
  DATABASE_USER?: string;
  DATABASE_PASSWORD?: string;
  DATABASE_SOCKET_PATH?: string;
  DATABASE_SSL?: string;
  DATABASE_SSL_MODE?: string;
}

export interface ResolvedDatabaseConnection {
  connectionString: string;
  ssl?: boolean | Exclude<DatabaseSslMode, 'disable'>;
}

const requiredString = (value: string | undefined, name: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
};

const parseSslMode = (env: DatabaseEnvironment): DatabaseSslMode => {
  const explicitMode = env.DATABASE_SSL_MODE?.trim();
  if (explicitMode) {
    if (databaseSslModes.includes(explicitMode as DatabaseSslMode)) {
      return explicitMode as DatabaseSslMode;
    }

    throw new Error(
      `DATABASE_SSL_MODE must be one of ${databaseSslModes.join(', ')}`,
    );
  }

  return env.DATABASE_SSL === 'true' ? 'require' : 'disable';
};

const parseConnectionMode = (env: DatabaseEnvironment): DatabaseConnectionMode => {
  const explicitMode = env.DATABASE_CONNECTION_MODE?.trim();
  if (explicitMode) {
    if (databaseConnectionModes.includes(explicitMode as DatabaseConnectionMode)) {
      return explicitMode as DatabaseConnectionMode;
    }

    throw new Error(
      `DATABASE_CONNECTION_MODE must be one of ${databaseConnectionModes.join(', ')}`,
    );
  }

  if (env.DATABASE_URL?.trim()) {
    return 'url';
  }

  if (env.DATABASE_SOCKET_PATH?.trim()) {
    return 'socket';
  }

  return 'host';
};

const toSslOption = (
  sslMode: DatabaseSslMode,
): ResolvedDatabaseConnection['ssl'] | undefined => {
  if (sslMode === 'disable') {
    return undefined;
  }

  return sslMode;
};

const resolveSocketPath = (env: DatabaseEnvironment): string => {
  const socketPath = requiredString(env.DATABASE_SOCKET_PATH, 'DATABASE_SOCKET_PATH');
  return socketPath.endsWith('/') ? socketPath.slice(0, -1) : socketPath;
};

export const resolveDatabaseConnectionOptions = (
  env: DatabaseEnvironment,
): ResolvedDatabaseConnection => {
  const connectionMode = parseConnectionMode(env);
  const sslMode = parseSslMode(env);

  if (connectionMode === 'url') {
    const ssl = toSslOption(sslMode);
    return {
      connectionString: requiredString(env.DATABASE_URL, 'DATABASE_URL'),
      ...(ssl ? { ssl } : {}),
    };
  }

  const databaseName = requiredString(env.DATABASE_NAME, 'DATABASE_NAME');
  const databaseUser = requiredString(env.DATABASE_USER, 'DATABASE_USER');
  const databasePassword = requiredString(env.DATABASE_PASSWORD, 'DATABASE_PASSWORD');
  const encodedDatabaseUser = encodeURIComponent(databaseUser);
  const encodedDatabasePassword = encodeURIComponent(databasePassword);

  if (connectionMode === 'socket') {
    const socketPath = resolveSocketPath(env);
    const ssl = toSslOption(sslMode);
    return {
      connectionString: `postgresql://${encodedDatabaseUser}:${encodedDatabasePassword}@/${databaseName}?host=${encodeURIComponent(socketPath)}`,
      ...(ssl ? { ssl } : {}),
    };
  }

  const databaseHost = requiredString(env.DATABASE_HOST, 'DATABASE_HOST');
  const databasePort = env.DATABASE_PORT?.trim() || '5432';

  const ssl = toSslOption(sslMode);

  return {
    connectionString: `postgresql://${encodedDatabaseUser}:${encodedDatabasePassword}@${databaseHost}:${databasePort}/${databaseName}`,
    ...(ssl ? { ssl } : {}),
  };
};
