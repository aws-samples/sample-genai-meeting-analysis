import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { SaveTemplateRequest } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const REPORT_TEMPLATES_TABLE = process.env.REPORT_TEMPLATES_TABLE!;
const MAX_TEMPLATE_SIZE = 50 * 1024; // 50KB

/**
 * Validate template placeholder syntax
 * Placeholders must be in the format {{placeholder_name}}
 * Returns array of validation errors, empty if valid
 */
export function validateTemplateSyntax(templateContent: string): string[] {
  const errors: string[] = [];

  // Check for malformed placeholders
  const placeholderPattern = /\{\{([^}]*)\}\}/g;
  const matches = templateContent.matchAll(placeholderPattern);

  for (const match of matches) {
    const placeholderName = match[1].trim();
    
    // Check if placeholder name is empty
    if (!placeholderName) {
      errors.push(`Empty placeholder found at position ${match.index}`);
      continue;
    }

    // Check if placeholder name contains only valid characters (alphanumeric and underscore)
    if (!/^[a-zA-Z0-9_]+$/.test(placeholderName)) {
      errors.push(`Invalid placeholder name '${placeholderName}' - must contain only letters, numbers, and underscores`);
    }
  }

  // Check for unmatched opening braces
  const openBraces = (templateContent.match(/\{\{/g) || []).length;
  const closeBraces = (templateContent.match(/\}\}/g) || []).length;
  
  if (openBraces !== closeBraces) {
    errors.push(`Mismatched braces: ${openBraces} opening '{{' but ${closeBraces} closing '}}'`);
  }

  // Check for single braces that might be typos (but not part of valid {{}} pairs)
  // Remove all valid {{...}} patterns first, then check for remaining single braces
  const withoutValidPlaceholders = templateContent.replace(/\{\{[^}]*\}\}/g, '');
  const singleOpenBrace = withoutValidPlaceholders.match(/\{/g);
  const singleCloseBrace = withoutValidPlaceholders.match(/\}/g);
  
  if (singleOpenBrace && singleOpenBrace.length > 0) {
    errors.push(`Found ${singleOpenBrace.length} single '{' character(s) - did you mean '{{'?`);
  }
  
  if (singleCloseBrace && singleCloseBrace.length > 0) {
    errors.push(`Found ${singleCloseBrace.length} single '}' character(s) - did you mean '}}'?`);
  }

  return errors;
}

/**
 * Lambda handler for saving report template
 * PUT /settings/report-template
 */
export const handler = async (event: any): Promise<any> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'SaveTemplateFunction invoked', {
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

    const body: SaveTemplateRequest = JSON.parse(event.body);

    // Validate required fields
    if (!body.templateName || typeof body.templateName !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'templateName is required and must be a string',
        retryable: false,
      });
    }

    if (!body.templateContent || typeof body.templateContent !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'templateContent is required and must be a string',
        retryable: false,
      });
    }

    // Validate template size
    const templateSize = Buffer.byteLength(body.templateContent, 'utf8');
    if (templateSize > MAX_TEMPLATE_SIZE) {
      return createErrorResponse(400, {
        code: 'TEMPLATE_TOO_LARGE',
        message: `Template size (${templateSize} bytes) exceeds maximum allowed size (${MAX_TEMPLATE_SIZE} bytes)`,
        retryable: false,
      });
    }

    // Validate template syntax
    const validationErrors = validateTemplateSyntax(body.templateContent);
    
    if (validationErrors.length > 0) {
      logWithContext(correlationId, 'WARN', 'Template validation failed', {
        userId,
        errors: validationErrors,
      });

      return createSuccessResponse({
        templateId: null,
        validationErrors,
      });
    }

    const now = Date.now();
    const templateId = 'default'; // Use 'default' for user's primary template

    logWithContext(correlationId, 'INFO', 'Saving report template', {
      userId,
      templateId,
      templateSize,
    });

    const putCommand = new PutCommand({
      TableName: REPORT_TEMPLATES_TABLE,
      Item: {
        userId,
        templateId,
        templateName: body.templateName,
        templateContent: body.templateContent,
        createdAt: now,
        updatedAt: now,
      },
    });

    await docClient.send(putCommand);

    logWithContext(correlationId, 'INFO', 'Report template saved successfully', {
      userId,
      templateId,
    });

    return createSuccessResponse({
      templateId,
      validationErrors: [],
    });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'SaveTemplateFunction failed', {
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
      code: 'SAVE_TEMPLATE_FAILED',
      message: 'Failed to save template',
      details: error.message,
      retryable: true,
    });
  }
};
