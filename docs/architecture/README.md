# Architecture docs

Use this directory for system diagrams, sequence flows, and architecture decision records.

- `diagrams/` — high-level system and deployment diagrams
- `sequences/` — request/response and orchestration sequence flows
- `adrs/` — architecture decision records

## ADR index

- `adrs/0001-monorepo-layout.md` — adopts the workspace-based monorepo layout.
- `adrs/0002-cloud-run-compute-boundary.md` — establishes Cloud Run as the default compute boundary and keeps Cloud Functions out of scope unless a future ADR assigns them a dedicated responsibility.


## Defined workflow orchestration

- `sequences/gcp-workflows-investigation-engine.md` — exact call sequence, payloads, retry and timeout semantics, idempotency, terminal states, and partial failure handling for GCP Workflows ↔ Investigation Engine orchestration.
