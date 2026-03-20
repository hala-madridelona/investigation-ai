export type DeploymentEnvironment = 'dev' | 'staging' | 'prod';
export type DatabaseEngine = 'alloydb' | 'cloudsql-postgres';

export interface EnvironmentConfig {
  readonly environment: DeploymentEnvironment;
  readonly projectId: string;
  readonly region: string;
  readonly networkProjectId?: string;
  readonly billingProjectId?: string;
  readonly workflowSourcePath: string;
  readonly databaseEngine: DatabaseEngine;
  readonly enablePubSub: boolean;
  readonly cloudRunImages: {
    readonly intakeService: string;
    readonly investigationEngine: string;
  };
  readonly bucketNames: {
    readonly toolOutputs: string;
    readonly reports: string;
    readonly knowledgeBase: string;
  };
}

const ENVIRONMENT_PREFIX: Record<DeploymentEnvironment, string> = {
  dev: 'DEV',
  staging: 'STAGING',
  prod: 'PROD',
};

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function resolveBucketName(projectId: string, environment: DeploymentEnvironment, suffix: string): string {
  return `${projectId}-${environment}-${suffix}`.toLowerCase();
}

export function resolveEnvironmentConfig(environment: DeploymentEnvironment): EnvironmentConfig {
  const prefix = ENVIRONMENT_PREFIX[environment];
  const projectId = readRequiredEnv(`${prefix}_GCP_PROJECT_ID`);
  const region = readRequiredEnv(`${prefix}_GCP_REGION`);
  const workflowSourcePath =
    readOptionalEnv(`${prefix}_WORKFLOW_SOURCE_PATH`) ?? '../workflows/investigation-workflow.template.yaml';
  const databaseEngine =
    (readOptionalEnv(`${prefix}_DATABASE_ENGINE`) as DatabaseEngine | undefined) ?? 'cloudsql-postgres';

  return {
    environment,
    projectId,
    region,
    networkProjectId: readOptionalEnv(`${prefix}_NETWORK_PROJECT_ID`),
    billingProjectId: readOptionalEnv(`${prefix}_BILLING_PROJECT_ID`),
    workflowSourcePath,
    databaseEngine,
    enablePubSub: readBooleanEnv(`${prefix}_ENABLE_PUBSUB`, environment !== 'prod'),
    cloudRunImages: {
      intakeService:
        readOptionalEnv(`${prefix}_INTAKE_SERVICE_IMAGE`) ?? `gcr.io/${projectId}/intake-service:latest`,
      investigationEngine:
        readOptionalEnv(`${prefix}_INVESTIGATION_ENGINE_IMAGE`) ??
        `gcr.io/${projectId}/investigation-engine:latest`,
    },
    bucketNames: {
      toolOutputs:
        readOptionalEnv(`${prefix}_TOOL_OUTPUTS_BUCKET`) ??
        resolveBucketName(projectId, environment, 'tool-outputs'),
      reports:
        readOptionalEnv(`${prefix}_REPORTS_BUCKET`) ?? resolveBucketName(projectId, environment, 'reports'),
      knowledgeBase:
        readOptionalEnv(`${prefix}_KNOWLEDGE_BASE_BUCKET`) ??
        resolveBucketName(projectId, environment, 'knowledge-base'),
    },
  };
}

export function resolveTargetEnvironment(): DeploymentEnvironment {
  const requested = process.env.DEPLOY_ENV ?? process.env.ENVIRONMENT ?? 'dev';

  if (requested !== 'dev' && requested !== 'staging' && requested !== 'prod') {
    throw new Error(`Unsupported environment \"${requested}\". Expected dev, staging, or prod.`);
  }

  return requested;
}
