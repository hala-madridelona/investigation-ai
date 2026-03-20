import type { IncidentEvent } from '@investigation-ai/shared-types';

export interface InvestigationRecord {
  id: string;
  incident: IncidentEvent;
  createdAt: string;
}

export const schemaModules = ['incidents', 'investigations', 'signals'] as const;

export const createDatabaseClient = () => ({
  dialect: 'postgresql' as const,
  migrationsDirectory: 'packages/db/migrations',
});
