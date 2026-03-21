const connectionModes = new Set(['url', 'host', 'socket']);
const sslModes = new Set(['disable', 'require', 'allow', 'prefer', 'verify-full']);

const requiredString = (value, name) => {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
};

const parseSslMode = (env) => {
  const explicitMode = env.DATABASE_SSL_MODE?.trim();
  if (explicitMode) {
    if (sslModes.has(explicitMode)) {
      return explicitMode;
    }

    throw new Error(`DATABASE_SSL_MODE must be one of ${Array.from(sslModes).join(', ')}`);
  }

  return env.DATABASE_SSL === 'true' ? 'require' : 'disable';
};

const parseConnectionMode = (env) => {
  const explicitMode = env.DATABASE_CONNECTION_MODE?.trim();
  if (explicitMode) {
    if (connectionModes.has(explicitMode)) {
      return explicitMode;
    }

    throw new Error(
      `DATABASE_CONNECTION_MODE must be one of ${Array.from(connectionModes).join(', ')}`,
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

const toSslOption = (sslMode) => (sslMode === 'disable' ? undefined : sslMode);

const resolveSocketPath = (env) => {
  const socketPath = requiredString(env.DATABASE_SOCKET_PATH, 'DATABASE_SOCKET_PATH');
  return socketPath.endsWith('/') ? socketPath.slice(0, -1) : socketPath;
};

export const resolveDatabaseConnectionOptions = (env) => {
  const connectionMode = parseConnectionMode(env);
  const sslMode = parseSslMode(env);

  if (connectionMode === 'url') {
    return {
      connectionString: requiredString(env.DATABASE_URL, 'DATABASE_URL'),
      ssl: toSslOption(sslMode),
    };
  }

  const databaseName = requiredString(env.DATABASE_NAME, 'DATABASE_NAME');
  const databaseUser = requiredString(env.DATABASE_USER, 'DATABASE_USER');
  const databasePassword = requiredString(env.DATABASE_PASSWORD, 'DATABASE_PASSWORD');
  const encodedDatabaseUser = encodeURIComponent(databaseUser);
  const encodedDatabasePassword = encodeURIComponent(databasePassword);

  if (connectionMode === 'socket') {
    const socketPath = resolveSocketPath(env);
    return {
      connectionString: `postgresql://${encodedDatabaseUser}:${encodedDatabasePassword}@/${databaseName}?host=${encodeURIComponent(socketPath)}`,
      ssl: toSslOption(sslMode),
    };
  }

  const databaseHost = requiredString(env.DATABASE_HOST, 'DATABASE_HOST');
  const databasePort = env.DATABASE_PORT?.trim() || '5432';

  return {
    connectionString: `postgresql://${encodedDatabaseUser}:${encodedDatabasePassword}@${databaseHost}:${databasePort}/${databaseName}`,
    ssl: toSslOption(sslMode),
  };
};
