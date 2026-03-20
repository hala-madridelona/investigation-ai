export interface InfrastructureStackDefinition {
  projectId: string;
  region: string;
  services: readonly ['intake-service', 'investigation-engine'];
}

export const baseInfrastructure: InfrastructureStackDefinition = {
  projectId: 'replace-me',
  region: 'us-central1',
  services: ['intake-service', 'investigation-engine'],
};
