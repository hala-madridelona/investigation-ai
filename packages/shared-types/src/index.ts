export interface IncidentEvent {
  incidentId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface InvestigationEntity {
  id: string;
  kind: 'service' | 'host' | 'deployment' | 'user';
  displayName: string;
}

export interface InvestigationSignal {
  id: string;
  kind: 'metric' | 'log' | 'trace' | 'change';
  summary: string;
}

export interface InvestigationReport {
  incidentId: string;
  summary: string;
  entities: InvestigationEntity[];
  signals: InvestigationSignal[];
}
