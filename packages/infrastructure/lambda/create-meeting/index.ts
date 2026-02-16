import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { CreateMeetingRequest, CreateMeetingResponse } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const PRESIGNED_URL_EXPIRATION = 900; // 15 minutes

// Supported audio formats
const SUPPORTED_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'CreateMeeting invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);
    
    logWithContext(correlationId, 'INFO', 'User authenticated', { userId });

    // Parse and validate request body
    if (!event.body) {
      logWithContext(correlationId, 'ERROR', 'Missing request body');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Request body is required',
        retryable: false,
      });
    }

    let requestBody: CreateMeetingRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      logWithContext(correlationId, 'ERROR', 'Invalid JSON in request body', { error });
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON',
        retryable: false,
      });
    }

    // Validate required fields
    const { fileName, fileSize, contentType } = requestBody;
    
    if (!fileName || typeof fileName !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'fileName is required and must be a string',
        retryable: false,
      });
    }

    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'fileSize is required and must be a positive number',
        retryable: false,
      });
    }

    if (!contentType || typeof contentType !== 'string') {
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'contentType is required and must be a string',
        retryable: false,
      });
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return createErrorResponse(400, {
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)} GB`,
        retryable: false,
      });
    }

    // Validate content type
    if (!SUPPORTED_CONTENT_TYPES.includes(contentType.toLowerCase())) {
      return createErrorResponse(400, {
        code: 'UNSUPPORTED_FORMAT',
        message: 'Audio format not supported',
        details: `Supported formats: ${SUPPORTED_CONTENT_TYPES.join(', ')}`,
        retryable: false,
      });
    }

    // Generate unique meeting ID
    const meetingId = randomUUID();
    const audioFileKey = `uploads/${userId}/${meetingId}/${fileName}`;
    const createdAt = Date.now();

    logWithContext(correlationId, 'INFO', 'Creating meeting record', {
      meetingId,
      userId,
      fileName,
      fileSize,
    });

    // Create meeting record in DynamoDB
    const putCommand = new PutCommand({
      TableName: MEETINGS_TABLE,
      Item: {
        userId,
        meetingId,
        audioFileKey,
        audioFileName: fileName,
        status: 'uploading',
        createdAt,
      },
      ConditionExpression: 'attribute_not_exists(meetingId)',
    });

    try {
      await docClient.send(putCommand);
      logWithContext(correlationId, 'INFO', 'Meeting record created successfully', {
        meetingId,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to create meeting record', {
        error: error.message,
        meetingId,
      });
      
      if (error.name === 'ConditionalCheckFailedException') {
        return createErrorResponse(409, {
          code: 'MEETING_ALREADY_EXISTS',
          message: 'Meeting with this ID already exists',
          retryable: true,
        });
      }
      
      throw error;
    }

    // Generate pre-signed S3 URL for upload
    logWithContext(correlationId, 'INFO', 'Generating pre-signed URL', {
      bucket: AUDIO_BUCKET,
      key: audioFileKey,
    });

    const putObjectCommand = new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: audioFileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, putObjectCommand, {
      expiresIn: PRESIGNED_URL_EXPIRATION,
    });

    logWithContext(correlationId, 'INFO', 'Pre-signed URL generated successfully', {
      meetingId,
      expiresIn: PRESIGNED_URL_EXPIRATION,
    });

    // Return response
    const response: CreateMeetingResponse = {
      meetingId,
      uploadUrl,
      expiresIn: PRESIGNED_URL_EXPIRATION,
    };

    logWithContext(correlationId, 'INFO', 'CreateMeeting completed successfully', {
      meetingId,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in CreateMeeting', {
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
