import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { incidents } from './incidents.js';

export const investigationStatuses = ['running', 'complete', 'failed'] as const;
export type InvestigationStatus = (typeof investigationStatuses)[number];

export const investigationState = pgTable('investigation_state', {
  incidentId: uuid('incident_id')
    .primaryKey()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  status: text('status', { enum: investigationStatuses }).notNull(),
  iterationCount: integer('iteration_count').notNull().default(0),
  stagnationCount: integer('stagnation_count').notNull().default(0),
  entities: jsonb('entities')
    .$type<unknown[] | Record<string, unknown>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  lastSignals: jsonb('last_signals')
    .$type<unknown[] | Record<string, unknown>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
