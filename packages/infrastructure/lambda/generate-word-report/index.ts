/**
 * GenerateWordReportFunction - Generates bilingual Word documents from templates
 * 
 * This Lambda function:
 * 1. Fetches WordTemplateConfig from DynamoDB
 * 2. Fetches the .docx template from S3
 * 3. Fetches MeetingReport from DynamoDB (reuses extracted placeholder values)
 * 4. Filters placeholders with translateEnabled=true
 * 5. Calls Bedrock to translate selected placeholders
 * 6. Builds data object with original + translated values
 * 7. Merges template with docxtemplater
 * 8. Stores generated document in S3
 * 9. Updates MeetingReport with wordReport reference
 * 
 * **Validates: Requirements 4.1, 4.2, 5.1, 5.2, 6.1, 7.1**
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { 
  filterTranslatablePlaceholders, 
  translateWithBedrock, 
  buildDataObject 
} from '../shared/translation-utils';
import { mergeTemplate } from '../shared/merge-utils';
import { 
  WordTemplateConfigItem, 
  MeetingReportItem,
  WordReportReference 
} from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({});

const WORD_TEMPLATES_BUCKET = process.env.WORD_TEMPLATES_BUCKET!;
const WORD_TEMPLATE_CONFIG_TABLE = process.env.WORD_TEMPLATE_CONFIG_TABLE!;
const MEETING_REPORTS_TABLE = process.env.MEETING_REPORTS_TABLE!;
const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const GENERATED_REPORTS_BUCKET = process.env.GENERATED_REPORTS_BUCKET!;
const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * Response for successful Word report generation
 */
interface GenerateWordReportResponse {
  documentKey: string;
  downloadUrl: string;
  generatedAt: number;
  translationTokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Fetches WordTemplateConfig from DynamoDB
 */
async function getWordTemplateConfig(
  userId: string,
  correlationId: string
): Promise<WordTemplateConfigItem | null> {
  logWithContext(correlationId, 'INFO', 'Fetching Word template config', { userId });

  const getCommand = new GetCommand({
    TableName: WORD_TEMPLATE_CONFIG_TABLE,
    Key: {
      userId,
      templateId: 'default',
    },
  });

  const result = await docClient.send(getCommand);
  return result.Item as WordTemplateConfigItem | null;
}

/**
 * Fetches MeetingReport from DynamoDB
 */
async function getMeetingReport(
  meetingId: string,
  correlationId: string
): Promise<MeetingReportItem | null> {
  logWithContext(correlationId, 'INFO', 'Fetching meeting report', { meetingId });

  const getCommand = new GetCommand({
    TableName: MEETING_REPORTS_TABLE,
    Key: {
      meetingId,
      reportId: 'latest',
    },
  });

  const result = await docClient.send(getCommand);
  return result.Item as MeetingReportItem | null;
}

/**
 * Fetches template file from S3
 */
async function getTemplateFromS3(
  templateS3Key: string,
  correlationId: string
): Promise<Buffer> {
  logWithContext(correlationId, 'INFO', 'Fetching template from S3', { templateS3Key });

  const getCommand = new GetObjectCommand({
    Bucket: WORD_TEMPLATES_BUCKET,
    Key: templateS3Key,
  });

  const response = await s3Client.send(getCommand);
  
  if (!response.Body) {
    throw new Error('Template file body is empty');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks);
}

/**
 * Stores generated Word document in S3
 */
async function storeGeneratedDocument(
  documentBuffer: Buffer,
  documentKey: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Storing generated document in S3', { 
    documentKey,
    documentSize: documentBuffer.length,
  });

  const putCommand = new PutObjectCommand({
    Bucket: GENERATED_REPORTS_BUCKET,
    Key: documentKey,
    Body: documentBuffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  await s3Client.send(putCommand);
}

/**
 * Generates presigned URL for document download
 */
async function generateDownloadUrl(
  documentKey: string,
  correlationId: string
): Promise<string> {
  logWithContext(correlationId, 'INFO', 'Generating presigned URL', { documentKey });

  const getCommand = new GetObjectCommand({
    Bucket: GENERATED_REPORTS_BUCKET,
    Key: documentKey,
  });

  return getSignedUrl(s3Client, getCommand, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });
}

/**
 * Updates MeetingReport with wordReport reference
 */
async function updateMeetingReportWithWordReport(
  meetingId: string,
  wordReport: WordReportReference,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Updating meeting report with Word report reference', {
    meetingId,
    documentS3Key: wordReport.documentS3Key,
  });

  const updateCommand = new UpdateCommand({
    TableName: MEETING_REPORTS_TABLE,
    Key: {
      meetingId,
      reportId: 'latest',
    },
    UpdateExpression: 'SET wordReport = :wordReport',
    ExpressionAttributeValues: {
      ':wordReport': wordReport,
    },
  });

  await docClient.send(updateCommand);
}

/**
 * Updates meeting status to completed (final step in workflow)
 */
async function updateMeetingStatusToCompleted(
  userId: string,
  meetingId: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Updating meeting status to completed', {
    meetingId,
  });

  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'completed',
    },
  });

  await docClient.send(updateCommand);

  logWithContext(correlationId, 'INFO', 'Meeting status updated to completed', {
    meetingId,
  });
}

