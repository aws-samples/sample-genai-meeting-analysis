import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, StartTranscriptionJobCommand, LanguageCode } from '@aws-sdk/client-transcribe';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { StartTranscriptionResponse } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const transcribeClient = new TranscribeClient({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'StartTranscription invoked', {
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
      logWithContext(correlationId, 'ERROR', 'Missing meetingId in path');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Meeting ID is required',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Processing transcription request', {
      meetingId,
      userId,
    });

    // Retrieve meeting record from DynamoDB
    const getCommand = new GetCommand({
      TableName: MEETINGS_TABLE,
      Key: {
        userId,
        meetingId,
      },
    });

    const getResult = await docClient.send(getCommand);
    
    if (!getResult.Item) {
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

    const meeting = getResult.Item;
    const audioFileKey = meeting.audioFileKey;

    logWithContext(correlationId, 'INFO', 'Meeting record retrieved', {
      meetingId,
      audioFileKey,
      currentStatus: meeting.status,
    });

    // Verify meeting is in correct status
    if (meeting.status !== 'uploading') {
      logWithContext(correlationId, 'ERROR', 'Invalid meeting status', {
        meetingId,
        currentStatus: meeting.status,
      });
      return createErrorResponse(400, {
        code: 'INVALID_STATUS',
        message: `Cannot start transcription for meeting in status: ${meeting.status}`,
        retryable: false,
      });
    }

    // Verify audio file exists in S3
    logWithContext(correlationId, 'INFO', 'Verifying audio file exists in S3', {
      bucket: AUDIO_BUCKET,
      key: audioFileKey,
    });

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: audioFileKey,
      });
      
      await s3Client.send(headCommand);
      
      logWithContext(correlationId, 'INFO', 'Audio file verified in S3', {
        audioFileKey,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Audio file not found in S3', {
        audioFileKey,
        error: error.message,
      });
      
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return createErrorResponse(404, {
          code: 'AUDIO_FILE_NOT_FOUND',
          message: 'Audio file not found in storage',
          details: 'Please ensure the file was uploaded successfully',
          retryable: true,
        });
      }
      
      throw error;
    }

    // Generate unique transcription job name
    const transcriptionJobName = `meeting-${meetingId}-${Date.now()}`;
    const outputKey = `transcribe-output/${meetingId}/`;

    logWithContext(correlationId, 'INFO', 'Starting Amazon Transcribe job', {
      transcriptionJobName,
      audioFileKey,
      outputKey,
    });

    // Start Amazon Transcribe job with diarization and language detection
    const startTranscribeCommand = new StartTranscriptionJobCommand({
      TranscriptionJobName: transcriptionJobName,
      Media: {
        MediaFileUri: `s3://${AUDIO_BUCKET}/${audioFileKey}`,
      },
      OutputBucketName: AUDIO_BUCKET,
      OutputKey: outputKey,
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 10,
      },
      // no multiple languages identification, use romanian for my demo
      LanguageCode: LanguageCode.RO_RO
    });

    try {
      const transcribeResult = await transcribeClient.send(startTranscribeCommand);
      
      logWithContext(correlationId, 'INFO', 'Transcribe job started successfully', {
        transcriptionJobName,
        jobStatus: transcribeResult.TranscriptionJob?.TranscriptionJobStatus,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to start Transcribe job', {
        error: error.message,
        transcriptionJobName,
      });
      
      if (error.name === 'BadRequestException') {
        return createErrorResponse(400, {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Failed to start transcription',
          details: error.message,
          retryable: false,
        });
      }
      
      if (error.name === 'LimitExceededException') {
        return createErrorResponse(429, {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many transcription requests',
          details: 'Please try again later',
          retryable: true,
        });
      }
      
      throw error;
    }

    // Update meeting status to "transcribing" in DynamoDB
    logWithContext(correlationId, 'INFO', 'Updating meeting status to transcribing', {
      meetingId,
    });

    const updateCommand = new UpdateCommand({
      TableName: MEETINGS_TABLE,
      Key: {
        userId,
        meetingId,
      },
      UpdateExpression: 'SET #status = :status, transcribeJobName = :jobName',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'transcribing',
        ':jobName': transcriptionJobName,
      },
      ConditionExpression: 'attribute_exists(meetingId)',
    });

    try {
      await docClient.send(updateCommand);
      
      logWithContext(correlationId, 'INFO', 'Meeting status updated successfully', {
        meetingId,
        newStatus: 'transcribing',
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to update meeting status', {
        error: error.message,
        meetingId,
      });
      
      // Transcribe job is already started, so we log but don't fail the request
      logWithContext(correlationId, 'WARN', 'Transcribe job started but status update failed', {
        transcriptionJobName,
      });
    }

    // Return response
    const response: StartTranscriptionResponse = {
      transcriptionJobName,
      status: 'transcribing',
    };

    logWithContext(correlationId, 'INFO', 'StartTranscription completed successfully', {
      meetingId,
      transcriptionJobName,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in StartTranscription', {
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
