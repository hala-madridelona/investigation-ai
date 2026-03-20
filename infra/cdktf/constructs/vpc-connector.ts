import {
  googleComputeGlobalAddress,
  googleComputeNetwork,
  googleComputeSubnetwork,
  googleProjectService,
  googleServiceNetworkingConnection,
  googleVpcAccessConnector,
} from '@cdktf/provider-google';
import { TerraformMetaArguments } from 'cdktf';
import { Construct } from 'constructs';

export interface VpcConnectorConstructProps extends TerraformMetaArguments {
  readonly projectId: string;
  readonly region: string;
  readonly networkName: string;
  readonly subnetName: string;
  readonly subnetCidr: string;
  readonly connectorName: string;
  readonly connectorCidr: string;
}

export class VpcConnectorConstruct extends Construct {
  public readonly network: googleComputeNetwork.GoogleComputeNetwork;
  public readonly subnetwork: googleComputeSubnetwork.GoogleComputeSubnetwork;
  public readonly connector: googleVpcAccessConnector.GoogleVpcAccessConnector;
  public readonly privateServiceRange: googleComputeGlobalAddress.GoogleComputeGlobalAddress;
  public readonly serviceNetworkingConnection: googleServiceNetworkingConnection.GoogleServiceNetworkingConnection;

  public constructor(scope: Construct, id: string, props: VpcConnectorConstructProps) {
    super(scope, id);

    const computeApi = new googleProjectService.GoogleProjectService(this, 'computeApi', {
      project: props.projectId,
      service: 'compute.googleapis.com',
      disableOnDestroy: false,
    });

    const vpcApi = new googleProjectService.GoogleProjectService(this, 'vpcAccessApi', {
      project: props.projectId,
      service: 'vpcaccess.googleapis.com',
      disableOnDestroy: false,
    });

    const serviceNetworkingApi = new googleProjectService.GoogleProjectService(this, 'serviceNetworkingApi', {
      project: props.projectId,
      service: 'servicenetworking.googleapis.com',
      disableOnDestroy: false,
    });

    this.network = new googleComputeNetwork.GoogleComputeNetwork(this, 'network', {
      project: props.projectId,
      name: props.networkName,
      autoCreateSubnetworks: false,
      routingMode: 'REGIONAL',
      dependsOn: [computeApi],
    });

    this.subnetwork = new googleComputeSubnetwork.GoogleComputeSubnetwork(this, 'subnet', {
      project: props.projectId,
      region: props.region,
      name: props.subnetName,
      network: this.network.id,
      ipCidrRange: props.subnetCidr,
      privateIpGoogleAccess: true,
    });

    this.privateServiceRange = new googleComputeGlobalAddress.GoogleComputeGlobalAddress(
      this,
      'privateServiceRange',
      {
        project: props.projectId,
        name: `${props.networkName}-psa-range`,
        purpose: 'VPC_PEERING',
        addressType: 'INTERNAL',
        prefixLength: 16,
        network: this.network.id,
        dependsOn: [serviceNetworkingApi],
      },
    );

    this.serviceNetworkingConnection = new googleServiceNetworkingConnection.GoogleServiceNetworkingConnection(
      this,
      'serviceNetworkingConnection',
      {
        network: this.network.id,
        service: 'servicenetworking.googleapis.com',
        reservedPeeringRanges: [this.privateServiceRange.name],
      },
    );

    this.connector = new googleVpcAccessConnector.GoogleVpcAccessConnector(this, 'connector', {
      project: props.projectId,
      region: props.region,
      name: props.connectorName,
      subnet: {
        name: this.subnetwork.name,
        projectId: props.projectId,
      },
      ipCidrRange: props.connectorCidr,
      minInstances: 2,
      maxInstances: 3,
      machineType: 'e2-micro',
      dependsOn: [vpcApi],
    });
  }
}
