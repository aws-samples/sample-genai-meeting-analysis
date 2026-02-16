import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { TranscriptSegment } from '@meeting-platform/shared';
import { TranscriptSegmentItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TRANSCRIPT_SEGMENTS_TABLE = process.env.TRANSCRIPT_SEGMENTS_TABLE!;

/**
 * Lambda handler for GET /meetings/{id}/transcript
 * Retrieves all transcript segments with speaker labels and language codes
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'GetTranscript invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims (for authorization)
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

    logWithContext(correlationId, 'INFO', 'Retrieving transcript segments', {
      meetingId,
      userId,
    });

    // Query all transcript segments for this meeting
    // Segments are ordered by startTime (sort key)
    const segments: TranscriptSegment[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const queryCommand = new QueryCommand({
        TableName: TRANSCRIPT_SEGMENTS_TABLE,
        KeyConditionExpression: 'meetingId = :meetingId',
        ExpressionAttributeValues: {
          ':meetingId': meetingId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const result = await docClient.send(queryCommand);

      if (result.Items && result.Items.length > 0) {
        const items = result.Items as TranscriptSegmentItem[];
        
        // Transform DynamoDB items to API response format
        const transformedSegments = items.map((item) => ({
          startTime: item.startTime,
          endTime: item.endTime,
          speakerLabel: item.speakerLabel,
          speakerName: item.speakerName,
          text: item.text,
          languageCode: item.languageCode,
          confidence: item.confidence,
          words: item.words || [], // Include word-level data
        }));

        segments.push(...transformedSegments);
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    logWithContext(correlationId, 'INFO', 'Transcript segments retrieved', {
      meetingId,
      segmentCount: segments.length,
    });

    // Return empty array if no segments found (not an error - transcription may not be complete)
    if (segments.length === 0) {
      logWithContext(correlationId, 'INFO', 'No transcript segments found', {
        meetingId,
      });
    }

    logWithContext(correlationId, 'INFO', 'GetTranscript completed successfully', {
      meetingId,
      segmentCount: segments.length,
    });

    return createSuccessResponse({ segments });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in GetTranscript', {
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
