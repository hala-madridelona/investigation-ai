# Observability and Persistence Conventions

This document defines the shared observability primitives used across intake, investigation-engine, and future tool adapters.

## Required primitives

Every service, workflow phase, persisted record, and tool execution must carry:

- `incidentId` whenever the operation is scoped to an incident.
- `investigationStepId` whenever the operation is scoped to a plan or execution step.
- `correlationIds` as an append-only list propagated from ingress through workflow phases and tool adapters.
- `recordMetadata` with:
  - `observedAt`
  - `recordedAt`
  - `actor`
  - `source`
  - `correlationIds`
  - optional `incidentId`
  - optional `investigationStepId`
- evidence references with stable IDs for:
  - GCS objects (`gcs_object`)
  - external links (`external_link` / `external_url`)
  - logs, queries, and report artifacts

## Raw output vs summarized findings

Tool integrations must separate raw and derived data:

- `rawOutput`: provider-native payload, possibly truncated, suitable for GCS or debugging retention.
- `findings`: compact, human-usable summaries derived from `rawOutput`.
- `summary`: convenience string only; it must not be treated as a substitute for raw output retention.

In persisted records, mark whether a payload is `summary_only`, `summarized_finding`, or a raw artifact manifest so downstream consumers do not confuse provider output with investigator conclusions.

## Persistence rules

### Postgres

Persist only structured state required for orchestration, retrieval, and reporting:

- incidents and workflow state
- plan and execution step summaries
- finding summaries and structured signals
- evidence reference IDs and metadata manifests
- timestamps, actor/source metadata, and correlation IDs on every row

Do **not** persist large provider-native tool payloads directly in Postgres unless they are already reduced to durable metadata.

### GCS

Persist durable large objects and evidence blobs:

- full raw tool responses
- exported logs or query results
- evidence manifests and attachments
- serialized report payloads used for downstream delivery

Each GCS object must have a durable evidence or artifact ID that is also referenced from Postgres.

### Report artifacts

Store report-ready deliverables separately from raw evidence:

- final report JSON / markdown / rendered documents
- curated charts and screenshots included in a handoff
- evidence manifests specifically attached to the final report

Report artifacts are durable outputs meant for operators and downstream systems.

### Debug-only retention

Keep transient debugging data out of core business records:

- adapter diagnostics
- redaction-safe request/response snippets
- temporary traces used while developing integrations

These items may live in logs or ephemeral storage, but they should not be required to reconstruct the investigation state.

## Shared utility expectations

Shared utilities must be the default path for all new code:

- `@investigation-ai/service-runtime`
  - request observability context creation
  - structured logger creation with `incidentId`, `investigationStepId`, and `correlationIds`
  - record metadata factories
  - default persistence catalog
- `@investigation-ai/shared-types`
  - canonical metadata, evidence, persistence, and tool output schemas
- `@investigation-ai/tools`
  - tool execution context with propagated correlation IDs
  - tool execution envelopes separating raw output from findings
  - evidence reference types for GCS objects and external URLs

Future services and adapters should extend these shared utilities instead of inventing local observability types.
