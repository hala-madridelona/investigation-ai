# @investigation-ai/db

`@investigation-ai/db` keeps the Drizzle schema definitions in `src/schema/` as the source of truth, generates SQL migrations into `drizzle/`, and exposes runtime helpers that let services connect to Postgres in the same way locally and in managed environments.

## Source of truth and migration workflow

- Schema definitions live in `src/schema/*.ts` and are re-exported from `src/schema/index.ts`.
- Generated migration SQL lives in `drizzle/`.
- `drizzle.config.mjs` points Drizzle Kit at the schema index and the shared connection resolver.

Run these commands from `packages/db/` or via `pnpm --filter @investigation-ai/db <script>`:

- `pnpm db:generate` — compare `src/schema/` with the existing migration journal and emit a new SQL migration in `drizzle/`.
- `pnpm db:check` — validate that the configured database is in sync with the generated migration history.
- `pnpm db:migrate` — apply the SQL files in `drizzle/` using the same connection settings the apps use at runtime.

## Connection environment variables

The database package resolves connections in this order unless `DATABASE_CONNECTION_MODE` is set explicitly:

1. `url` when `DATABASE_URL` is present.
2. `socket` when `DATABASE_SOCKET_PATH` is present.
3. `host` otherwise.

### Shared variables

- `DATABASE_CONNECTION_MODE` — optional explicit mode: `url`, `host`, or `socket`.
- `DATABASE_SSL_MODE` — optional SSL mode: `disable`, `require`, `allow`, `prefer`, or `verify-full`.
- `DATABASE_SSL` — legacy boolean fallback. When `true`, it maps to `DATABASE_SSL_MODE=require`.

### URL mode

Use this when the environment already provides a full DSN, for example a secret injected into Cloud Run or a local `.env` file.

Required variables:

- `DATABASE_URL`

Example:

```bash
export DATABASE_URL='postgresql://app_user:secret@127.0.0.1:5432/investigation'
export DATABASE_SSL_MODE='require'
```

### Host mode

Use this when the platform exposes a private IP or hostname for the database.

Required variables:

- `DATABASE_HOST`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`

Optional variables:

- `DATABASE_PORT` — defaults to `5432`
- `DATABASE_SSL_MODE`

Example:

```bash
export DATABASE_CONNECTION_MODE='host'
export DATABASE_HOST='10.20.0.15'
export DATABASE_PORT='5432'
export DATABASE_NAME='prod-investigation'
export DATABASE_USER='postgres'
export DATABASE_PASSWORD='***'
export DATABASE_SSL_MODE='require'
```

### Socket mode

Use this when the runtime mounts a Unix socket for a managed Postgres endpoint, such as a connector or sidecar/proxy that exposes `/cloudsql/<instance>` or another socket directory.

Required variables:

- `DATABASE_SOCKET_PATH`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`

Optional variables:

- `DATABASE_SSL_MODE`

Example:

```bash
export DATABASE_CONNECTION_MODE='socket'
export DATABASE_SOCKET_PATH='/cloudsql/project:region:instance'
export DATABASE_NAME='prod-investigation'
export DATABASE_USER='postgres'
export DATABASE_PASSWORD='***'
```

## Service expectations

Both `apps/intake-service` and `apps/investigation-engine` call `createDatabaseClientFromEnv(process.env)`, so they can use the same environment-variable contract as the migration scripts. That keeps application runtime and schema application aligned across local development, CI, and managed deployments.
