import { defineConfig } from 'drizzle-kit';

import { resolveDatabaseConnectionOptions } from './database-config.mjs';

const { connectionString } = resolveDatabaseConnectionOptions(process.env);

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
