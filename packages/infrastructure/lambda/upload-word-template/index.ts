import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { validateDocxFile, extractPlaceholders } from '../shared/docx-utils';
import { PlaceholderConfig, SUPPORTED_LANGUAGES, LanguageCode } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const WORD_TEMPLATES_BUCKET = process.env.WORD_TEMPLATES_BUCKET!;
const WORD_TEMPLATE_CONFIG_TABLE = process.env.WORD_TEMPLATE_CONFIG_TABLE!;
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Request body for uploading a Word template
 */
interface UploadWordTemplateRequest {
  templateName: string;
  fileContent: string; // Base64 encoded .docx
  sourceLanguage: string;
  targetLanguage: string;
}

/**
 * Response for successful template upload
 */
interface UploadWordTemplateResponse {
  templateId: string;
  placeholders: string[];
  message: string;
}

/**
 * Validates that a language code is supported
 */
function isValidLanguageCode(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some(lang => lang.code === code);
}

/**
 * Lambda handler for uploading Word template
 * PUT /settings/word-template
 */
export const handler = async (event: any): Promise<any> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'UploadWordTemplateFunction invoked', {
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

    const body: UploadWordTemplateRequest = JSON.parse(event.body);

    // Validate required fields
    if (!body.templateName || typeof body.templateName !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'templateName is required and must be a string',
        retryable: false,
      });
    }

    if (!body.fileContent || typeof body.fileContent !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'fileContent is required and must be a base64 encoded string',
        retryable: false,
      });
    }

    if (!body.sourceLanguage || typeof body.sourceLanguage !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'sourceLanguage is required and must be a string',
        retryable: false,
      });
    }

    if (!body.targetLanguage || typeof body.targetLanguage !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'targetLanguage is required and must be a string',
        retryable: false,
      });
    }

    // Validate language codes
    if (!isValidLanguageCode(body.sourceLanguage)) {
      return createErrorResponse(400, {
        code: 'INVALID_LANGUAGE',
        message: `Invalid sourceLanguage: ${body.sourceLanguage}. Supported languages: ${SUPPORTED_LANGUAGES.map(l => l.code).join(', ')}`,
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

    // Decode base64 file content
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(body.fileContent, 'base64');
    } catch (error) {
      return createErrorResponse(400, {
        code: 'INVALID_FILE',
        message: 'Invalid base64 encoding for fileContent',
        retryable: false,
      });
    }

    // Validate file size
    if (fileBuffer.length > MAX_TEMPLATE_SIZE) {
      return createErrorResponse(400, {
        code: 'FILE_TOO_LARGE',
        message: `File size (${fileBuffer.length} bytes) exceeds maximum allowed size (${MAX_TEMPLATE_SIZE} bytes)`,
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Validating DOCX file', {
      userId,
      fileSize: fileBuffer.length,
    });

    // Validate .docx file structure
    const validationResult = await validateDocxFile(fileBuffer);
    if (!validationResult.isValid) {
      logWithContext(correlationId, 'WARN', 'DOCX validation failed', {
        userId,
        error: validationResult.error,
      });

      return createErrorResponse(400, {
        code: 'INVALID_DOCX',
        message: validationResult.error || 'Invalid Word document',
        retryable: false,
      });
    }

    // Extract placeholders from template
    const extractionResult = await extractPlaceholders(fileBuffer);
    if (!extractionResult.success) {
      logWithContext(correlationId, 'WARN', 'Placeholder extraction failed', {
        userId,
        error: extractionResult.error,
      });

      return createErrorResponse(400, {
        code: 'EXTRACTION_FAILED',
        message: extractionResult.error || 'Failed to extract placeholders from template',
        retryable: false,
      });
    }

    const placeholders = extractionResult.placeholders;
    logWithContext(correlationId, 'INFO', 'Placeholders extracted', {
      userId,
      placeholderCount: placeholders.length,
      placeholders,
    });

    const now = Date.now();
    const templateId = 'default'; // Use 'default' for user's primary template
    const templateS3Key = `word-templates/${userId}/${templateId}.docx`;

    // Store template in S3
    logWithContext(correlationId, 'INFO', 'Storing template in S3', {
      userId,
      templateS3Key,
    });

    await s3Client.send(new PutObjectCommand({
      Bucket: WORD_TEMPLATES_BUCKET,
      Key: templateS3Key,
      Body: fileBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    // Create placeholder configs with default translateEnabled=false
    const placeholderConfigs: PlaceholderConfig[] = placeholders.map(name => ({
      name,
      translateEnabled: false,
    }));

    // Store config in DynamoDB
    logWithContext(correlationId, 'INFO', 'Storing template config in DynamoDB', {
      userId,
      templateId,
    });

    await docClient.send(new PutCommand({
      TableName: WORD_TEMPLATE_CONFIG_TABLE,
      Item: {
        userId,
        templateId,
        templateName: body.templateName,
        templateS3Key,
        sourceLanguage: body.sourceLanguage,
        targetLanguage: body.targetLanguage,
        placeholders: placeholderConfigs,
        createdAt: now,
        updatedAt: now,
      },
    }));

    logWithContext(correlationId, 'INFO', 'Word template uploaded successfully', {
      userId,
      templateId,
      placeholderCount: placeholders.length,
    });

    const response: UploadWordTemplateResponse = {
      templateId,
      placeholders,
      message: placeholders.length > 0
        ? `Template uploaded successfully with ${placeholders.length} placeholder(s) found`
        : 'Template uploaded successfully. No placeholders found in template. Add placeholders using {{name}} syntax.',
    };

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'UploadWordTemplateFunction failed', {
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
      code: 'UPLOAD_TEMPLATE_FAILED',
      message: 'Failed to upload template',
      details: error.message,
      retryable: true,
    });
  }
};
