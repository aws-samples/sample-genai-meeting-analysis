import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const PROMPT_TEMPLATES_TABLE = process.env.PROMPT_TEMPLATES_TABLE!;

interface UpdateSettingsRequest {
  promptTemplate: string;
  modelId: string;
  templateName?: string;
}

/**
 * Validate Bedrock model ID
 */
function isValidModelId(modelId: string): boolean {
  const validPrefixes = [
    'amazon.nova',
    'anthropic.claude',
    'us.anthropic.claude',
    'meta.llama',
    'mistral',
    'ai21',
    'cohere',
  ];

  return validPrefixes.some(prefix => modelId.startsWith(prefix));
}

/**
 * Lambda handler for updating user settings
 * PUT /settings
 */
export const handler = async (event: any): Promise<any> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'UpdateSettingsFunction invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);

    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Request body is required',
        retryable: false,
      });
    }

    const body: UpdateSettingsRequest = JSON.parse(event.body);

    // Validate required fields
    if (!body.promptTemplate || typeof body.promptTemplate !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'promptTemplate is required and must be a string',
        retryable: false,
      });
    }

    if (!body.modelId || typeof body.modelId !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'modelId is required and must be a string',
        retryable: false,
      });
    }

    // Validate model ID format
    if (!isValidModelId(body.modelId)) {
      return createErrorResponse(400, {
        code: 'INVALID_MODEL_ID',
        message: 'Invalid Bedrock model ID. Must start with a valid provider prefix (e.g., amazon.nova, anthropic.claude)',
        retryable: false,
      });
    }

    // Validate prompt template contains {{transcript}} placeholder
    if (!body.promptTemplate.includes('{{transcript}}')) {
      return createErrorResponse(400, {
        code: 'INVALID_PROMPT_TEMPLATE',
        message: 'Prompt template must contain {{transcript}} placeholder',
        retryable: false,
      });
    }

    const now = Date.now();

    logWithContext(correlationId, 'INFO', 'Updating user settings', {
      userId,
      modelId: body.modelId,
      promptLength: body.promptTemplate.length,
    });

    const putCommand = new PutCommand({
      TableName: PROMPT_TEMPLATES_TABLE,
      Item: {
        userId,
        templateId: 'default',
        templateName: body.templateName || 'Custom Template',
        promptText: body.promptTemplate,
        modelId: body.modelId,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    await docClient.send(putCommand);

    logWithContext(correlationId, 'INFO', 'User settings updated successfully', { userId });

    return createSuccessResponse({
      message: 'Settings updated successfully',
      updatedAt: now,
    });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'UpdateSettingsFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    if (error.name === 'SyntaxError') {
      return createErrorResponse(400, {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body',
        retryable: false,
      });
    }

    return createErrorResponse(500, {
      code: 'UPDATE_SETTINGS_FAILED',
      message: 'Failed to update settings',
      details: error.message,
      retryable: true,
    });
  }
};
