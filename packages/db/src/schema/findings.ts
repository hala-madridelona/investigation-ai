import { sql } from 'drizzle-orm';
import { doublePrecision, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { incidents } from './incidents.js';

export const findings = pgTable('findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  confidence: doublePrecision('confidence').notNull(),
  evidence: jsonb('evidence').$type<Record<string, unknown> | unknown[]>().notNull(),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