/**
 * Generates the S3 key for the generated Word document
 * Format: word-reports/{userId}/{meetingId}/{timestamp}.docx
 */
function generateDocumentKey(
  userId: string,
  meetingId: string,
  timestamp: number
): string {
  const isoTimestamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  return `word-reports/${userId}/${meetingId}/word-report-${meetingId}-${isoTimestamp}.docx`;
}

/**
 * Extracts placeholder values from MeetingReport's extractedData
 * Returns a flat object with placeholder names and their string values
 * 
 * **Validates: Requirements 7.1**
 */
export function extractPlaceholderValues(
  extractedData: MeetingReportItem['extractedData'] | undefined
): Record<string, string> {
  const values: Record<string, string> = {};

  // Handle case where extractedData might be undefined or malformed
  if (!extractedData || !extractedData.placeholders) {
    return values;
  }

  for (const [name, placeholder] of Object.entries(extractedData.placeholders)) {
    // Ensure we always have a string value, never undefined
    values[name] = placeholder?.value ?? '';
  }

  // Also add formatted agenda_points if present
  if (extractedData.agendaPoints && extractedData.agendaPoints.length > 0) {
    const formattedAgenda = extractedData.agendaPoints
      .map((item, index) => `${index + 1}. ${item.point ?? ''}\n   Decision: ${item.decision ?? ''}`)
      .join('\n\n');
    values['agenda_points'] = formattedAgenda;
  }

  return values;
}

/**
 * Step Functions response type
 */
interface StepFunctionsResponse {
  statusCode: number;
  documentKey?: string;
  meetingId?: string;
  generatedAt?: number;
}

/**
 * Lambda handler for generating Word reports
 * Supports both API Gateway (POST /meetings/{id}/word-report) and Step Functions invocation
 */
