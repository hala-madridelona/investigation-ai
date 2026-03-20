import { googleStorageBucket } from '@cdktf/provider-google';
import { Construct } from 'constructs';

export interface StorageBucketConstructProps {
  readonly projectId: string;
  readonly region: string;
  readonly bucketName: string;
  readonly labels?: Record<string, string>;
  readonly versioning?: boolean;
}

export class StorageBucketConstruct extends Construct {
  public readonly bucket: googleStorageBucket.GoogleStorageBucket;

  public constructor(scope: Construct, id: string, props: StorageBucketConstructProps) {
    super(scope, id);

    this.bucket = new googleStorageBucket.GoogleStorageBucket(this, 'bucket', {
      project: props.projectId,
      name: props.bucketName,
      location: props.region,
      forceDestroy: false,
      uniformBucketLevelAccess: true,
      publicAccessPrevention: 'enforced',
      versioning: { enabled: props.versioning ?? true },
      labels: props.labels,
    });
  }
}
