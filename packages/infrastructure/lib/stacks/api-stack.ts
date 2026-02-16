import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { ProcessingWorkflow } from '../constructs/processing-workflow';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  config: AppConfig;
  meetingsTable: dynamodb.Table;
  transcriptSegmentsTable: dynamodb.Table;
  promptTemplatesTable: dynamodb.Table;
  reportTemplatesTable: dynamodb.Table;
  meetingReportsTable: dynamodb.Table;
  audioBucket: s3.Bucket;
  wordTemplatesBucket: s3.Bucket;
  wordTemplateConfigTable: dynamodb.Table;
  userPool: cognito.UserPool;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;
  public readonly lambdaFunctions: lambda.Function[] = [];
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  public readonly processTranscribeOutputFunction: lambda.Function;
  public readonly updatePlaceholderFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, userPool } = props;

    // API Gateway REST API - served via CloudFront at /api/*
    this.api = new apigateway.RestApi(this, 'MeetingPlatformApi', {
      restApiName: 'Meeting Platform API',
      description: 'API for Meeting Analysis Platform',
      deployOptions: {
        stageName: 'v1',
        tracingEnabled: config.enableDetailedMonitoring,
        loggingLevel: config.enableDetailedMonitoring
          ? apigateway.MethodLoggingLevel.INFO
          : apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: config.enableDetailedMonitoring,
        metricsEnabled: true,
      }
    });

    // Cognito Authorizer for API Gateway
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'CognitoAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    // Request Validators
    const bodyValidator = this.api.addRequestValidator('BodyValidator', {
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // Request Models
    const createMeetingModel = this.api.addModel('CreateMeetingModel', {
      contentType: 'application/json',
      modelName: 'CreateMeetingModel',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['fileName', 'fileSize', 'contentType'],
        properties: {
          fileName: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 1,
            maxLength: 255,
          },
          fileSize: {
            type: apigateway.JsonSchemaType.INTEGER,
            minimum: 1,
          },
          contentType: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: '^(audio|video)/.+$',
          },
        },
      },
    });

    const updateSpeakersModel = this.api.addModel('UpdateSpeakersModel', {
      contentType: 'application/json',
      modelName: 'UpdateSpeakersModel',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['speakerMappings'],
        properties: {
          speakerMappings: {
            type: apigateway.JsonSchemaType.OBJECT,
          },
        },
      },
    });

    // Gateway Responses for better error handling
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      templates: {
        'application/json': '{"error": {"code": "UNAUTHORIZED", "message": "Authentication required"}}',
      },
    });

    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      templates: {
        'application/json': '{"error": {"code": "ACCESS_DENIED", "message": "Access denied"}}',
      },
    });

    this.api.addGatewayResponse('BadRequestBody', {
      type: apigateway.ResponseType.BAD_REQUEST_BODY,
      statusCode: '400',
      templates: {
        'application/json': '{"error": {"code": "INVALID_REQUEST_BODY", "message": "Invalid request body", "details": "$context.error.validationErrorString"}}',
      },
    });

    this.api.addGatewayResponse('BadRequestParameters', {
      type: apigateway.ResponseType.BAD_REQUEST_PARAMETERS,
      statusCode: '400',
      templates: {
        'application/json': '{"error": {"code": "INVALID_REQUEST_PARAMETERS", "message": "Invalid request parameters", "details": "$context.error.validationErrorString"}}',
      },
    });

    this.api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
    });

    this.api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
    });

    // API Resources - all under /api prefix (CloudFront routes /api/* to API Gateway)
    const apiResource = this.api.root.addResource('api');
    const meetingsResource = apiResource.addResource('meetings');
    const meetingResource = meetingsResource.addResource('{id}');

    // Health check endpoint to validate authorizer setup
    const healthResource = apiResource.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "ok"}',
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }), {
      methodResponses: [{ statusCode: '200' }],
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Lambda Functions
    
    // CreateMeetingFunction - POST /meetings
    const createMeetingFunction = new lambdaNodejs.NodejsFunction(this, 'CreateMeetingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/create-meeting/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        AUDIO_BUCKET: props.audioBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantWriteData(createMeetingFunction);
    props.audioBucket.grantPut(createMeetingFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(createMeetingFunction);

    // POST /meetings endpoint
    meetingsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(createMeetingFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
        requestModels: {
          'application/json': createMeetingModel,
        },
      }
    );

    // StartTranscriptionFunction - POST /meetings/{id}/start-transcription
    const startTranscriptionFunction = new lambdaNodejs.NodejsFunction(this, 'StartTranscriptionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/start-transcription/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        AUDIO_BUCKET: props.audioBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadWriteData(startTranscriptionFunction);
    props.audioBucket.grantRead(startTranscriptionFunction);
    
    // Grant Transcribe permissions - needs both StartTranscriptionJob and GetTranscriptionJob
    // Scoped to transcription jobs in this account/region
    startTranscriptionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
      ],
      resources: [`arn:aws:transcribe:${this.region}:${this.account}:transcription-job/*`],
    }));
    
    // Grant S3 permissions for Transcribe to write output
    // The Lambda role needs permission to allow Transcribe to write to the bucket
    startTranscriptionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:PutObject',
        's3:GetObject',
      ],
      resources: [
        `${props.audioBucket.bucketArn}/uploads/*`,
        `${props.audioBucket.bucketArn}/transcribe-output/*`,
      ],
    }));

    // Add to Lambda functions list
    this.lambdaFunctions.push(startTranscriptionFunction);

    // POST /meetings/{id}/start-transcription endpoint
    const startTranscriptionResource = meetingResource.addResource('start-transcription');
    startTranscriptionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(startTranscriptionFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ProcessTranscribeOutputFunction - Triggered by S3 event
    this.processTranscribeOutputFunction = new lambdaNodejs.NodejsFunction(this, 'ProcessTranscribeOutputFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/process-transcribe-output/index.ts'),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        TRANSCRIPT_SEGMENTS_TABLE: props.transcriptSegmentsTable.tableName,
        GENERATE_ANALYSIS_FUNCTION_NAME: 'GenerateAnalysisFunction', // Will be updated in task 8
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadWriteData(this.processTranscribeOutputFunction);
    props.transcriptSegmentsTable.grantWriteData(this.processTranscribeOutputFunction);
    props.audioBucket.grantRead(this.processTranscribeOutputFunction);
    
    // Grant Lambda invoke permissions for GenerateAnalysisFunction
    // Note: generateAnalysisFunction ARN will be added after it's created below
    this.processTranscribeOutputFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:*GenerateAnalysisFunction*`,
      ],
    }));

    // Add to Lambda functions list
    this.lambdaFunctions.push(this.processTranscribeOutputFunction);

    // Configure S3 event notification for transcribe-output prefix using EventBridge
    // Note: The audioBucket already has eventBridgeEnabled: true in StorageStack
    const s3EventRule = new events.Rule(this, 'TranscribeOutputRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [props.audioBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'transcribe-output/' }],
          },
        },
      },
    });

    s3EventRule.addTarget(new events_targets.LambdaFunction(this.processTranscribeOutputFunction));

    // GenerateReportFunction - POST /meetings/{id}/generate-report
    const generateReportFunction = new lambdaNodejs.NodejsFunction(this, 'GenerateReportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/generate-report/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1536,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        TRANSCRIPT_SEGMENTS_TABLE: props.transcriptSegmentsTable.tableName,
        REPORT_TEMPLATES_TABLE: props.reportTemplatesTable.tableName,
        MEETING_REPORTS_TABLE: props.meetingReportsTable.tableName,
        BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadWriteData(generateReportFunction);
    props.transcriptSegmentsTable.grantReadData(generateReportFunction);
    props.reportTemplatesTable.grantReadData(generateReportFunction);
    props.meetingReportsTable.grantWriteData(generateReportFunction);
    
    // Grant Bedrock permissions - scoped to specific model
    generateReportFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));

    // Add to Lambda functions list
    this.lambdaFunctions.push(generateReportFunction);

    // GenerateAnalysisFunction - Invoked by Step Functions workflow
    const generateAnalysisFunction = new lambdaNodejs.NodejsFunction(this, 'GenerateAnalysisFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/generate-analysis/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        TRANSCRIPT_SEGMENTS_TABLE: props.transcriptSegmentsTable.tableName,
        PROMPT_TEMPLATES_TABLE: props.promptTemplatesTable.tableName,
        BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadWriteData(generateAnalysisFunction);
    props.transcriptSegmentsTable.grantReadData(generateAnalysisFunction);
    props.promptTemplatesTable.grantReadData(generateAnalysisFunction);
    
    // Grant Bedrock permissions - scoped to specific model
    generateAnalysisFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));

    // Add to Lambda functions list
    this.lambdaFunctions.push(generateAnalysisFunction);

    // GetMeetingStatusFunction - GET /meetings/{id}/status
    const getMeetingStatusFunction = new lambdaNodejs.NodejsFunction(this, 'GetMeetingStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-meeting-status/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadData(getMeetingStatusFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getMeetingStatusFunction);

    // GET /meetings/{id}/status endpoint
    const statusResource = meetingResource.addResource('status');
    statusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getMeetingStatusFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GetMeetingFunction - GET /meetings/{id}
    const getMeetingFunction = new lambdaNodejs.NodejsFunction(this, 'GetMeetingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-meeting/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
        AUDIO_BUCKET: props.audioBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadData(getMeetingFunction);
    props.audioBucket.grantRead(getMeetingFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getMeetingFunction);

    // GET /meetings/{id} endpoint
    meetingResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getMeetingFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GetTranscriptFunction - GET /meetings/{id}/transcript
    const getTranscriptFunction = new lambdaNodejs.NodejsFunction(this, 'GetTranscriptFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-transcript/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TRANSCRIPT_SEGMENTS_TABLE: props.transcriptSegmentsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.transcriptSegmentsTable.grantReadData(getTranscriptFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getTranscriptFunction);

    // GET /meetings/{id}/transcript endpoint
    const transcriptResource = meetingResource.addResource('transcript');
    transcriptResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getTranscriptFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // UpdateSpeakersFunction - PUT /meetings/{id}/speakers
    const updateSpeakersFunction = new lambdaNodejs.NodejsFunction(this, 'UpdateSpeakersFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/update-speakers/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TRANSCRIPT_SEGMENTS_TABLE: props.transcriptSegmentsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.transcriptSegmentsTable.grantReadWriteData(updateSpeakersFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(updateSpeakersFunction);

    // PUT /meetings/{id}/speakers endpoint
    const speakersResource = meetingResource.addResource('speakers');
    speakersResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(updateSpeakersFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
        requestModels: {
          'application/json': updateSpeakersModel,
        },
      }
    );

    // GetAnalysisFunction - GET /meetings/{id}/analysis
    const getAnalysisFunction = new lambdaNodejs.NodejsFunction(this, 'GetAnalysisFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-analysis/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadData(getAnalysisFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getAnalysisFunction);

    // GET /meetings/{id}/analysis endpoint
    const analysisResource = meetingResource.addResource('analysis');
    analysisResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getAnalysisFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /meetings/{id}/analyze endpoint - Trigger analysis regeneration
    analysisResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(generateAnalysisFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /meetings/{id}/generate-report endpoint
    const generateReportResource = meetingResource.addResource('generate-report');
    generateReportResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(generateReportFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GetReportFunction - GET /meetings/{id}/report
    const getReportFunction = new lambdaNodejs.NodejsFunction(this, 'GetReportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-report/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETING_REPORTS_TABLE: props.meetingReportsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingReportsTable.grantReadData(getReportFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getReportFunction);

    // GET /meetings/{id}/report endpoint
    const reportResource = meetingResource.addResource('report');
    reportResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getReportFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // UpdatePlaceholderFunction - PATCH /meetings/{id}/report/placeholders/{placeholderName}
    this.updatePlaceholderFunction = new lambdaNodejs.NodejsFunction(this, 'UpdatePlaceholderFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/update-placeholder/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETING_REPORTS_TABLE: props.meetingReportsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingReportsTable.grantReadWriteData(this.updatePlaceholderFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(this.updatePlaceholderFunction);

    // PATCH /meetings/{id}/report/placeholders/{placeholderName} endpoint
    const placeholdersResource = reportResource.addResource('placeholders');
    const placeholderResource = placeholdersResource.addResource('{placeholderName}');
    placeholderResource.addMethod(
      'PATCH',
      new apigateway.LambdaIntegration(this.updatePlaceholderFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
      }
    );

    // ListMeetingsFunction - GET /meetings
    const listMeetingsFunction = new lambdaNodejs.NodejsFunction(this, 'ListMeetingsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/list-meetings/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETINGS_TABLE: props.meetingsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingsTable.grantReadData(listMeetingsFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(listMeetingsFunction);

    // GET /meetings endpoint - List user's meetings
    meetingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listMeetingsFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GetSettingsFunction - GET /settings
    const getSettingsFunction = new lambdaNodejs.NodejsFunction(this, 'GetSettingsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-settings/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        PROMPT_TEMPLATES_TABLE: props.promptTemplatesTable.tableName,
        BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.promptTemplatesTable.grantReadData(getSettingsFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getSettingsFunction);

    // GET /api/settings endpoint
    const settingsResource = apiResource.addResource('settings');
    settingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getSettingsFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // UpdateSettingsFunction - PUT /settings
    const updateSettingsFunction = new lambdaNodejs.NodejsFunction(this, 'UpdateSettingsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/update-settings/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        PROMPT_TEMPLATES_TABLE: props.promptTemplatesTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.promptTemplatesTable.grantWriteData(updateSettingsFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(updateSettingsFunction);

    // PUT /settings endpoint
    settingsResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(updateSettingsFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
      }
    );

    // SaveTemplateFunction - PUT /settings/report-template
    const saveTemplateFunction = new lambdaNodejs.NodejsFunction(this, 'SaveTemplateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/save-template/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        REPORT_TEMPLATES_TABLE: props.reportTemplatesTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.reportTemplatesTable.grantWriteData(saveTemplateFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(saveTemplateFunction);

    // PUT /settings/report-template endpoint
    const reportTemplateResource = settingsResource.addResource('report-template');
    reportTemplateResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(saveTemplateFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
      }
    );

    // GetTemplateFunction - GET /settings/report-template
    const getTemplateFunction = new lambdaNodejs.NodejsFunction(this, 'GetTemplateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-template/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        REPORT_TEMPLATES_TABLE: props.reportTemplatesTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.reportTemplatesTable.grantReadData(getTemplateFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getTemplateFunction);

    // GET /settings/report-template endpoint
    reportTemplateResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getTemplateFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // UploadWordTemplateFunction - PUT /settings/word-template
    const uploadWordTemplateFunction = new lambdaNodejs.NodejsFunction(this, 'UploadWordTemplateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/upload-word-template/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        WORD_TEMPLATES_BUCKET: props.wordTemplatesBucket.bucketName,
        WORD_TEMPLATE_CONFIG_TABLE: props.wordTemplateConfigTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.wordTemplatesBucket.grantPut(uploadWordTemplateFunction);
    props.wordTemplateConfigTable.grantWriteData(uploadWordTemplateFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(uploadWordTemplateFunction);

    // GetWordTemplateConfigFunction - GET /settings/word-template
    const getWordTemplateConfigFunction = new lambdaNodejs.NodejsFunction(this, 'GetWordTemplateConfigFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-word-template-config/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        WORD_TEMPLATES_BUCKET: props.wordTemplatesBucket.bucketName,
        WORD_TEMPLATE_CONFIG_TABLE: props.wordTemplateConfigTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.wordTemplatesBucket.grantRead(getWordTemplateConfigFunction);
    props.wordTemplateConfigTable.grantReadData(getWordTemplateConfigFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getWordTemplateConfigFunction);

    // UpdateWordTemplateConfigFunction - PATCH /settings/word-template
    const updateWordTemplateConfigFunction = new lambdaNodejs.NodejsFunction(this, 'UpdateWordTemplateConfigFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/update-word-template-config/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        WORD_TEMPLATE_CONFIG_TABLE: props.wordTemplateConfigTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.wordTemplateConfigTable.grantReadWriteData(updateWordTemplateConfigFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(updateWordTemplateConfigFunction);

    // Word template API routes - /settings/word-template
    const wordTemplateResource = settingsResource.addResource('word-template');

    // PUT /settings/word-template endpoint
    wordTemplateResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(uploadWordTemplateFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
      }
    );

    // GET /settings/word-template endpoint
    wordTemplateResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getWordTemplateConfigFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PATCH /settings/word-template endpoint
    wordTemplateResource.addMethod(
      'PATCH',
      new apigateway.LambdaIntegration(updateWordTemplateConfigFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: bodyValidator,
      }
    );

    // GenerateWordReportFunction - POST /meetings/{id}/word-report
    const generateWordReportFunction = new lambdaNodejs.NodejsFunction(this, 'GenerateWordReportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/generate-word-report/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1536,
      environment: {
        WORD_TEMPLATES_BUCKET: props.wordTemplatesBucket.bucketName,
        WORD_TEMPLATE_CONFIG_TABLE: props.wordTemplateConfigTable.tableName,
        MEETING_REPORTS_TABLE: props.meetingReportsTable.tableName,
        MEETINGS_TABLE: props.meetingsTable.tableName,
        GENERATED_REPORTS_BUCKET: props.audioBucket.bucketName, // Reuse audioBucket for generated reports
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.wordTemplatesBucket.grantRead(generateWordReportFunction);
    props.wordTemplateConfigTable.grantReadData(generateWordReportFunction);
    props.meetingReportsTable.grantReadWriteData(generateWordReportFunction);
    props.meetingsTable.grantReadWriteData(generateWordReportFunction);
    props.audioBucket.grantReadWrite(generateWordReportFunction);

    // Grant Bedrock permissions for translation - scoped to specific model
    generateWordReportFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));

    // Add to Lambda functions list
    this.lambdaFunctions.push(generateWordReportFunction);

    // Create the Step Functions processing workflow
    const processingWorkflow = new ProcessingWorkflow(this, 'ProcessingWorkflow', {
      generateAnalysisFunction,
      generateReportFunction,
      generateWordReportFunction,
    });

    // Update ProcessTranscribeOutputFunction with state machine ARN
    this.processTranscribeOutputFunction.addEnvironment(
      'PROCESSING_STATE_MACHINE_ARN',
      processingWorkflow.stateMachine.stateMachineArn
    );

    // Grant ProcessTranscribeOutputFunction permission to start the workflow
    processingWorkflow.stateMachine.grantStartExecution(this.processTranscribeOutputFunction);

    // GetWordReportFunction - GET /meetings/{id}/word-report
    const getWordReportFunction = new lambdaNodejs.NodejsFunction(this, 'GetWordReportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambda/get-word-report/index.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEETING_REPORTS_TABLE: props.meetingReportsTable.tableName,
        GENERATED_REPORTS_BUCKET: props.audioBucket.bucketName, // Reuse audioBucket for generated reports
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permissions
    props.meetingReportsTable.grantReadData(getWordReportFunction);
    props.audioBucket.grantRead(getWordReportFunction);

    // Add to Lambda functions list
    this.lambdaFunctions.push(getWordReportFunction);

    // Word report API routes - /meetings/{id}/word-report
    const wordReportResource = meetingResource.addResource('word-report');

    // POST /meetings/{id}/word-report endpoint
    wordReportResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(generateWordReportFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /meetings/{id}/word-report endpoint
    wordReportResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getWordReportFunction, {
        proxy: true,
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    this.apiUrl = this.api.url;

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
    });
  }
}