export const handler = async (
  event: APIGatewayProxyEvent | { meetingId: string; userId: string; correlationId?: string }
): Promise<APIGatewayProxyResult | StepFunctionsResponse> => {
  // Detect if this is an API Gateway event or direct invocation (Step Functions)
  const isApiGatewayEvent = 'requestContext' in event && 'pathParameters' in event;
  
  let correlationId: string;
  let userId: string;
  let meetingId: string;

  if (isApiGatewayEvent) {
    const apiEvent = event as APIGatewayProxyEvent;
    correlationId = generateCorrelationId();

    logWithContext(correlationId, 'INFO', 'GenerateWordReportFunction invoked via API Gateway', {
      path: apiEvent.path,
      httpMethod: apiEvent.httpMethod,
    });

    try {
      // Extract userId from Cognito claims
      userId = getUserIdFromEvent(apiEvent);

      // Extract meetingId from path parameters
      const pathMeetingId = apiEvent.pathParameters?.id;

      if (!pathMeetingId) {
        logWithContext(correlationId, 'ERROR', 'Missing meetingId in path parameters');
        return createErrorResponse(400, {
          code: 'INVALID_REQUEST',
          message: 'Meeting ID is required',
          retryable: false,
        });
      }
      meetingId = pathMeetingId;
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to parse API Gateway request', {
        error: error.message,
      });
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: error.message,
        retryable: false,
      });
    }
  } else {
    // Direct invocation from Step Functions
    const directEvent = event as { meetingId: string; userId: string; correlationId?: string };
    correlationId = directEvent.correlationId || generateCorrelationId();
    meetingId = directEvent.meetingId;
    userId = directEvent.userId;

    logWithContext(correlationId, 'INFO', 'GenerateWordReportFunction invoked via Step Functions', {
      meetingId,
      userId,
    });
  }

  logWithContext(correlationId, 'INFO', 'Processing Word report generation', {
    userId,
    meetingId,
  });

  try {
    // Step 1: Fetch WordTemplateConfig from DynamoDB
    const templateConfig = await getWordTemplateConfig(userId, correlationId);

    if (!templateConfig) {
      logWithContext(correlationId, 'ERROR', 'Word template not configured', { userId });
      return createErrorResponse(404, {
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Word template not configured. Please upload a template first.',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Word template config retrieved', {
      templateId: templateConfig.templateId,
      sourceLanguage: templateConfig.sourceLanguage,
      targetLanguage: templateConfig.targetLanguage,
      placeholderCount: templateConfig.placeholders.length,
    });

    // Step 2: Fetch MeetingReport from DynamoDB (reuse extracted data)
    const meetingReport = await getMeetingReport(meetingId, correlationId);

    if (!meetingReport) {
      logWithContext(correlationId, 'ERROR', 'Meeting report not found', { meetingId });
      return createErrorResponse(404, {
        code: 'REPORT_NOT_FOUND',
        message: 'Meeting report not found. Generate the markdown report first.',
        retryable: false,
      });
    }

    // Verify the report belongs to the requesting user
    if (meetingReport.userId !== userId) {
      logWithContext(correlationId, 'ERROR', 'Unauthorized access attempt', {
        meetingId,
        requestingUserId: userId,
        reportUserId: meetingReport.userId,
      });
      return createErrorResponse(403, {
        code: 'FORBIDDEN',
        message: 'You do not have access to this meeting report',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Meeting report retrieved', {
      meetingId,
      reportStatus: meetingReport.status,
      placeholderCount: Object.keys(meetingReport.extractedData.placeholders).length,
    });

    // Step 3: Fetch template from S3
    const templateBuffer = await getTemplateFromS3(
      templateConfig.templateS3Key,
      correlationId
    );

    logWithContext(correlationId, 'INFO', 'Template fetched from S3', {
      templateSize: templateBuffer.length,
    });

    // Step 4: Extract placeholder values from MeetingReport (reuse data)
    // **Validates: Requirements 7.1**
    const extractedValues = extractPlaceholderValues(meetingReport.extractedData);

    logWithContext(correlationId, 'INFO', 'Placeholder values extracted from meeting report', {
      extractedCount: Object.keys(extractedValues).length,
      extractedKeys: Object.keys(extractedValues),
      hasAgendaPoints: 'agenda_points' in extractedValues,
      agendaPointsLength: meetingReport.extractedData?.agendaPoints?.length ?? 0,
    });

    // Step 5: Filter placeholders with translateEnabled=true
    const translatablePlaceholders = filterTranslatablePlaceholders(
      templateConfig.placeholders,
      extractedValues
    );

    logWithContext(correlationId, 'INFO', 'Translatable placeholders filtered', {
      translatableCount: Object.keys(translatablePlaceholders).length,
      translatableKeys: Object.keys(translatablePlaceholders),
      templatePlaceholders: templateConfig.placeholders.map(p => ({ name: p.name, translateEnabled: p.translateEnabled })),
    });

    // Step 6: Call Bedrock to translate selected placeholders
    const translationResult = await translateWithBedrock(
      bedrockClient,
      translatablePlaceholders,
      {
        sourceLanguage: templateConfig.sourceLanguage,
        targetLanguage: templateConfig.targetLanguage,
        correlationId,
      }
    );

    logWithContext(correlationId, 'INFO', 'Translation completed', {
      translatedCount: Object.keys(translationResult.translatedValues).length,
      inputTokens: translationResult.tokenUsage.inputTokens,
      outputTokens: translationResult.tokenUsage.outputTokens,
    });

    // Step 7: Build data object with original + translated values
    const mergeData = buildDataObject(extractedValues, translationResult.translatedValues);

    logWithContext(correlationId, 'INFO', 'Merge data object built', {
      totalKeys: Object.keys(mergeData).length,
    });

    // Step 8: Merge template with docxtemplater
    const mergeResult = mergeTemplate(templateBuffer, mergeData);

    if (!mergeResult.success || !mergeResult.documentBuffer) {
      logWithContext(correlationId, 'ERROR', 'Template merge failed', {
        error: mergeResult.error,
      });
      return createErrorResponse(500, {
        code: 'MERGE_FAILED',
        message: 'Failed to generate document. Please check your template for errors.',
        details: mergeResult.error,
        retryable: true,
      });
    }

    logWithContext(correlationId, 'INFO', 'Template merged successfully', {
      outputSize: mergeResult.documentBuffer.length,
    });

    // Step 9: Store generated document in S3
    const generatedAt = Date.now();
    const documentKey = generateDocumentKey(userId, meetingId, generatedAt);

    await storeGeneratedDocument(
      mergeResult.documentBuffer,
      documentKey,
      correlationId
    );

    // Step 10: Generate presigned URL for download
    const downloadUrl = await generateDownloadUrl(documentKey, correlationId);

    // Step 11: Update MeetingReport with wordReport reference
    const wordReport: WordReportReference = {
      documentS3Key: documentKey,
      generatedAt,
      templateId: templateConfig.templateId,
      translationTokenUsage: translationResult.tokenUsage.inputTokens > 0 
        ? translationResult.tokenUsage 
        : undefined,
    };

    await updateMeetingReportWithWordReport(meetingId, wordReport, correlationId);

    // Step 12: Update meeting status to completed (final step in workflow)
    await updateMeetingStatusToCompleted(userId, meetingId, correlationId);

    logWithContext(correlationId, 'INFO', 'GenerateWordReportFunction completed successfully', {
      meetingId,
      documentKey,
      generatedAt,
    });

    // Return appropriate response based on invocation type
    if (isApiGatewayEvent) {
      const response: GenerateWordReportResponse = {
        documentKey,
        downloadUrl,
        generatedAt,
        translationTokenUsage: wordReport.translationTokenUsage,
      };
      return createSuccessResponse(response);
    }

    // Return response for Step Functions
    return {
      statusCode: 200,
      documentKey,
      meetingId,
      generatedAt,
    };
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GenerateWordReportFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    if (isApiGatewayEvent) {
      return createErrorResponse(500, {
        code: 'GENERATE_WORD_REPORT_FAILED',
        message: 'Failed to generate Word report',
        details: error.message,
        retryable: true,
      });
    }

    // For Step Functions, throw the error so it can be retried
    throw error;
  }
};
