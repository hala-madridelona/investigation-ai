import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const incidentStatuses = ['pending', 'running', 'completed', 'failed'] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

export const incidents = pgTable('incidents', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id').notNull().unique(),
  title: text('title').notNull(),
  status: text('status', { enum: incidentStatuses }).notNull(),
  severity: text('severity').notNull(),
  serviceName: text('service_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});
