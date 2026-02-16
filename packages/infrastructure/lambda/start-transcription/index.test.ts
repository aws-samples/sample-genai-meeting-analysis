// Mock environment variables BEFORE importing handler
process.env.MEETINGS_TABLE = 'test-meetings-table';
process.env.AUDIO_BUCKET = 'test-audio-bucket';
process.env.AWS_REGION = 'us-east-1';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { handler } from './index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const transcribeMock = mockClient(TranscribeClient);

describe('StartTranscriptionFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    transcribeMock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (meetingId: string): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/meetings/${meetingId}/start-transcription`,
    pathParameters: {
      id: meetingId,
    },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        claims: {
          sub: 'test-user-id',
          email: 'test@example.com',
        },
      },
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
      path: `/meetings/${meetingId}/start-transcription`,
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings/{id}/start-transcription',
    },
    resource: '/meetings/{id}/start-transcription',
  });

  const mockMeetingItem = {
    userId: 'test-user-id',
    meetingId: 'test-meeting-id',
    audioFileKey: 'uploads/test-user-id/test-meeting-id/meeting.mp3',
    audioFileName: 'meeting.mp3',
    status: 'uploading',
    createdAt: Date.now(),
  };

  describe('Request Validation', () => {
    it('should return 400 when meetingId is missing', async () => {
      const event = createMockEvent('');
      event.pathParameters = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Meeting ID is required');
    });

    it('should return 404 when meeting does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});

      const event = createMockEvent('non-existent-meeting');

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MEETING_NOT_FOUND');
    });

    it('should return 400 when meeting status is not uploading', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          ...mockMeetingItem,
          status: 'transcribing',
        },
      });

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_STATUS');
      expect(body.error.message).toContain('transcribing');
    });
  });

  describe('S3 File Verification', () => {
    it('should verify audio file exists in S3', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 1024,
        ContentType: 'audio/mpeg',
      });
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(s3Mock.calls()).toHaveLength(1);
      
      const headCall = s3Mock.commandCalls(HeadObjectCommand)[0];
      expect(headCall.args[0].input.Bucket).toBe('test-audio-bucket');
      expect(headCall.args[0].input.Key).toBe('uploads/test-user-id/test-meeting-id/meeting.mp3');
    });

    it('should return 404 when audio file does not exist in S3', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      
      const notFoundError: any = new Error('Not Found');
      notFoundError.name = 'NotFound';
      notFoundError.$metadata = { httpStatusCode: 404 };
      s3Mock.on(HeadObjectCommand).rejects(notFoundError);

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUDIO_FILE_NOT_FOUND');
      expect(body.error.retryable).toBe(true);
    });
  });

  describe('Transcribe Job Creation', () => {
    it('should start transcription job with correct configuration', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'meeting-test-meeting-id-123456',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(transcribeMock.calls()).toHaveLength(1);
      
      const transcribeCall = transcribeMock.call(0);
      const input = transcribeCall.args[0].input as any;
      
      expect(input.TranscriptionJobName).toContain('meeting-test-meeting-id');
      expect(input.Media.MediaFileUri).toBe('s3://test-audio-bucket/uploads/test-user-id/test-meeting-id/meeting.mp3');
      expect(input.OutputBucketName).toBe('test-audio-bucket');
      expect(input.OutputKey).toBe('transcribe-output/test-meeting-id/');
      expect(input.Settings.ShowSpeakerLabels).toBe(true);
      expect(input.Settings.MaxSpeakerLabels).toBe(10);
      expect(input.LanguageCode).toBe('ro-RO');
    });

    it('should handle Transcribe BadRequestException', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      
      const badRequestError: any = new Error('Invalid audio format');
      badRequestError.name = 'BadRequestException';
      transcribeMock.on(StartTranscriptionJobCommand).rejects(badRequestError);

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('TRANSCRIPTION_FAILED');
      expect(body.error.retryable).toBe(false);
    });

    it('should handle Transcribe LimitExceededException', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      
      const limitError: any = new Error('Too many requests');
      limitError.name = 'LimitExceededException';
      transcribeMock.on(StartTranscriptionJobCommand).rejects(limitError);

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(429);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.retryable).toBe(true);
    });
  });

  describe('DynamoDB Status Update', () => {
    it('should update meeting status to transcribing', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-name',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(ddbMock.calls()).toHaveLength(2); // GetCommand + UpdateCommand
      
      const updateCall = ddbMock.calls().find(call => {
        const input = call.args[0].input as any;
        return input.UpdateExpression !== undefined;
      });
      expect(updateCall).toBeDefined();
      
      const input = updateCall!.args[0].input as any;
      expect(input.Key).toEqual({
        userId: 'test-user-id',
        meetingId: 'test-meeting-id',
      });
      expect(input.UpdateExpression).toContain('status');
      expect(input.UpdateExpression).toContain('transcribeJobName');
      expect(input.ExpressionAttributeValues[':status']).toBe('transcribing');
      expect(input.ExpressionAttributeValues[':jobName']).toContain('meeting-test-meeting-id');
    });

    it('should succeed even if status update fails after Transcribe job starts', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-name',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB update failed'));

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      // Should still return success since Transcribe job started
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.transcriptionJobName).toContain('meeting-test-meeting-id');
      expect(body.status).toBe('transcribing');
    });
  });

  describe('Response Format', () => {
    it('should return correct response format on success', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'meeting-test-123',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toBeDefined();
      expect(result.headers!['Content-Type']).toBe('application/json');
      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
      
      const body = JSON.parse(result.body);
      expect(body.transcriptionJobName).toBeDefined();
      expect(body.status).toBe('transcribing');
    });
  });

  describe('Authentication', () => {
    it('should extract userId from Cognito claims', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockMeetingItem });
      s3Mock.on(HeadObjectCommand).resolves({});
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      const getCall = ddbMock.call(0);
      const getInput = getCall.args[0].input as any;
      expect(getInput.Key.userId).toBe('test-user-id');
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      ddbMock.on(GetCommand).rejects(new Error('Unexpected error'));

      const event = createMockEvent('test-meeting-id');

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });
  });
});
