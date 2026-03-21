import {
  googleAlloydbCluster,
  googleAlloydbInstance,
  googleProjectService,
  googleSqlDatabase,
  googleSqlDatabaseInstance,
  googleSqlUser,
} from '@cdktf/provider-google';
import type { ITerraformDependable } from 'cdktf';
import { Construct } from 'constructs';

export interface DatabaseConstructProps {
  readonly projectId: string;
  readonly region: string;
  readonly networkId: string;
  readonly privateServiceConnectionDependency: ITerraformDependable;
  readonly databaseEngine: 'alloydb' | 'cloudsql-postgres';
  readonly databaseName: string;
  readonly adminPasswordSecretId: string;
}

export class AlloyDbClusterConstruct extends Construct {
  public readonly connectionName: string;
  public readonly host: string;
  public readonly port = '5432';
  public readonly user = 'postgres';
  public readonly databaseName: string;

  public constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);
    this.databaseName = props.databaseName;

    const sqlAdminApi = new googleProjectService.GoogleProjectService(this, 'sqlAdminApi', {
      project: props.projectId,
      service: 'sqladmin.googleapis.com',
      disableOnDestroy: false,
    });

    const alloydbApi = new googleProjectService.GoogleProjectService(this, 'alloydbApi', {
      project: props.projectId,
      service: 'alloydb.googleapis.com',
      disableOnDestroy: false,
    });

    if (props.databaseEngine === 'alloydb') {
      const cluster = new googleAlloydbCluster.GoogleAlloydbCluster(this, 'cluster', {
        project: props.projectId,
        location: props.region,
        clusterId: `${props.databaseName}-cluster`,
        networkConfig: {
          network: props.networkId,
        },
        initialUser: {
          user: 'postgres',
          password: `projects/${props.projectId}/secrets/${props.adminPasswordSecretId}/versions/latest`,
        },
        dependsOn: [alloydbApi],
      });

      const primary = new googleAlloydbInstance.GoogleAlloydbInstance(this, 'primary', {
        project: props.projectId,
        cluster: cluster.name,
        instanceId: `${props.databaseName}-primary`,
        instanceType: 'PRIMARY',
        machineConfig: {
          cpuCount: 2,
        },
        dependsOn: [cluster],
      });

      this.connectionName = primary.name;
      this.host = primary.ipAddress;
      return;
    }

    const instance = new googleSqlDatabaseInstance.GoogleSqlDatabaseInstance(this, 'instance', {
      project: props.projectId,
      region: props.region,
      name: `${props.databaseName}-pg`,
      databaseVersion: 'POSTGRES_15',
      deletionProtection: true,
      settings: {
        tier: 'db-custom-2-7680',
        availabilityType: 'ZONAL',
        diskType: 'PD_SSD',
        backupConfiguration: {
          enabled: true,
          pointInTimeRecoveryEnabled: true,
        },
        ipConfiguration: {
          ipv4Enabled: false,
          privateNetwork: props.networkId,
          enablePrivatePathForGoogleCloudServices: true,
        },
      },
      dependsOn: [sqlAdminApi, props.privateServiceConnectionDependency],
    });

    new googleSqlDatabase.GoogleSqlDatabase(this, 'database', {
      project: props.projectId,
      name: props.databaseName,
      instance: instance.name,
    });

    new googleSqlUser.GoogleSqlUser(this, 'postgresUser', {
      project: props.projectId,
      instance: instance.name,
      name: 'postgres',
      password: `projects/${props.projectId}/secrets/${props.adminPasswordSecretId}/versions/latest`,
    });

    this.connectionName = instance.connectionName;
    this.host = instance.privateIpAddress;
  }
}
