# investigation-ai

Monorepo workspace for the Investigation AI platform. The repository is organized so deployable services live in `apps/`, reusable domain libraries live in `packages/`, infrastructure code lives in `infra/`, and architectural documentation lives in `docs/architecture`.

## Repository layout

```text
.
├── apps/
│   ├── intake-service/         # Cloud Run PagerDuty webhook ingestion service
│   └── investigation-engine/   # Cloud Run orchestration API for investigation lifecycle
├── packages/
│   ├── db/                     # Drizzle schema, migrations, and DB client
│   ├── shared-types/           # Shared incident/entity/signal/report schemas
│   ├── tools/                  # Typed tool interfaces and provider adapters
│   └── workflow-contracts/     # Contracts shared with GCP Workflows and services
├── infra/
│   └── cdktf/                  # CDKTF application for GCP infrastructure
└── docs/
    └── architecture/           # System diagrams, sequence flows, and ADRs
```

## Workspace conventions

- **pnpm workspaces** manage package relationships across `apps/*`, `packages/*`, and `infra/*`.
- **Strict TypeScript** is enforced from `tsconfig.base.json` and extended by every workspace package.
- **Package boundaries** keep schemas and contracts in `packages/` so services consume shared modules rather than duplicate definitions.
- **ESLint + Prettier** provide consistent linting and formatting across all TypeScript packages.
- Every workspace package includes `dev`, `build`, `lint`, and `typecheck` scripts so the root commands can orchestrate the entire repository.

## Root commands

- `pnpm dev` — run all package `dev` scripts in parallel
- `pnpm build` — build every workspace package
- `pnpm lint` — lint every workspace package
- `pnpm typecheck` — run TypeScript type-checking everywhere
- `pnpm format` / `pnpm format:write` — check or fix formatting

## Getting started

1. Install dependencies with `pnpm install`.
2. Build shared packages first with `pnpm build` or target a package with `pnpm --filter <name> build`.
3. Start app-local development with `pnpm --filter @investigation-ai/intake-service dev` or `pnpm --filter @investigation-ai/investigation-engine dev`.

## Next implementation steps

- Add runtime frameworks for the Cloud Run services.
- Define the first shared schemas and contracts in `packages/shared-types` and `packages/workflow-contracts`.
- Add Drizzle migrations and environment-specific database configuration in `packages/db`.
- Extend `infra/cdktf` with the actual GCP stacks and environments.
- Capture architecture decision records in `docs/architecture/adrs`.
