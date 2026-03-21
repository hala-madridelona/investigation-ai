import { googleProjectService, googleWorkflowsWorkflow } from '@cdktf/provider-google';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Construct } from 'constructs';

export interface WorkflowConstructProps {
  readonly projectId: string;
  readonly region: string;
  readonly workflowName: string;
  readonly serviceAccountEmail: string;
  readonly sourcePath: string;
  readonly substitutions?: Record<string, string>;
}

export class WorkflowConstruct extends Construct {
  public readonly workflow: googleWorkflowsWorkflow.GoogleWorkflowsWorkflow;

  public constructor(scope: Construct, id: string, props: WorkflowConstructProps) {
    super(scope, id);

    const workflowApi = new googleProjectService.GoogleProjectService(this, 'workflowApi', {
      project: props.projectId,
      service: 'workflows.googleapis.com',
      disableOnDestroy: false,
    });

    const source = readFileSync(resolve(process.cwd(), props.sourcePath), 'utf8');
    const substitutions = props.substitutions ?? {};
    const renderedSource = Object.entries(substitutions).reduce((accumulator, [key, value]) => {
      const normalizedKey = key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      return accumulator.replaceAll(`__${normalizedKey}__`, value);
    }, source);

    this.workflow = new googleWorkflowsWorkflow.GoogleWorkflowsWorkflow(this, 'workflow', {
      project: props.projectId,
      region: props.region,
      name: props.workflowName,
      serviceAccount: props.serviceAccountEmail,
      sourceContents: renderedSource,
      callLogLevel: 'LOG_ALL_CALLS',
      dependsOn: [workflowApi],
    });

  }
}
