import { GoogleProvider } from '@cdktf/provider-google/lib/provider/index.js';
import { App } from 'cdktf';
import { resolveEnvironmentConfig, resolveTargetEnvironment } from './config/environments.js';
import { PlatformStack } from './stacks/platform-stack.js';

const app = new App();
const environment = resolveTargetEnvironment();
const config = resolveEnvironmentConfig(environment);

const stack = new PlatformStack(app, `platform-${environment}`, config);

new GoogleProvider(stack, 'google', {
  project: config.projectId,
  region: config.region,
  billingProject: config.billingProjectId,
  userProjectOverride: Boolean(config.billingProjectId),
});

app.synth();
