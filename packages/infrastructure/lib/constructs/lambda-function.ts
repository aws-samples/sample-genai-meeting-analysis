import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';

export interface MeetingPlatformLambdaProps {
  functionName: string;
  description: string;
  entry: string;
  handler?: string;
  timeout?: cdk.Duration;
  memorySize?: number;
  environment?: { [key: string]: string };
  logRetentionDays: number;
}

export class MeetingPlatformLambda extends Construct {
  public readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: MeetingPlatformLambdaProps) {
    super(scope, id);

    // Create Lambda function with TypeScript bundling
    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName: props.functionName,
      description: props.description,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: join(__dirname, '../../lambda', props.entry),
      handler: props.handler || 'handler',
      timeout: props.timeout || cdk.Duration.seconds(30),
      memorySize: props.memorySize || 256,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ...props.environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2020',
        externalModules: [
          '@aws-sdk/*', // AWS SDK v3 is included in Lambda runtime
        ],
      },
      logRetention: props.logRetentionDays as logs.RetentionDays,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Add tags
    cdk.Tags.of(this.function).add('Component', 'Lambda');
    cdk.Tags.of(this.function).add('FunctionName', props.functionName);
  }
}
