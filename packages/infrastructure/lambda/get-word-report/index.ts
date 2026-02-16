/**
 * GetWordReportFunction - Retrieves presigned URL for downloading generated Word documents
 * 
 * This Lambda function:
 * 1. Retrieves wordReport reference from MeetingReport in DynamoDB
 * 2. Generates a presigned URL for downloading the document from S3
 * 3. Returns the URL with filename and generation timestamp
 * 
 * **Validates: Requirements 6.2, 6.3**
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { MeetingReportItem, WordReportReference } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const MEETING_REPORTS_TABLE = process.env.MEETING_REPORTS_TABLE!;
const GENERATED_REPORTS_BUCKET = process.env.GENERATED_REPORTS_BUCKET!;
const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * Extended MeetingReportItem with optional wordReport field
 */
interface MeetingReportItemWithWordReport extends MeetingReportItem {
  wordReport?: WordReportReference;
}

/**
 * Response for successful Word report retrieval
 */
export interface GetWordReportResponse {
  downloadUrl: string;
  filename: string;
  generatedAt: number;
}

/**
 * Extracts filename from S3 key
 * S3 key format: word-reports/{userId}/{meetingId}/word-report-{meetingId}-{timestamp}.docx
 * 
 * **Validates: Requirements 6.3**
 */
export function extractFilename(documentS3Key: string): string {
  const parts = documentS3Key.split('/');
  return parts[parts.length - 1];
}

/**
 * Fetches MeetingReport from DynamoDB
 */
async function getMeetingReport(
  meetingId: string,
  correlationId: string
): Promise<MeetingReportItemWithWordReport | null> {
  logWithContext(correlationId, 'INFO', 'Fetching meeting report', { meetingId });

  const getCommand = new GetCommand({
    TableName: MEETING_REPORTS_TABLE,
    Key: {
      meetingId,
      reportId: 'latest',
    },
  });

  const result = await docClient.send(getCommand);
  return result.Item as MeetingReportItemWithWordReport | null;
}

/**
 * Verifies that the document exists in S3
 */
async function verifyDocumentExists(
  documentS3Key: string,
  correlationId: string
): Promise<boolean> {
  logWithContext(correlationId, 'INFO', 'Verifying document exists in S3', { documentS3Key });

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: GENERATED_REPORTS_BUCKET,
      Key: documentS3Key,
    });

    await s3Client.send(headCommand);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Generates presigned URL for document download
 */
async function generateDownloadUrl(
  documentS3Key: string,
  filename: string,
  correlationId: string
): Promise<string> {
  logWithContext(correlationId, 'INFO', 'Generating presigned URL', { documentS3Key });

  const getCommand = new GetObjectCommand({
    Bucket: GENERATED_REPORTS_BUCKET,
    Key: documentS3Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  return getSignedUrl(s3Client, getCommand, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });
}

/**
 * Lambda handler for retrieving Word report download URL
 * GET /meetings/{id}/word-report
 * 
 * **Validates: Requirements 6.2, 6.3**
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'GetWordReportFunction invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);

    logWithContext(correlationId, 'INFO', 'User authenticated', { userId });

    // Extract meetingId from path parameters
    const meetingId = event.pathParameters?.id;

    if (!meetingId) {
      logWithContext(correlationId, 'ERROR', 'Missing meetingId in path parameters');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Meeting ID is required',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Retrieving Word report', {
      userId,
      meetingId,
    });

    // Step 1: Fetch MeetingReport from DynamoDB
    const meetingReport = await getMeetingReport(meetingId, correlationId);

    if (!meetingReport) {
      logWithContext(correlationId, 'ERROR', 'Meeting report not found', { meetingId });
      return createErrorResponse(404, {
        code: 'REPORT_NOT_FOUND',
        message: 'Meeting report not found',
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

    // Step 2: Check if Word report exists
    if (!meetingReport.wordReport) {
      logWithContext(correlationId, 'ERROR', 'Word report not generated', { meetingId });
      return createErrorResponse(404, {
        code: 'WORD_REPORT_NOT_FOUND',
        message: 'Word report has not been generated for this meeting. Generate the Word report first.',
        retryable: false,
      });
    }

    const { documentS3Key, generatedAt } = meetingReport.wordReport;

    logWithContext(correlationId, 'INFO', 'Word report reference found', {
      documentS3Key,
      generatedAt,
    });

    // Step 3: Verify document exists in S3
    const documentExists = await verifyDocumentExists(documentS3Key, correlationId);

    if (!documentExists) {
      logWithContext(correlationId, 'ERROR', 'Word report document not found in S3', {
        documentS3Key,
      });
      return createErrorResponse(404, {
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Word report document not found. Please regenerate the report.',
        retryable: false,
      });
    }

    // Step 4: Extract filename from S3 key
    const filename = extractFilename(documentS3Key);

    logWithContext(correlationId, 'INFO', 'Filename extracted', { filename });

    // Step 5: Generate presigned URL for download
    const downloadUrl = await generateDownloadUrl(documentS3Key, filename, correlationId);

    logWithContext(correlationId, 'INFO', 'GetWordReportFunction completed successfully', {
      meetingId,
      filename,
      generatedAt,
    });

    const response: GetWordReportResponse = {
      downloadUrl,
      filename,
      generatedAt,
    };

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GetWordReportFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'GET_WORD_REPORT_FAILED',
      message: 'Failed to retrieve Word report',
      details: error.message,
      retryable: true,
    });
  }
};
