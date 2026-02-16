import { Environment } from 'aws-cdk-lib';

export interface AppConfig {
  env: Environment;
  logRetentionDays: number;
  enableDetailedMonitoring: boolean;
  transcribeMaxSpeakers: number;
  bedrockModelId: string;
  bedrockTemperature: number;
  bedrockMaxTokens: number;
}

export const config: AppConfig = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  logRetentionDays: 90,
  enableDetailedMonitoring: true,
  transcribeMaxSpeakers: 10,
  bedrockModelId: 'amazon.nova-pro-v1:0',
  bedrockTemperature: 0.7,
  bedrockMaxTokens: 4096,
};
