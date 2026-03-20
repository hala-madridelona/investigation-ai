import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { steps } from './steps.js';

export const artifactTypes = ['logs', 'report', 'raw_output'] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export const stepArtifacts = pgTable('step_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  stepId: uuid('step_id')
    .notNull()
    .references(() => steps.id, { onDelete: 'cascade' }),
  artifactType: text('artifact_type', { enum: artifactTypes }).notNull(),
  gcsPath: text('gcs_path').notNull(),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
