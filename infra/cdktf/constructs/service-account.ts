import { googleProjectIamMember, googleServiceAccount } from '@cdktf/provider-google';
import { Construct } from 'constructs';

export interface ServiceAccountConstructProps {
  readonly projectId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly projectRoles?: readonly string[];
}

export class ServiceAccountConstruct extends Construct {
  public readonly account: googleServiceAccount.GoogleServiceAccount;
  public readonly iamBindings: googleProjectIamMember.GoogleProjectIamMember[];

  public constructor(scope: Construct, id: string, props: ServiceAccountConstructProps) {
    super(scope, id);

    this.account = new googleServiceAccount.GoogleServiceAccount(this, 'serviceAccount', {
      accountId: props.accountId,
      displayName: props.displayName,
      project: props.projectId,
    });

    this.iamBindings = (props.projectRoles ?? []).map(
      (role, index) =>
        new googleProjectIamMember.GoogleProjectIamMember(this, `role-${index}`, {
          project: props.projectId,
          role,
          member: `serviceAccount:${this.account.email}`,
        }),
    );
  }
}
