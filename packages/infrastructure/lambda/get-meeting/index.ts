import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { Meeting } from '@meeting-platform/shared';
import { MeetingItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const PRESIGNED_URL_EXPIRATION = 3600; // 1 hour for playback

/**
 * Lambda handler for GET /meetings/{id}
 * Retrieves meeting details and generates pre-signed URL for audio playback
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'GetMeeting invoked', {
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

    logWithContext(correlationId, 'INFO', 'Retrieving meeting', {
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
      audioFileKey: meetingItem.audioFileKey,
    });

    // Generate pre-signed URL for audio playback if audio file exists
    let audioUrl: string | undefined;
    
    if (meetingItem.audioFileKey && meetingItem.status !== 'uploading') {
      logWithContext(correlationId, 'INFO', 'Generating pre-signed URL for audio playback', {
        bucket: AUDIO_BUCKET,
        key: meetingItem.audioFileKey,
      });

      const getObjectCommand = new GetObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: meetingItem.audioFileKey,
      });

      try {
        audioUrl = await getSignedUrl(s3Client, getObjectCommand, {
          expiresIn: PRESIGNED_URL_EXPIRATION,
        });
        
        logWithContext(correlationId, 'INFO', 'Pre-signed URL generated successfully', {
          meetingId,
          expiresIn: PRESIGNED_URL_EXPIRATION,
        });
      } catch (error: any) {
        logWithContext(correlationId, 'WARN', 'Failed to generate pre-signed URL', {
          error: error.message,
          meetingId,
        });
        // Continue without audio URL - meeting data is still valid
      }
    }

    // Build response
    const response: Meeting = {
      meetingId: meetingItem.meetingId,
      userId: meetingItem.userId,
      fileName: meetingItem.audioFileName,
      duration: meetingItem.audioDuration,
      status: meetingItem.status,
      createdAt: meetingItem.createdAt,
      audioUrl,
      analysisTokenUsage: meetingItem.analysisTokenUsage,
      reportTokenUsage: meetingItem.reportTokenUsage,
      errorMessage: meetingItem.errorMessage,
    };

    logWithContext(correlationId, 'INFO', 'GetMeeting completed successfully', {
      meetingId,
      hasAudioUrl: !!audioUrl,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in GetMeeting', {
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
