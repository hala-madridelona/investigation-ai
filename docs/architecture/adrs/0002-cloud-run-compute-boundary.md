# ADR 0002: Cloud Run is the default compute boundary; Cloud Functions are out of scope unless a dedicated fan-out owner emerges

## Status

Accepted

## Context

The repository already models the two primary runtime entry points as Cloud Run services:

- `apps/intake-service` is the PagerDuty webhook ingestion surface and persists incidents before returning a `202` response.
- `apps/investigation-engine` is the orchestration API used by GCP Workflows for the investigation lifecycle.
- `infra/cdktf/stacks/platform-stack.ts` provisions both runtimes with the shared serverless network path, service-account model, Secret Manager integration, and environment variable conventions.

At the same time, the platform configuration includes optional Pub/Sub topics (`enablePubSub`) that could later be used for asynchronous side effects or event distribution. That leaves an architecture gap: without a written decision, the repository could drift into mixing Cloud Run and Cloud Functions for similar responsibilities.

The immediate questions are:

1. Should PagerDuty intake stay on Cloud Run or move to Cloud Functions?
2. Are there any lightweight event fan-out tasks that justify Cloud Functions?
3. If both compute models remain possible, who owns the boundary in infrastructure code?

## Decision

Adopt a **Cloud Run first** compute model for this repository.

### 1. PagerDuty intake stays on Cloud Run

Use Cloud Run for PagerDuty intake and treat it as a required runtime for any externally reachable webhook or API endpoint.

Rationale:

- The intake path already behaves like a service, not a single-purpose function: it validates payloads, performs idempotent persistence, emits workflow metadata, and returns a typed response contract.
- Operationally, intake and investigation-engine benefit from the same deployment shape, logging model, VPC connector usage, secret injection, and service-account handling.
- Keeping inbound HTTP runtimes on Cloud Run avoids duplicating deployment pipelines and IAM patterns for a second serverless product.
- Cold-start behavior is easier to reason about when the same platform serves both long-lived APIs; if latency becomes critical, Cloud Run can be tuned with `minInstanceCount` rather than introducing a second compute model.

### 2. Lightweight fan-out does not justify Cloud Functions today

The current repository does **not** require Cloud Functions for lightweight event fan-out.

If Pub/Sub-backed fan-out is enabled, prefer these patterns in order:

1. **GCP Workflows** when the work is orchestration-oriented, stateful, or retry-sensitive.
2. **Existing Cloud Run services** when the fan-out is just another endpoint or background handler owned by an existing service boundary.
3. **A dedicated Cloud Run worker/service** if asynchronous processing grows into its own deployable responsibility.

Examples that still fit the Cloud Run model:

- publishing intake or execution events for observability,
- dispatching non-critical notifications,
- triggering enrichment steps that share repository libraries, secrets, and network posture,
- consuming Pub/Sub events with a small worker that is still part of the platform's typed service surface.

Cloud Functions should only be reconsidered if a future workload is all of the following:

- truly narrow in scope,
- event-triggered only,
- independent from the existing service lifecycle,
- cheaper to own as an isolated function than as a Cloud Run service,
- and assigned to a clear infrastructure and application owner.

### 3. Cloud Functions are out of scope unless ownership is made explicit

Cloud Functions are **not part of the default platform baseline**.

Because no current workload requires them, this repository should not add ad hoc functions alongside Cloud Run services. If a future ADR keeps Cloud Functions in scope for a specific responsibility, that change must include:

- a dedicated CDKTF construct for Cloud Functions,
- explicit documentation of which workloads belong on that construct,
- naming and IAM conventions that distinguish function-owned event handlers from Cloud Run services,
- and an update to this ADR or a superseding ADR.

Until then, the absence of a Cloud Functions construct is intentional and signals that Cloud Run is the only supported application runtime in this repository.

## Consequences

### Operational consistency

Using Cloud Run for the supported runtimes keeps:

- one deployment model,
- one revision and rollback model,
- one service-account attachment pattern,
- one secret and VPC integration approach,
- and one place to tune concurrency and cold-start tradeoffs.

This is a better fit for the current codebase than splitting responsibilities across two serverless products.

### IAM model

Cloud Run keeps inbound and internal service identity centered on service accounts already provisioned in `platform-stack.ts`. That reduces ambiguity around who invokes what and avoids introducing a second set of event-trigger execution identities before there is a concrete need.

### Cold starts

For PagerDuty intake, cold starts are a platform-tuning concern rather than a product-selection concern. Cloud Run already supports the needed HTTP runtime and can be tuned with scaling settings when latency warrants it. The repository should prefer those adjustments over moving ingestion to Cloud Functions.

### Deployment complexity

Staying Cloud Run first avoids parallel CI/CD paths, duplicate artifact conventions, and duplicate infrastructure abstractions. The repository remains easier to reason about because application compute maps to one primary construct: `CloudRunServiceConstruct`.

### Lightweight event fan-out

Pub/Sub may still be used, but Pub/Sub usage alone does not imply Cloud Functions. Fan-out remains allowed when it is owned by Workflows or Cloud Run-based workers/services.

## Alternatives considered

### PagerDuty intake on Cloud Functions

Rejected for now.

Why it was not chosen:

- it creates a second compute model for the same repository surface,
- it weakens operational symmetry with `investigation-engine`,
- it complicates IAM and deployment ownership,
- and it solves no present gap that Cloud Run cannot already address.

### Mixed model: Cloud Run for APIs, Cloud Functions for every small event task

Rejected for now.

Why it was not chosen:

- "small event task" is too vague a boundary and invites architectural drift,
- future contributors would have no clear ownership rule,
- and the current platform does not yet have a function-specific workload that justifies the extra abstraction.

## Follow-up guidance

- Keep PagerDuty intake and investigation lifecycle APIs on Cloud Run.
- Treat optional Pub/Sub topics as transport only, not as an implicit requirement for Cloud Functions.
- If a future event handler cannot be cleanly owned by Workflows or Cloud Run, create a new ADR first; if that ADR approves Cloud Functions, add a dedicated CDKTF construct in the same change.
