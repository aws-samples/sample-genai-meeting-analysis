import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { TranscriptSegment, UpdateSpeakersRequest } from '@meeting-platform/shared';
import { TranscriptSegmentItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TRANSCRIPT_SEGMENTS_TABLE = process.env.TRANSCRIPT_SEGMENTS_TABLE!;
const BATCH_WRITE_SIZE = 25; // DynamoDB batch write limit

/**
 * Lambda handler for PUT /meetings/{id}/speakers
 * Updates speaker names across all transcript segments for a meeting
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'UpdateSpeakers invoked', {
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

    // Parse request body
    if (!event.body) {
      logWithContext(correlationId, 'ERROR', 'Missing request body');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Request body is required',
        retryable: false,
      });
    }

    let requestBody: UpdateSpeakersRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Invalid JSON in request body', {
        error: error.message,
      });
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Invalid JSON in request body',
        retryable: false,
      });
    }

    // Validate speaker mappings
    if (!requestBody.speakerMappings || typeof requestBody.speakerMappings !== 'object') {
      logWithContext(correlationId, 'ERROR', 'Invalid speakerMappings format');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'speakerMappings must be an object',
        retryable: false,
      });
    }

    const speakerMappings = requestBody.speakerMappings;
    const speakerLabels = Object.keys(speakerMappings);

    if (speakerLabels.length === 0) {
      logWithContext(correlationId, 'ERROR', 'Empty speakerMappings');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'speakerMappings cannot be empty',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Updating speaker names', {
      meetingId,
      speakerCount: speakerLabels.length,
      speakerMappings,
    });

    // Retrieve all transcript segments for this meeting
    const segments: TranscriptSegmentItem[] = [];
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
        segments.push(...(result.Items as TranscriptSegmentItem[]));
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (segments.length === 0) {
      logWithContext(correlationId, 'WARN', 'No transcript segments found', {
        meetingId,
      });
      return createErrorResponse(404, {
        code: 'TRANSCRIPT_NOT_FOUND',
        message: 'No transcript segments found for this meeting',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Retrieved transcript segments', {
      meetingId,
      segmentCount: segments.length,
    });

    // Update speaker names in segments
    const updatedSegments: TranscriptSegmentItem[] = segments.map((segment) => {
      const newSpeakerName = speakerMappings[segment.speakerLabel];
      if (newSpeakerName !== undefined) {
        return {
          ...segment,
          speakerName: newSpeakerName,
        };
      }
      return segment;
    });

    // Count how many segments were actually updated
    const updatedCount = updatedSegments.filter((segment, index) => 
      segment.speakerName !== segments[index].speakerName
    ).length;

    logWithContext(correlationId, 'INFO', 'Prepared segment updates', {
      meetingId,
      totalSegments: segments.length,
      updatedSegments: updatedCount,
    });

    // Batch write updated segments back to DynamoDB
    await batchWriteSegments(updatedSegments, correlationId);

    logWithContext(correlationId, 'INFO', 'Speaker names updated successfully', {
      meetingId,
      updatedSegments: updatedCount,
    });

    // Return updated transcript
    const responseSegments: TranscriptSegment[] = updatedSegments.map((item) => ({
      startTime: item.startTime,
      endTime: item.endTime,
      speakerLabel: item.speakerLabel,
      speakerName: item.speakerName,
      text: item.text,
      languageCode: item.languageCode,
      confidence: item.confidence,
      words: item.words || [], // Include word-level data
    }));

    logWithContext(correlationId, 'INFO', 'UpdateSpeakers completed successfully', {
      meetingId,
      segmentCount: responseSegments.length,
    });

    return createSuccessResponse({ segments: responseSegments });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in UpdateSpeakers', {
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

/**
 * Helper function to batch write segments to DynamoDB
 * Handles batching in groups of 25 (DynamoDB limit)
 */
async function batchWriteSegments(
  segments: TranscriptSegmentItem[],
  correlationId: string
): Promise<void> {
  const batches: TranscriptSegmentItem[][] = [];
  
  // Split segments into batches of 25
  for (let i = 0; i < segments.length; i += BATCH_WRITE_SIZE) {
    batches.push(segments.slice(i, i + BATCH_WRITE_SIZE));
  }

  logWithContext(correlationId, 'INFO', 'Starting batch writes', {
    totalSegments: segments.length,
    batchCount: batches.length,
  });

  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    const writeRequests = batch.map((segment) => ({
      PutRequest: {
        Item: segment,
      },
    }));

    const batchWriteCommand = new BatchWriteCommand({
      RequestItems: {
        [TRANSCRIPT_SEGMENTS_TABLE]: writeRequests,
      },
    });

    try {
      const result = await docClient.send(batchWriteCommand);
      
      // Handle unprocessed items (retry logic)
      if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
        logWithContext(correlationId, 'WARN', 'Unprocessed items in batch write', {
          batchIndex: i,
          unprocessedCount: result.UnprocessedItems[TRANSCRIPT_SEGMENTS_TABLE]?.length || 0,
        });
        
        // Retry unprocessed items once
        const retryCommand = new BatchWriteCommand({
          RequestItems: result.UnprocessedItems,
        });
        
        await docClient.send(retryCommand);
      }

      logWithContext(correlationId, 'INFO', 'Batch write completed', {
        batchIndex: i + 1,
        totalBatches: batches.length,
        itemsWritten: batch.length,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Batch write failed', {
        batchIndex: i,
        error: error.message,
      });
      throw error;
    }
  }

  logWithContext(correlationId, 'INFO', 'All batch writes completed successfully', {
    totalSegments: segments.length,
  });
}
