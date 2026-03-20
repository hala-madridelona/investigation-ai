import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { incidents } from './incidents.js';

export const stepTypes = ['tool_call', 'reasoning', 'decision'] as const;
export type StepType = (typeof stepTypes)[number];

export const stepStatuses = ['success', 'failed'] as const;
export type StepStatus = (typeof stepStatuses)[number];

export const steps = pgTable('steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  type: text('type', { enum: stepTypes }).notNull(),
  toolName: text('tool_name'),
  status: text('status', { enum: stepStatuses }).notNull(),
  input: jsonb('input').$type<Record<string, unknown> | unknown[] | null>(),
  output: jsonb('output').$type<Record<string, unknown> | unknown[] | null>(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
