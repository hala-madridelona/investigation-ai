# Architecture docs

Use this directory for system diagrams, sequence flows, and architecture decision records.

- `diagrams/` — high-level system and deployment diagrams
- `sequences/` — request/response and orchestration sequence flows
- `adrs/` — architecture decision records


## Defined workflow orchestration

- `sequences/gcp-workflows-investigation-engine.md` — exact call sequence, payloads, retry and timeout semantics, idempotency, terminal states, and partial failure handling for GCP Workflows ↔ Investigation Engine orchestration.
