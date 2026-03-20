import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { incidents } from './incidents.js';
import { steps } from './steps.js';

export const feedbackIssueTypes = ['wrong_tool', 'bad_reasoning', 'missed_signal'] as const;
export type FeedbackIssueType = (typeof feedbackIssueTypes)[number];

export const feedback = pgTable('feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').references(() => steps.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(),
  issueType: text('issue_type', { enum: feedbackIssueTypes }).notNull(),
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
