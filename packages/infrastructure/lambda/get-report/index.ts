import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { MeetingReportItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MEETING_REPORTS_TABLE = process.env.MEETING_REPORTS_TABLE!;

/**
 * Lambda handler for GET /meetings/{id}/report
 * Retrieves generated meeting report
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'GetReport invoked', {
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

    logWithContext(correlationId, 'INFO', 'Retrieving report', {
      meetingId,
      userId,
    });

    // Retrieve report from DynamoDB
    const getCommand = new GetCommand({
      TableName: MEETING_REPORTS_TABLE,
      Key: {
        meetingId,
        reportId: 'latest',
      },
    });

    const result = await docClient.send(getCommand);

    if (!result.Item) {
      logWithContext(correlationId, 'ERROR', 'Report not found', {
        meetingId,
      });
      
      return createErrorResponse(404, {
        code: 'REPORT_NOT_FOUND',
        message: 'Report not found for this meeting',
        retryable: false,
      });
    }

    const reportItem = result.Item as MeetingReportItem;
    
    // Verify the report belongs to the requesting user
    if (reportItem.userId !== userId) {
      logWithContext(correlationId, 'ERROR', 'Unauthorized access attempt', {
        meetingId,
        requestingUserId: userId,
        reportUserId: reportItem.userId,
      });
      
      return createErrorResponse(403, {
        code: 'FORBIDDEN',
        message: 'You do not have access to this report',
        retryable: false,
      });
    }
    
    logWithContext(correlationId, 'INFO', 'Report retrieved', {
      meetingId,
      reportId: reportItem.reportId,
      status: reportItem.status,
    });

    // Build response with edit metadata
    // Only include edit metadata fields if they exist
    const placeholdersWithMetadata: Record<string, any> = {};
    Object.entries(reportItem.extractedData.placeholders).forEach(([name, placeholder]) => {
      const placeholderData: any = {
        value: placeholder.value,
        citation: placeholder.citation,
        isFilled: placeholder.isFilled,
      };
      
      // Only include edit metadata if it exists
      if (placeholder.isManuallyEdited !== undefined) {
        placeholderData.isManuallyEdited = placeholder.isManuallyEdited;
      }
      if (placeholder.lastEditedAt !== undefined) {
        placeholderData.lastEditedAt = placeholder.lastEditedAt;
      }
      if (placeholder.originalValue !== undefined) {
        placeholderData.originalValue = placeholder.originalValue;
      }
      
      placeholdersWithMetadata[name] = placeholderData;
    });

    const response = {
      report: {
        meetingId: reportItem.meetingId,
        reportId: reportItem.reportId,
        templateId: reportItem.templateId,
        reportContent: reportItem.reportContent,
        placeholders: placeholdersWithMetadata,
        agendaPoints: reportItem.extractedData.agendaPoints,
        generatedAt: reportItem.generatedAt,
        status: reportItem.status,
        errorMessage: reportItem.errorMessage,
      },
    };

    logWithContext(correlationId, 'INFO', 'GetReport completed successfully', {
      meetingId,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in GetReport', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: error.message,
      retryable: true,
    });
  }
};
