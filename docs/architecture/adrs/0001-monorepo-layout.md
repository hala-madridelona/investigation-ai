# ADR 0001: Workspace-based monorepo layout

## Status

Accepted

## Context

The platform needs multiple deployable services, reusable TypeScript libraries, infrastructure code, and long-lived architecture documentation. Shared contracts and schemas should not be duplicated between services.

## Decision

Adopt a pnpm workspace monorepo rooted at the repository root, with deployable services in `apps/`, shared libraries in `packages/`, infrastructure code in `infra/`, and design artifacts in `docs/architecture`.

## Consequences

- Shared contracts become versioned workspace packages instead of copy-pasted source files.
- Root commands can coordinate linting, type-checking, and builds consistently.
- Infrastructure and documentation stay close to application code while remaining clearly separated by concern.
