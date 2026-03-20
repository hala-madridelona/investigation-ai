import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { steps } from './steps.js';
import { stepStatuses } from './steps.js';

export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  stepId: uuid('step_id')
    .notNull()
    .references(() => steps.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  status: text('status', { enum: stepStatuses }).notNull(),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});
