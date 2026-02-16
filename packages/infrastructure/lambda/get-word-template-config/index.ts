import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { WordTemplateConfigItem, PlaceholderConfig } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const WORD_TEMPLATES_BUCKET = process.env.WORD_TEMPLATES_BUCKET!;
const WORD_TEMPLATE_CONFIG_TABLE = process.env.WORD_TEMPLATE_CONFIG_TABLE!;
const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * Response for getting Word template configuration
 */
interface WordTemplateConfigResponse {
  templateId: string;
  templateName: string;
  sourceLanguage: string;
  targetLanguage: string;
  placeholders: PlaceholderConfig[];
  templateUrl: string; // Presigned URL for download
  createdAt: number;
  updatedAt: number;
}

/**
 * Lambda handler for getting Word template configuration
 * GET /settings/word-template
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'GetWordTemplateConfigFunction invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);

    logWithContext(correlationId, 'INFO', 'Fetching Word template config', { userId });

    // Retrieve config from DynamoDB
    const getCommand = new GetCommand({
      TableName: WORD_TEMPLATE_CONFIG_TABLE,
      Key: {
        userId,
        templateId: 'default',
      },
    });

    const result = await docClient.send(getCommand);

    if (!result.Item) {
      logWithContext(correlationId, 'INFO', 'No Word template config found', { userId });

      return createErrorResponse(404, {
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Word template not configured. Please upload a template first.',
        retryable: false,
      });
    }

    const config = result.Item as WordTemplateConfigItem;

    logWithContext(correlationId, 'INFO', 'Word template config found', {
      userId,
      templateId: config.templateId,
      placeholderCount: config.placeholders.length,
    });

    // Generate presigned URL for template download
    const getObjectCommand = new GetObjectCommand({
      Bucket: WORD_TEMPLATES_BUCKET,
      Key: config.templateS3Key,
    });

    const templateUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    logWithContext(correlationId, 'INFO', 'Presigned URL generated', {
      userId,
      templateId: config.templateId,
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    const response: WordTemplateConfigResponse = {
      templateId: config.templateId,
      templateName: config.templateName,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      placeholders: config.placeholders,
      templateUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };

    logWithContext(correlationId, 'INFO', 'GetWordTemplateConfigFunction completed successfully', {
      userId,
      templateId: config.templateId,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GetWordTemplateConfigFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'GET_TEMPLATE_CONFIG_FAILED',
      message: 'Failed to retrieve Word template configuration',
      details: error.message,
      retryable: true,
    });
  }
};
