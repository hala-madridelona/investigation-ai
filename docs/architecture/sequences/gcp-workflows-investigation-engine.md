# GCP Workflows ↔ Investigation Engine call sequence

This document defines the exact orchestration contract between Intake Service, GCP Workflows, and the Investigation Engine. The workflow engine owns loop control. The LLM may propose content, but it does **not** decide whether the workflow loops, retries, stops, or escalates to a human.

## 1. End-to-end sequence

1. Intake Service receives a PagerDuty webhook and persists the incident.
2. Intake Service returns a `workflowInput` object containing:
   - the persisted incident,
   - workflow execution metadata,
   - a workflow-scoped idempotency key,
   - default retry and timeout policies.
3. GCP Workflows starts with that `workflowInput` as its input payload.
4. GCP Workflows calls the Investigation Engine in this order:
   - `POST /init`
   - `POST /plan`
   - `POST /execute`
   - `POST /evaluate`
   - loop back to `POST /plan` when `control.status = continue`
   - `POST /finalize` when `control.status = stop`
5. GCP Workflows retries a phase only for transport or explicitly retryable failures.
6. GCP Workflows stops immediately when the engine returns `needs_human_review`.
7. GCP Workflows never infers orchestration state from free-form model text; it only inspects the typed `control` object.

## 2. Workflow input from Intake Service

```json
{
  "trigger": {
    "workflow": "investigation",
    "action": "start",
    "incidentId": "inc_123",
    "requestedAt": "2026-03-20T00:00:00.000Z",
    "dedupKey": "pd-incident-123"
  },
  "incident": {
    "id": "inc_123",
    "externalId": "P123",
    "title": "API latency spike",
    "status": "pending",
    "severity": "high",
    "serviceName": "checkout",
    "payload": {},
    "entities": []
  },
  "context": {
    "source": "intake-service",
    "receivedAt": "2026-03-20T00:00:00.000Z",
    "requestId": "req_123",
    "idempotencyKey": "workflow:investigation:inc_123:pd-incident-123",
    "retryPolicy": {
      "maxAttempts": 3,
      "initialDelaySeconds": 5,
      "maxDelaySeconds": 60,
      "multiplier": 2,
      "retryableErrors": ["transport", "upstream_dependency", "rate_limited", "concurrency_conflict", "internal"]
    },
    "timeoutPolicy": {
      "requestTimeoutSeconds": 30,
      "overallTimeoutSeconds": 900
    }
  }
}
```

## 3. Phase contract

Every phase request includes `context` with workflow execution metadata and a phase-specific idempotency key. Every phase response includes a `control` object with machine-readable loop semantics.

### `/init`
- Purpose: create or restore deterministic investigation state.
- Success status: `continue`
- Next phase: `/plan`
- Idempotency: same key must return the same initialized state, not duplicate work.

### `/plan`
- Purpose: produce a deterministic plan for the next execution window.
- Success status:
  - `continue` when there are steps to execute,
  - `stop` when planning determines there is nothing left to do,
  - `needs_human_review` when required context is unavailable.
- Next phase:
  - `/execute` for `continue`
  - `/finalize` for `stop`
  - `null` for `needs_human_review`

### `/execute`
- Purpose: run the selected plan steps.
- Success status:
  - `continue` when execution produced enough results to evaluate,
  - `retry` when execution encountered a transient dependency failure,
  - `needs_human_review` when too many required steps fail.
- Next phase:
  - `/evaluate` for `continue`
  - `/execute` for `retry`
  - `null` for `needs_human_review`

### `/evaluate`
- Purpose: decide whether the workflow should loop, stop, retry, or escalate.
- Success status:
  - `continue` to plan another iteration,
  - `stop` to finalize,
  - `retry` to repeat evaluation if dependencies were transient,
  - `needs_human_review` when evidence is conflicting or blocked.
- Next phase:
  - `/plan` for `continue`
  - `/finalize` for `stop`
  - `/evaluate` for `retry`
  - `null` for `needs_human_review`

### `/finalize`
- Purpose: emit the final report and terminal workflow status.
- Success status: `stop`
- Terminal states:
  - `completed` for a successfully finalized report,
  - `needs_human_review` when finalization cannot safely conclude,
  - `failed` when a non-retryable system error prevents report generation.

## 4. Retry semantics

- Workflows may retry when:
  - the HTTP call times out,
  - the service returns 429 or 5xx,
  - the response `control.status` is `retry`, or
  - a failure payload marks `retryable = true`.
- Default phase retry policy:
  - max attempts: 3,
  - initial backoff: 5 seconds,
  - maximum backoff: 60 seconds,
  - multiplier: 2.
- Non-retryable cases:
  - invalid request payloads,
  - invariant violations,
  - unsupported incident state,
  - `needs_human_review`.

## 5. Timeout semantics

- Each engine call has a request timeout of 30 seconds.
- The workflow has an overall timeout of 900 seconds.
- The engine echoes timeout policy in every response so Workflows can keep behavior aligned with service expectations.
- If the workflow deadline is too close for another phase attempt, Workflows should terminate with `needs_human_review` rather than starting a phase that cannot finish.

## 6. Idempotency keys

- Workflow-scoped key: `workflow:investigation:{incidentId}:{dedupKey|requestedAt}`
- Phase-scoped key: `workflow:investigation:{incidentId}:{phase}:{attempt}`
- Engine behavior:
  - identical idempotency key + same payload => replay-safe response,
  - identical idempotency key + different payload => reject as concurrency conflict,
  - replayed responses must set `control.idempotency.replayed = true`.

## 7. Terminal states

- `completed`: final report emitted successfully.
- `failed`: unrecoverable platform or validation error.
- `needs_human_review`: workflow cannot safely continue without operator input.
- `cancelled`: workflow intentionally stopped by an external operator or higher-level control plane.

## 8. Partial failure handling

- Partial execution failure must not be represented as a generic success.
- `/execute` and `/evaluate` return `control.partialFailure` when some but not all dependencies fail.
- Allowed handling values:
  - `degraded_continue`: enough evidence exists to continue safely,
  - `retry_phase`: retry only the current phase,
  - `needs_human_review`: missing evidence blocks safe automation.
- Workflows use `control.partialFailure.handling` together with `control.status` to choose the next step.
