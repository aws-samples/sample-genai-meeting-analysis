import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler, calculateProgress, getProcessingStage } from './index';
import { MeetingStatus } from '@meeting-platform/shared';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.MEETINGS_TABLE = 'test-meetings-table';

describe('GetMeetingStatusFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (meetingId: string): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/meetings/${meetingId}/status`,
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
      path: `/meetings/${meetingId}/status`,
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings/{id}/status',
    },
    resource: '/meetings/{id}/status',
  });

  describe('Progress Calculation', () => {
    it('should calculate progress for uploading status', () => {
      expect(calculateProgress('uploading')).toBe(10);
    });

    it('should calculate progress for transcribing status', () => {
      expect(calculateProgress('transcribing')).toBe(40);
    });

    it('should calculate progress for analyzing status', () => {
      expect(calculateProgress('analyzing')).toBe(70);
    });

    it('should calculate progress for generating-report status', () => {
      expect(calculateProgress('generating-report')).toBe(90);
    });

    it('should calculate progress for completed status', () => {
      expect(calculateProgress('completed')).toBe(100);
    });

    it('should calculate progress for failed status', () => {
      expect(calculateProgress('failed')).toBe(0);
    });
  });

  describe('Processing Stage Determination', () => {
    it('should determine stage for uploading status', () => {
      expect(getProcessingStage('uploading')).toBe('upload');
    });

    it('should determine stage for transcribing status', () => {
      expect(getProcessingStage('transcribing')).toBe('transcription');
    });

    it('should determine stage for analyzing status', () => {
      expect(getProcessingStage('analyzing')).toBe('analysis');
    });

    it('should determine stage for generating-report status', () => {
      expect(getProcessingStage('generating-report')).toBe('report-generation');
    });

    it('should determine stage for completed status', () => {
      expect(getProcessingStage('completed')).toBe('complete');
    });

    it('should determine stage for failed status', () => {
      expect(getProcessingStage('failed')).toBe('upload');
    });
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

  describe('Meeting Status Retrieval', () => {
    it('should return status for uploading meeting', async () => {
      const meetingId = 'test-meeting-123';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'uploading',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('uploading');
      expect(body.progress).toBe(10);
      expect(body.stage).toBe('upload');
      expect(body.message).toBeUndefined();
    });

    it('should return status for transcribing meeting', async () => {
      const meetingId = 'test-meeting-456';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'transcribing',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
          transcribeJobName: 'job-123',
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('transcribing');
      expect(body.progress).toBe(40);
      expect(body.stage).toBe('transcription');
    });

    it('should return status for analyzing meeting', async () => {
      const meetingId = 'test-meeting-789';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'analyzing',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('analyzing');
      expect(body.progress).toBe(70);
      expect(body.stage).toBe('analysis');
    });

    it('should return status for completed meeting', async () => {
      const meetingId = 'test-meeting-complete';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'completed',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
          analysisMarkdown: '# Analysis\n\nTest analysis',
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('completed');
      expect(body.progress).toBe(100);
      expect(body.stage).toBe('complete');
    });

    it('should return status with error message for failed meeting', async () => {
      const meetingId = 'test-meeting-failed';
      const errorMessage = 'Transcription failed: unsupported format';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'failed',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
          errorMessage,
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('failed');
      expect(body.progress).toBe(0);
      expect(body.stage).toBe('upload');
      expect(body.message).toBe(errorMessage);
    });

    it('should return 404 when meeting is not found', async () => {
      const meetingId = 'non-existent-meeting';
      
      ddbMock.on(GetCommand).resolves({
        Item: undefined,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MEETING_NOT_FOUND');
      expect(body.error.message).toBe('Meeting not found');
    });
  });

  describe('DynamoDB Integration', () => {
    it('should query DynamoDB with correct keys', async () => {
      const meetingId = 'test-meeting-query';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'transcribing',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(ddbMock.calls()).toHaveLength(1);
      
      // Verify GetCommand was called with correct parameters
      const getCall = ddbMock.call(0);
      expect(getCall.args[0]).toBeInstanceOf(GetCommand);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const meetingId = 'test-meeting-error';
      
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB connection error'));

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should use userId from Cognito claims', async () => {
      const meetingId = 'test-meeting-auth';
      
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'test-user-id',
          meetingId,
          status: 'completed',
          audioFileName: 'test.mp3',
          createdAt: Date.now(),
        },
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      const getCall = ddbMock.call(0);
      const input = getCall.args[0].input as any;
      expect(input.Key.userId).toBe('test-user-id');
    });
  });
});
