#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';

// Load environment variables from .env.local or .env
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { AuthCallbackUpdaterStack } from '../lib/stacks/auth-callback-updater-stack';
import { config } from '../lib/config';

const app = new cdk.App();

// Add tags to all resources
cdk.Tags.of(app).add('Project', 'MeetingAnalysisPlatform');

// Storage Stack - DynamoDB tables and S3 buckets
const storageStack = new StorageStack(app, 'MeetingPlatform-Storage', {
  env: config.env,
  config,
});

// Auth Stack - Cognito User Pool and Identity Pool
const authStack = new AuthStack(app, 'MeetingPlatform-Auth', {
  env: config.env,
  config,
  audioBucket: storageStack.audioBucket,
});

// API Stack - Lambda functions and API Gateway
const apiStack = new ApiStack(app, 'MeetingPlatform-Api', {
  env: config.env,
  config,
  meetingsTable: storageStack.meetingsTable,
  transcriptSegmentsTable: storageStack.transcriptSegmentsTable,
  promptTemplatesTable: storageStack.promptTemplatesTable,
  reportTemplatesTable: storageStack.reportTemplatesTable,
  meetingReportsTable: storageStack.meetingReportsTable,
  audioBucket: storageStack.audioBucket,
  wordTemplatesBucket: storageStack.wordTemplatesBucket,
  wordTemplateConfigTable: storageStack.wordTemplateConfigTable,
  userPool: authStack.userPool,
});

// Frontend Stack - S3 and CloudFront for React app
// API Gateway is served via CloudFront at /api/* (same origin, no CORS needed)
const frontendStack = new FrontendStack(app, 'MeetingPlatform-Frontend', {
  env: config.env,
  config,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  identityPool: authStack.identityPool,
  userPoolDomain: authStack.userPoolDomain,
  api: apiStack.api,
});

// Auth Callback Updater Stack - Updates Cognito callback URLs with CloudFront domain
// This stack depends on both Auth and Frontend, breaking the circular dependency
new AuthCallbackUpdaterStack(app, 'MeetingPlatform-AuthCallbackUpdater', {
  env: config.env,
  config,
  userPoolClient: authStack.userPoolClient,
  userPoolId: authStack.userPool.userPoolId,
  cloudfrontDomain: frontendStack.distribution.distributionDomainName,
});

// Monitoring Stack - CloudWatch dashboards and alarms
new MonitoringStack(app, 'MeetingPlatform-Monitoring', {
  env: config.env,
  config,
  api: apiStack.api,
  lambdaFunctions: apiStack.lambdaFunctions,
  updatePlaceholderFunction: apiStack.updatePlaceholderFunction,
});

app.synth();
