import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig } from '../config';

interface StorageStackProps extends cdk.StackProps {
  config: AppConfig;
}

export class StorageStack extends cdk.Stack {
  public readonly audioBucket: s3.Bucket;
  public readonly wordTemplatesBucket: s3.Bucket;
  public readonly meetingsTable: dynamodb.Table;
  public readonly transcriptSegmentsTable: dynamodb.Table;
  public readonly promptTemplatesTable: dynamodb.Table;
  public readonly reportTemplatesTable: dynamodb.Table;
  public readonly meetingReportsTable: dynamodb.Table;
  public readonly wordTemplateConfigTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    // S3 Bucket for audio files and transcription output
    this.audioBucket = new s3.Bucket(this, 'AudioBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'], // Will be restricted to CloudFront domain in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'ArchiveOldAudio',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      eventBridgeEnabled: true, // Enable EventBridge for S3 events
    });

    // Add bucket policy to allow AWS Transcribe service to access the bucket
    // Transcribe needs both object-level and bucket-level permissions
    this.audioBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowTranscribeServiceObjectAccess',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [this.audioBucket.arnForObjects('*')],
      })
    );

    this.audioBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowTranscribeServiceBucketAccess',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [this.audioBucket.bucketArn],
      })
    );

    // S3 Bucket for Word templates
    this.wordTemplatesBucket = new s3.Bucket(this, 'WordTemplatesBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // Will be restricted to CloudFront domain in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: Meetings
    this.meetingsTable = new dynamodb.Table(this, 'MeetingsTable', {
      tableName: 'Meetings',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for direct meetingId lookups
    this.meetingsTable.addGlobalSecondaryIndex({
      indexName: 'meetingId-index',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: TranscriptSegments
    this.transcriptSegmentsTable = new dynamodb.Table(this, 'TranscriptSegmentsTable', {
      tableName: 'TranscriptSegments',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: PromptTemplates (optional)
    this.promptTemplatesTable = new dynamodb.Table(this, 'PromptTemplatesTable', {
      tableName: 'PromptTemplates',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: ReportTemplates
    this.reportTemplatesTable = new dynamodb.Table(this, 'ReportTemplatesTable', {
      tableName: 'ReportTemplates',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Table: MeetingReports
    this.meetingReportsTable = new dynamodb.Table(this, 'MeetingReportsTable', {
      tableName: 'MeetingReports',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'reportId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add GSI for userId lookups on MeetingReports
    this.meetingReportsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: WordTemplateConfig
    this.wordTemplateConfigTable = new dynamodb.Table(this, 'WordTemplateConfigTable', {
      tableName: 'WordTemplateConfig',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.enableDetailedMonitoring,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Outputs
    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: this.audioBucket.bucketName,
      description: 'S3 bucket for audio files',
    });

    new cdk.CfnOutput(this, 'MeetingsTableName', {
      value: this.meetingsTable.tableName,
      description: 'DynamoDB table for meetings',
    });

    new cdk.CfnOutput(this, 'TranscriptSegmentsTableName', {
      value: this.transcriptSegmentsTable.tableName,
      description: 'DynamoDB table for transcript segments',
    });

    new cdk.CfnOutput(this, 'ReportTemplatesTableName', {
      value: this.reportTemplatesTable.tableName,
      description: 'DynamoDB table for report templates',
    });

    new cdk.CfnOutput(this, 'MeetingReportsTableName', {
      value: this.meetingReportsTable.tableName,
      description: 'DynamoDB table for meeting reports',
    });

    new cdk.CfnOutput(this, 'WordTemplatesBucketName', {
      value: this.wordTemplatesBucket.bucketName,
      description: 'S3 bucket for Word templates',
    });

    new cdk.CfnOutput(this, 'WordTemplatesBucketArn', {
      value: this.wordTemplatesBucket.bucketArn,
      description: 'ARN of S3 bucket for Word templates',
    });

    new cdk.CfnOutput(this, 'WordTemplateConfigTableName', {
      value: this.wordTemplateConfigTable.tableName,
      description: 'DynamoDB table for Word template configurations',
    });
  }

  /**
   * Add S3 event notification for transcribe output
   * This should be called from the API stack after the ProcessTranscribeOutputFunction is created
   */
  public addTranscribeOutputNotification(processFunction: lambda.IFunction): void {
    this.audioBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processFunction),
      {
        prefix: 'transcribe-output/',
      }
    );
  }
}
