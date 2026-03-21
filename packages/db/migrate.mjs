import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import { resolveDatabaseConnectionOptions } from './database-config.mjs';

const { connectionString, ssl } = resolveDatabaseConnectionOptions(process.env);
const sql = postgres(connectionString, { max: 1, ssl });
const db = drizzle(sql);
const migrationsFolder = new URL('./drizzle', import.meta.url);

try {
  await migrate(db, { migrationsFolder: migrationsFolder.pathname });
  console.log(`Applied database migrations from ${migrationsFolder.pathname}`);
} finally {
  await sql.end();
}
