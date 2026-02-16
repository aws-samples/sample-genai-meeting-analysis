import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { ProcessingStatus, MeetingStatus, ProcessingStage } from '@meeting-platform/shared';
import { MeetingItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;

/**
 * Calculate progress percentage based on meeting status
 */
export function calculateProgress(status: MeetingStatus): number {
  switch (status) {
    case 'uploading':
      return 10;
    case 'transcribing':
      return 40;
    case 'analyzing':
      return 70;
    case 'generating-report':
      return 90;
    case 'completed':
      return 100;
    case 'failed':
      return 0;
    default:
      return 0;
  }
}

/**
 * Determine processing stage from meeting status
 */
export function getProcessingStage(status: MeetingStatus): ProcessingStage {
  switch (status) {
    case 'uploading':
      return 'upload';
    case 'transcribing':
      return 'transcription';
    case 'analyzing':
      return 'analysis';
    case 'generating-report':
      return 'report-generation';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'upload'; // Default to upload stage for failed
    default:
      return 'upload';
  }
}

/**
 * Lambda handler for GET /meetings/{id}/status
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'GetMeetingStatus invoked', {
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

    logWithContext(correlationId, 'INFO', 'Retrieving meeting status', {
      meetingId,
      userId,
    });

    // Retrieve meeting from DynamoDB
    const getCommand = new GetCommand({
      TableName: MEETINGS_TABLE,
      Key: {
        userId,
        meetingId,
      },
    });

    const result = await docClient.send(getCommand);

    if (!result.Item) {
      logWithContext(correlationId, 'ERROR', 'Meeting not found', {
        meetingId,
        userId,
      });
      
      return createErrorResponse(404, {
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found',
        retryable: false,
      });
    }

    const meeting = result.Item as MeetingItem;
    
    logWithContext(correlationId, 'INFO', 'Meeting retrieved', {
      meetingId,
      status: meeting.status,
      reportStatus: meeting.reportStatus,
    });

    // Calculate progress and stage
    const progress = calculateProgress(meeting.status);
    const stage = getProcessingStage(meeting.status);

    // Build response
    const response: ProcessingStatus = {
      status: meeting.status,
      progress,
      stage,
      message: meeting.errorMessage,
    };

    logWithContext(correlationId, 'INFO', 'GetMeetingStatus completed successfully', {
      meetingId,
      status: meeting.status,
      reportStatus: meeting.reportStatus,
      progress,
      stage,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in GetMeetingStatus', {
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
