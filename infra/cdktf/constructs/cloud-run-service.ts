import {
  googleCloudRunV2Service,
  googleCloudRunV2ServiceIamMember,
  googleProjectService,
} from '@cdktf/provider-google';
import { Construct } from 'constructs';

export interface CloudRunServiceConstructProps {
  readonly projectId: string;
  readonly region: string;
  readonly serviceName: string;
  readonly image: string;
  readonly serviceAccountEmail: string;
  readonly connectorId?: string;
  readonly environmentVariables?: Record<string, string>;
  readonly secretEnvironmentVariables?: ReadonlyArray<{
    readonly name: string;
    readonly secretId: string;
    readonly version?: string;
  }>;
  readonly ingress?: 'INGRESS_TRAFFIC_ALL' | 'INGRESS_TRAFFIC_INTERNAL_ONLY';
  readonly allowUnauthenticated?: boolean;
  readonly invokerMembers?: readonly string[];
}

export class CloudRunServiceConstruct extends Construct {
  public readonly service: googleCloudRunV2Service.GoogleCloudRunV2Service;

  public constructor(scope: Construct, id: string, props: CloudRunServiceConstructProps) {
    super(scope, id);

    const cloudRunApi = new googleProjectService.GoogleProjectService(this, 'cloudRunApi', {
      project: props.projectId,
      service: 'run.googleapis.com',
      disableOnDestroy: false,
    });

    this.service = new googleCloudRunV2Service.GoogleCloudRunV2Service(this, 'service', {
      project: props.projectId,
      location: props.region,
      name: props.serviceName,
      ingress: props.ingress ?? 'INGRESS_TRAFFIC_INTERNAL_ONLY',
      template: {
        serviceAccount: props.serviceAccountEmail,
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        vpcAccess: props.connectorId
          ? {
              connector: props.connectorId,
              egress: 'ALL_TRAFFIC',
            }
          : undefined,
        scaling: {
          minInstanceCount: 0,
          maxInstanceCount: 5,
        },
        containers: [
          {
            image: props.image,
            resources: {
              limits: {
                cpu: '1',
                memory: '512Mi',
              },
            },
            env: [
              ...Object.entries(props.environmentVariables ?? {}).map(([name, value]) => ({ name, value })),
              ...(props.secretEnvironmentVariables ?? []).map((secretRef) => ({
                name: secretRef.name,
                valueSource: {
                  secretKeyRef: {
                    secret: secretRef.secretId,
                    version: secretRef.version ?? 'latest',
                  },
                },
              })),
            ],
          },
        ],
      },
      dependsOn: [cloudRunApi],
    });

    if (props.allowUnauthenticated) {
      new googleCloudRunV2ServiceIamMember.GoogleCloudRunV2ServiceIamMember(this, 'invoker', {
        project: props.projectId,
        location: props.region,
        name: this.service.name,
        role: 'roles/run.invoker',
        member: 'allUsers',
      });
    }

    (props.invokerMembers ?? []).forEach((member, index) => {
      new googleCloudRunV2ServiceIamMember.GoogleCloudRunV2ServiceIamMember(this, `invoker-member-${index}`, {
        project: props.projectId,
        location: props.region,
        name: this.service.name,
        role: 'roles/run.invoker',
        member,
      });
    });
  }
}
