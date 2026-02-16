import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { MeetingAnalysis } from '@meeting-platform/shared';
import { MeetingItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;

/**
 * Lambda handler for GET /meetings/{id}/analysis
 * Retrieves meeting analysis from DynamoDB
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'GetAnalysis invoked', {
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

    logWithContext(correlationId, 'INFO', 'Retrieving meeting analysis', {
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

    const meetingItem = result.Item as MeetingItem;

    logWithContext(correlationId, 'INFO', 'Meeting retrieved', {
      meetingId,
      status: meetingItem.status,
      hasAnalysis: !!meetingItem.analysisMarkdown,
    });

    // Check if analysis exists
    if (!meetingItem.analysisMarkdown || !meetingItem.analysisGeneratedAt) {
      logWithContext(correlationId, 'ERROR', 'Analysis not found for meeting', {
        meetingId,
        status: meetingItem.status,
      });

      return createErrorResponse(404, {
        code: 'ANALYSIS_NOT_FOUND',
        message: 'Analysis has not been generated for this meeting yet',
        retryable: meetingItem.status === 'analyzing',
      });
    }

    // Build response
    const response: MeetingAnalysis = {
      meetingId: meetingItem.meetingId,
      markdown: meetingItem.analysisMarkdown,
      generatedAt: meetingItem.analysisGeneratedAt,
    };

    logWithContext(correlationId, 'INFO', 'GetAnalysis completed successfully', {
      meetingId,
      analysisLength: response.markdown.length,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in GetAnalysis', {
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
