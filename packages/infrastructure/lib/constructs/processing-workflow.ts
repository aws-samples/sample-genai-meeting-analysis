import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ProcessingWorkflowProps {
  generateAnalysisFunction: lambda.Function;
  generateReportFunction: lambda.Function;
  generateWordReportFunction: lambda.Function;
}

/**
 * Step Functions state machine that orchestrates the meeting processing pipeline:
 * 1. Generate Analysis (Bedrock) - with retries
 * 2. Generate Report (Bedrock) - with retries  
 * 3. Generate Word Report (Bedrock translation) - with retries
 */
export class ProcessingWorkflow extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: ProcessingWorkflowProps) {
    super(scope, id);

    // Common retry configuration for Bedrock throttling/transient errors
    const bedrockRetryConfig: sfn.RetryProps[] = [
      {
        errors: [
          'ThrottlingException',
          'ServiceUnavailableException', 
          'InternalServerException',
          'ModelTimeoutException',
          'Lambda.ServiceException',
          'Lambda.TooManyRequestsException',
        ],
        interval: cdk.Duration.seconds(2),
        maxAttempts: 5,
        backoffRate: 2, // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        jitterStrategy: sfn.JitterType.FULL,
      },
    ];

    // Step 1: Generate Analysis
    const generateAnalysis = new tasks.LambdaInvoke(this, 'GenerateAnalysis', {
      lambdaFunction: props.generateAnalysisFunction,
      payload: sfn.TaskInput.fromObject({
        meetingId: sfn.JsonPath.stringAt('$.meetingId'),
        userId: sfn.JsonPath.stringAt('$.userId'),
        correlationId: sfn.JsonPath.stringAt('$.correlationId'),
      }),
      resultPath: '$.analysisResult',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'meetingId.$': '$.Payload.meetingId',
      },
    });
    generateAnalysis.addRetry(bedrockRetryConfig[0]);

    // Step 2: Generate Report
    const generateReport = new tasks.LambdaInvoke(this, 'GenerateReport', {
      lambdaFunction: props.generateReportFunction,
      payload: sfn.TaskInput.fromObject({
        meetingId: sfn.JsonPath.stringAt('$.meetingId'),
        userId: sfn.JsonPath.stringAt('$.userId'),
        correlationId: sfn.JsonPath.stringAt('$.correlationId'),
      }),
      resultPath: '$.reportResult',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'meetingId.$': '$.Payload.meetingId',
        'reportId.$': '$.Payload.reportId',
      },
    });
    generateReport.addRetry(bedrockRetryConfig[0]);

    // Step 3: Generate Word Report
    const generateWordReport = new tasks.LambdaInvoke(this, 'GenerateWordReport', {
      lambdaFunction: props.generateWordReportFunction,
      payload: sfn.TaskInput.fromObject({
        meetingId: sfn.JsonPath.stringAt('$.meetingId'),
        userId: sfn.JsonPath.stringAt('$.userId'),
        correlationId: sfn.JsonPath.stringAt('$.correlationId'),
      }),
      resultPath: '$.wordReportResult',
      resultSelector: {
        'statusCode.$': '$.Payload.statusCode',
        'documentKey.$': '$.Payload.documentKey',
      },
    });
    generateWordReport.addRetry(bedrockRetryConfig[0]);

    // Error handler - update meeting status to failed
    const processingFailed = new sfn.Fail(this, 'ProcessingFailed', {
      error: 'ProcessingError',
      cause: 'Meeting processing pipeline failed after retries',
    });

    // Success state
    const processingComplete = new sfn.Succeed(this, 'ProcessingComplete', {
      comment: 'Meeting processing completed successfully',
    });

    // Add catch handlers to each step
    generateAnalysis.addCatch(processingFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    generateReport.addCatch(processingFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    generateWordReport.addCatch(processingFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Chain the steps
    const definition = generateAnalysis
      .next(generateReport)
      .next(generateWordReport)
      .next(processingComplete);

    // Create CloudWatch log group for state machine
    const logGroup = new logs.LogGroup(this, 'ProcessingWorkflowLogs', {
      logGroupName: '/aws/stepfunctions/meeting-processing-workflow',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create the state machine
    this.stateMachine = new sfn.StateMachine(this, 'MeetingProcessingStateMachine', {
      stateMachineName: 'MeetingProcessingWorkflow',
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });
  }
}
