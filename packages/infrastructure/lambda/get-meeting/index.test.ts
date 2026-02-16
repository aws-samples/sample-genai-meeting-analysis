import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

// Mock getSignedUrl
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://test-bucket.s3.amazonaws.com/audio-playback-url'),
}));

// Mock environment variables
process.env.MEETINGS_TABLE = 'test-meetings-table';
process.env.AUDIO_BUCKET = 'test-audio-bucket';

describe('GetMeetingFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (meetingId: string): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/meetings/${meetingId}`,
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
      httpMethod: 'GET',
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
      path: `/meetings/${meetingId}`,
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings/{id}',
    },
    resource: '/meetings/{id}',
  });

  describe('Request Validation', () => {
    it('should return 400 when meetingId is missing', async () => {
      const event = createMockEvent('test-meeting-id');
      event.pathParameters = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Meeting ID is required');
    });
  });

  describe('Data Retrieval', () => {
    it('should retrieve meeting details successfully', async () => {
      const meetingId = 'test-meeting-123';
      const mockMeeting = {
        userId: 'test-user-id',
        meetingId,
        audioFileName: 'board-meeting.mp3',
        audioFileKey: 'uploads/test-user-id/test-meeting-123/board-meeting.mp3',
        audioDuration: 3600,
        status: 'completed',
        createdAt: 1234567890,
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockMeeting,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.meetingId).toBe(meetingId);
      expect(body.userId).toBe('test-user-id');
      expect(body.fileName).toBe('board-meeting.mp3');
      expect(body.duration).toBe(3600);
      expect(body.status).toBe('completed');
      expect(body.createdAt).toBe(1234567890);
    });

    it('should return 404 when meeting is not found', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: undefined,
      });

      const event = createMockEvent('non-existent-meeting');
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MEETING_NOT_FOUND');
      expect(body.error.message).toBe('Meeting not found');
    });

    it('should query DynamoDB with correct keys', async () => {
      const meetingId = 'test-meeting-456';
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          audioFileName: 'test.mp3',
          audioFileKey: 'uploads/test-user-id/test-meeting-456/test.mp3',
          status: 'completed',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      await handler(event);

      expect(ddbMock.calls()).toHaveLength(1);
      const getCall = ddbMock.call(0);
      const input = getCall.args[0].input as any;
      expect(input.Key).toEqual({
        userId: 'test-user-id',
        meetingId,
      });
    });
  });

  describe('Pre-signed URL Generation', () => {
    it('should generate pre-signed URL for audio playback', async () => {
      const meetingId = 'test-meeting-789';
      const mockMeeting = {
        userId: 'test-user-id',
        meetingId,
        audioFileName: 'meeting.mp3',
        audioFileKey: 'uploads/test-user-id/test-meeting-789/meeting.mp3',
        status: 'completed',
        createdAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockMeeting,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.audioUrl).toBe('https://test-bucket.s3.amazonaws.com/audio-playback-url');
    });

    it('should not generate URL when status is uploading', async () => {
      const meetingId = 'test-meeting-uploading';
      const mockMeeting = {
        userId: 'test-user-id',
        meetingId,
        audioFileName: 'meeting.mp3',
        audioFileKey: 'uploads/test-user-id/test-meeting-uploading/meeting.mp3',
        status: 'uploading',
        createdAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockMeeting,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.audioUrl).toBeUndefined();
    });

    it('should handle missing audioFileKey gracefully', async () => {
      const meetingId = 'test-meeting-no-audio';
      const mockMeeting = {
        userId: 'test-user-id',
        meetingId,
        audioFileName: 'meeting.mp3',
        status: 'failed',
        createdAt: Date.now(),
        errorMessage: 'Upload failed',
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockMeeting,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.audioUrl).toBeUndefined();
      expect(body.errorMessage).toBe('Upload failed');
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const event = createMockEvent('test-meeting-error');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });

    it('should continue without audioUrl if S3 URL generation fails', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      getSignedUrl.mockRejectedValueOnce(new Error('S3 error'));

      const meetingId = 'test-meeting-s3-error';
      const mockMeeting = {
        userId: 'test-user-id',
        meetingId,
        audioFileName: 'meeting.mp3',
        audioFileKey: 'uploads/test-user-id/test-meeting-s3-error/meeting.mp3',
        status: 'completed',
        createdAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockMeeting,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.meetingId).toBe(meetingId);
      expect(body.audioUrl).toBeUndefined();
    });
  });

  describe('Authentication', () => {
    it('should use userId from Cognito claims', async () => {
      const meetingId = 'test-meeting-auth';
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          audioFileName: 'test.mp3',
          audioFileKey: 'uploads/test-user-id/test-meeting-auth/test.mp3',
          status: 'completed',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      await handler(event);

      const getCall = ddbMock.call(0);
      const input = getCall.args[0].input as any;
      expect(input.Key.userId).toBe('test-user-id');
    });
  });
});
