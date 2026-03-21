CREATE TABLE "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_id" text NOT NULL,
  "title" text NOT NULL,
  "status" text NOT NULL,
  "severity" text NOT NULL,
  "service_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "incidents_external_id_unique" UNIQUE("external_id")
);

CREATE TABLE "investigation_state" (
  "incident_id" uuid PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "iteration_count" integer DEFAULT 0 NOT NULL,
  "stagnation_count" integer DEFAULT 0 NOT NULL,
  "entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "investigation_state_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade
);

CREATE TABLE "steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL,
  "step_index" integer NOT NULL,
  "type" text NOT NULL,
  "tool_name" text,
  "status" text NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "summary" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "steps_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade
);

CREATE TABLE "step_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "step_id" uuid NOT NULL,
  "artifact_type" text NOT NULL,
  "gcs_path" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "step_artifacts_step_id_steps_id_fk"
    FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE cascade
);

CREATE TABLE "findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "confidence" double precision NOT NULL,
  "evidence" jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "findings_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade
);

CREATE TABLE "feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL,
  "step_id" uuid,
  "rating" integer NOT NULL,
  "issue_type" text NOT NULL,
  "comment" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade,
  CONSTRAINT "feedback_step_id_steps_id_fk"
    FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE set null
);

CREATE TABLE "tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "step_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "latency_ms" integer NOT NULL,
  "status" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "tool_calls_step_id_steps_id_fk"
    FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE cascade
);
