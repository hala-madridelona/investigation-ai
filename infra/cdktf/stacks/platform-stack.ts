import {
  googleProjectService,
  googlePubsubTopic,
  googleSecretManagerSecret,
  googleSecretManagerSecretIamMember,
} from '@cdktf/provider-google';
import { TerraformOutput, TerraformStack } from 'cdktf';
import type { Construct } from 'constructs';
import { AlloyDbClusterConstruct } from '../constructs/alloydb-cluster.js';
import { CloudRunServiceConstruct } from '../constructs/cloud-run-service.js';
import { ServiceAccountConstruct } from '../constructs/service-account.js';
import { StorageBucketConstruct } from '../constructs/storage-bucket.js';
import { VpcConnectorConstruct } from '../constructs/vpc-connector.js';
import { WorkflowConstruct } from '../constructs/workflow.js';
import type { EnvironmentConfig } from '../config/environments.js';

export class PlatformStack extends TerraformStack {
  public constructor(scope: Construct, id: string, config: EnvironmentConfig) {
    super(scope, id);

    new googleProjectService.GoogleProjectService(this, 'secretManagerApi', {
      project: config.projectId,
      service: 'secretmanager.googleapis.com',
      disableOnDestroy: false,
    });

    const vpc = new VpcConnectorConstruct(this, 'platformNetwork', {
      projectId: config.projectId,
      region: config.region,
      networkName: `${config.environment}-platform-vpc`,
      subnetName: `${config.environment}-platform-subnet`,
      subnetCidr: '10.10.0.0/24',
      connectorName: `${config.environment}-serverless-connector`,
      connectorCidr: '10.8.0.0/28',
    });

    const workflowServiceAccount = new ServiceAccountConstruct(this, 'workflowSa', {
      projectId: config.projectId,
      accountId: `${config.environment}-workflow`,
      displayName: `${config.environment} workflow runtime`,
      projectRoles: ['roles/logging.logWriter'],
    });

    const intakeServiceAccount = new ServiceAccountConstruct(this, 'intakeSa', {
      projectId: config.projectId,
      accountId: `${config.environment}-intake`,
      displayName: `${config.environment} intake service`,
      projectRoles: [
        'roles/run.invoker',
        'roles/storage.objectAdmin',
        'roles/secretmanager.secretAccessor',
        'roles/workflows.invoker',
      ],
    });

    const engineServiceAccount = new ServiceAccountConstruct(this, 'engineSa', {
      projectId: config.projectId,
      accountId: `${config.environment}-engine`,
      displayName: `${config.environment} investigation engine`,
      projectRoles: [
        'roles/storage.objectAdmin',
        'roles/secretmanager.secretAccessor',
        'roles/cloudsql.client',
        'roles/workflows.invoker',
      ],
    });

    const toolOutputsBucket = new StorageBucketConstruct(this, 'toolOutputsBucket', {
      projectId: config.projectId,
      region: config.region,
      bucketName: config.bucketNames.toolOutputs,
      labels: { environment: config.environment, data_classification: 'restricted' },
    });

    const reportsBucket = new StorageBucketConstruct(this, 'reportsBucket', {
      projectId: config.projectId,
      region: config.region,
      bucketName: config.bucketNames.reports,
      labels: { environment: config.environment, data_classification: 'confidential' },
    });

    const knowledgeBaseBucket = new StorageBucketConstruct(this, 'knowledgeBaseBucket', {
      projectId: config.projectId,
      region: config.region,
      bucketName: config.bucketNames.knowledgeBase,
      labels: { environment: config.environment, data_classification: 'internal' },
    });

    const databasePasswordSecret = new googleSecretManagerSecret.GoogleSecretManagerSecret(
      this,
      'databasePasswordSecret',
      {
        project: config.projectId,
        secretId: `${config.environment}-database-admin-password`,
        replication: {
          auto: {},
        },
      },
    );

    const apiKeySecret = new googleSecretManagerSecret.GoogleSecretManagerSecret(this, 'apiKeySecret', {
      project: config.projectId,
      secretId: `${config.environment}-tooling-api-key`,
      replication: {
        auto: {},
      },
    });

    [intakeServiceAccount.account.email, engineServiceAccount.account.email].forEach((email, index) => {
      new googleSecretManagerSecretIamMember.GoogleSecretManagerSecretIamMember(this, `dbSecretAccess-${index}`, {
        project: config.projectId,
        secretId: databasePasswordSecret.secretId,
        role: 'roles/secretmanager.secretAccessor',
        member: `serviceAccount:${email}`,
      });

      new googleSecretManagerSecretIamMember.GoogleSecretManagerSecretIamMember(this, `apiSecretAccess-${index}`, {
        project: config.projectId,
        secretId: apiKeySecret.secretId,
        role: 'roles/secretmanager.secretAccessor',
        member: `serviceAccount:${email}`,
      });
    });

    const database = new AlloyDbClusterConstruct(this, 'database', {
      projectId: config.projectId,
      region: config.region,
      networkId: vpc.network.id,
      privateServiceConnectionDependency: vpc.serviceNetworkingConnection,
      databaseEngine: config.databaseEngine,
      databaseName: `${config.environment}-investigation`,
      adminPasswordSecretId: databasePasswordSecret.secretId,
    });

    const intakeTopic = config.enablePubSub
      ? new googlePubsubTopic.GooglePubsubTopic(this, 'intakeTopic', {
          project: config.projectId,
          name: `${config.environment}-intake-events`,
        })
      : undefined;

    const executionTopic = config.enablePubSub
      ? new googlePubsubTopic.GooglePubsubTopic(this, 'executionTopic', {
          project: config.projectId,
          name: `${config.environment}-execution-events`,
        })
      : undefined;

    const intakeService = new CloudRunServiceConstruct(this, 'intakeService', {
      projectId: config.projectId,
      region: config.region,
      serviceName: `${config.environment}-intake-service`,
      image: config.cloudRunImages.intakeService,
      serviceAccountEmail: intakeServiceAccount.account.email,
      connectorId: vpc.connector.id,
      ingress: 'INGRESS_TRAFFIC_ALL',
      allowUnauthenticated: true,
      environmentVariables: {
        ENVIRONMENT: config.environment,
        DATABASE_CONNECTION_MODE: 'host',
        DATABASE_HOST: database.host,
        DATABASE_PORT: database.port,
        DATABASE_NAME: database.databaseName,
        DATABASE_USER: database.user,
        DATABASE_SSL_MODE: 'disable',
        REPORTS_BUCKET: reportsBucket.bucket.name,
        TOOL_OUTPUTS_BUCKET: toolOutputsBucket.bucket.name,
        KNOWLEDGE_BASE_BUCKET: knowledgeBaseBucket.bucket.name,
        WORKFLOW_NAME: `${config.environment}-investigation-workflow`,
        ...(intakeTopic ? { PUBSUB_TOPIC: intakeTopic.name } : {}),
      },
      secretEnvironmentVariables: [
        { name: 'DATABASE_PASSWORD', secretId: databasePasswordSecret.secretId },
        { name: 'TOOLING_API_KEY', secretId: apiKeySecret.secretId },
      ],
    });

    const investigationEngine = new CloudRunServiceConstruct(this, 'investigationEngine', {
      projectId: config.projectId,
      region: config.region,
      serviceName: `${config.environment}-investigation-engine`,
      image: config.cloudRunImages.investigationEngine,
      serviceAccountEmail: engineServiceAccount.account.email,
      connectorId: vpc.connector.id,
      ingress: 'INGRESS_TRAFFIC_ALL',
      invokerMembers: [`serviceAccount:${workflowServiceAccount.account.email}`],
      environmentVariables: {
        ENVIRONMENT: config.environment,
        DATABASE_CONNECTION_MODE: 'host',
        DATABASE_HOST: database.host,
        DATABASE_PORT: database.port,
        DATABASE_NAME: database.databaseName,
        DATABASE_USER: database.user,
        DATABASE_SSL_MODE: 'disable',
        TOOL_OUTPUTS_BUCKET: toolOutputsBucket.bucket.name,
        REPORTS_BUCKET: reportsBucket.bucket.name,
        ...(executionTopic ? { EXECUTION_TOPIC: executionTopic.name } : {}),
      },
      secretEnvironmentVariables: [
        { name: 'DATABASE_PASSWORD', secretId: databasePasswordSecret.secretId },
        { name: 'TOOLING_API_KEY', secretId: apiKeySecret.secretId },
      ],
    });

    const workflow = new WorkflowConstruct(this, 'investigationWorkflow', {
      projectId: config.projectId,
      region: config.region,
      workflowName: `${config.environment}-investigation-workflow`,
      serviceAccountEmail: workflowServiceAccount.account.email,
      sourcePath: config.workflowSourcePath,
      substitutions: {
        investigation_engine_url: investigationEngine.service.uri,
      },
    });

    new TerraformOutput(this, 'workflowName', {
      value: workflow.workflow.name,
    });

    new TerraformOutput(this, 'intakeServiceUrl', {
      value: intakeService.service.uri,
    });

    new TerraformOutput(this, 'investigationEngineUrl', {
      value: investigationEngine.service.uri,
    });
  }
}
