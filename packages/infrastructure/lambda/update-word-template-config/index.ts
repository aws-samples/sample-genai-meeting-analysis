import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { PlaceholderConfig, SUPPORTED_LANGUAGES, LanguageCode, WordTemplateConfigItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const WORD_TEMPLATE_CONFIG_TABLE = process.env.WORD_TEMPLATE_CONFIG_TABLE!;

/**
 * Request body for updating Word template configuration
 */
interface UpdateWordTemplateConfigRequest {
  sourceLanguage?: string;
  targetLanguage?: string;
  placeholders?: PlaceholderConfig[];
}

/**
 * Response for successful configuration update
 */
interface UpdateWordTemplateConfigResponse {
  templateId: string;
  sourceLanguage: string;
  targetLanguage: string;
  placeholders: PlaceholderConfig[];
  updatedAt: number;
  message: string;
}

/**
 * Validates that a language code is supported
 */
export function isValidLanguageCode(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some(lang => lang.code === code);
}

/**
 * Validates placeholder configuration array
 */
export function validatePlaceholders(placeholders: PlaceholderConfig[]): { valid: boolean; error?: string } {
  if (!Array.isArray(placeholders)) {
    return { valid: false, error: 'placeholders must be an array' };
  }

  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    if (!placeholder || typeof placeholder !== 'object') {
      return { valid: false, error: `placeholders[${i}] must be an object` };
    }
    if (typeof placeholder.name !== 'string' || placeholder.name.trim() === '') {
      return { valid: false, error: `placeholders[${i}].name must be a non-empty string` };
    }
    if (typeof placeholder.translateEnabled !== 'boolean') {
      return { valid: false, error: `placeholders[${i}].translateEnabled must be a boolean` };
    }
  }

  return { valid: true };
}


/**
 * Lambda handler for updating Word template configuration
 * PATCH /settings/word-template
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'UpdateWordTemplateConfigFunction invoked', {
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

    let body: UpdateWordTemplateConfigRequest;
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      return createErrorResponse(400, {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body',
        retryable: false,
      });
    }

    // Validate that at least one field is being updated
    if (!body.sourceLanguage && !body.targetLanguage && !body.placeholders) {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'At least one of sourceLanguage, targetLanguage, or placeholders must be provided',
        retryable: false,
      });
    }

    // Validate language codes if provided
    if (body.sourceLanguage !== undefined) {
      if (typeof body.sourceLanguage !== 'string') {
        return createErrorResponse(400, {
          code: 'INVALID_REQUEST',
          message: 'sourceLanguage must be a string',
          retryable: false,
        });
      }
      if (!isValidLanguageCode(body.sourceLanguage)) {
        return createErrorResponse(400, {
          code: 'INVALID_LANGUAGE',
          message: `Invalid sourceLanguage: ${body.sourceLanguage}. Supported languages: ${SUPPORTED_LANGUAGES.map(l => l.code).join(', ')}`,
          retryable: false,
        });
      }
    }

    if (body.targetLanguage !== undefined) {
      if (typeof body.targetLanguage !== 'string') {
        return createErrorResponse(400, {
          code: 'INVALID_REQUEST',
          message: 'targetLanguage must be a string',
          retryable: false,
        });
      }
      if (!isValidLanguageCode(body.targetLanguage)) {
        return createErrorResponse(400, {
          code: 'INVALID_LANGUAGE',
          message: `Invalid targetLanguage: ${body.targetLanguage}. Supported languages: ${SUPPORTED_LANGUAGES.map(l => l.code).join(', ')}`,
          retryable: false,
        });
      }
    }

    // Validate placeholders if provided
    if (body.placeholders !== undefined) {
      const placeholderValidation = validatePlaceholders(body.placeholders);
      if (!placeholderValidation.valid) {
        return createErrorResponse(400, {
          code: 'INVALID_PLACEHOLDERS',
          message: placeholderValidation.error || 'Invalid placeholders configuration',
          retryable: false,
        });
      }
    }

    const templateId = 'default';

    logWithContext(correlationId, 'INFO', 'Checking existing template config', { userId, templateId });

    // First, verify the template exists
    const getCommand = new GetCommand({
      TableName: WORD_TEMPLATE_CONFIG_TABLE,
      Key: {
        userId,
        templateId,
      },
    });

    const existingConfig = await docClient.send(getCommand);

    if (!existingConfig.Item) {
      logWithContext(correlationId, 'WARN', 'Template config not found', { userId, templateId });

      return createErrorResponse(404, {
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Word template not configured. Please upload a template first.',
        retryable: false,
      });
    }

    const currentConfig = existingConfig.Item as WordTemplateConfigItem;
    const now = Date.now();

    // Build update expression dynamically
    const updateExpressionParts: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': now,
    };

    if (body.sourceLanguage !== undefined) {
      updateExpressionParts.push('#sourceLanguage = :sourceLanguage');
      expressionAttributeNames['#sourceLanguage'] = 'sourceLanguage';
      expressionAttributeValues[':sourceLanguage'] = body.sourceLanguage;
    }

    if (body.targetLanguage !== undefined) {
      updateExpressionParts.push('#targetLanguage = :targetLanguage');
      expressionAttributeNames['#targetLanguage'] = 'targetLanguage';
      expressionAttributeValues[':targetLanguage'] = body.targetLanguage;
    }

    if (body.placeholders !== undefined) {
      updateExpressionParts.push('#placeholders = :placeholders');
      expressionAttributeNames['#placeholders'] = 'placeholders';
      expressionAttributeValues[':placeholders'] = body.placeholders;
    }

    const updateExpression = 'SET ' + updateExpressionParts.join(', ');

    logWithContext(correlationId, 'INFO', 'Updating template config', {
      userId,
      templateId,
      fieldsUpdated: Object.keys(expressionAttributeNames).filter(k => k !== '#updatedAt'),
    });

    // Update the configuration
    const updateCommand = new UpdateCommand({
      TableName: WORD_TEMPLATE_CONFIG_TABLE,
      Key: {
        userId,
        templateId,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    });

    const updateResult = await docClient.send(updateCommand);
    const updatedConfig = updateResult.Attributes as WordTemplateConfigItem;

    logWithContext(correlationId, 'INFO', 'Template config updated successfully', {
      userId,
      templateId,
      sourceLanguage: updatedConfig.sourceLanguage,
      targetLanguage: updatedConfig.targetLanguage,
      placeholderCount: updatedConfig.placeholders.length,
    });

    const response: UpdateWordTemplateConfigResponse = {
      templateId: updatedConfig.templateId,
      sourceLanguage: updatedConfig.sourceLanguage,
      targetLanguage: updatedConfig.targetLanguage,
      placeholders: updatedConfig.placeholders,
      updatedAt: updatedConfig.updatedAt,
      message: 'Word template configuration updated successfully',
    };

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'UpdateWordTemplateConfigFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'UPDATE_TEMPLATE_CONFIG_FAILED',
      message: 'Failed to update Word template configuration',
      details: error.message,
      retryable: true,
    });
  }
};
