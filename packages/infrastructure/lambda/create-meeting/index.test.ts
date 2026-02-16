import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

// Mock getSignedUrl
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://test-bucket.s3.amazonaws.com/presigned-url'),
}));

// Mock environment variables
process.env.MEETINGS_TABLE = 'test-meetings-table';
process.env.AUDIO_BUCKET = 'test-audio-bucket';

describe('CreateMeetingFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/meetings',
    pathParameters: null,
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
      path: '/meetings',
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings',
    },
    resource: '/meetings',
  });

  describe('Request Validation', () => {
    it('should return 400 when request body is missing', async () => {
      const event = createMockEvent(null);
      event.body = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Request body is required');
    });

    it('should return 400 when request body is invalid JSON', async () => {
      const event = createMockEvent(null);
      event.body = 'invalid json';

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Request body must be valid JSON');
    });

    it('should return 400 when fileName is missing', async () => {
      const event = createMockEvent({
        fileSize: 1000,
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('fileName');
    });

    it('should return 400 when fileSize is missing', async () => {
      const event = createMockEvent({
        fileName: 'test.mp3',
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('fileSize');
    });

    it('should return 400 when contentType is missing', async () => {
      const event = createMockEvent({
        fileName: 'test.mp3',
        fileSize: 1000,
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('contentType');
    });

    it('should return 400 when file size exceeds maximum', async () => {
      const event = createMockEvent({
        fileName: 'test.mp3',
        fileSize: 6 * 1024 * 1024 * 1024, // 6 GB
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('should return 400 when content type is not supported', async () => {
      const event = createMockEvent({
        fileName: 'test.txt',
        fileSize: 1000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('UNSUPPORTED_FORMAT');
    });
  });

  describe('S3 URL Generation', () => {
    it('should generate pre-signed URL for valid request', async () => {
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent({
        fileName: 'meeting.mp3',
        fileSize: 1024 * 1024, // 1 MB
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.meetingId).toBeDefined();
      expect(body.uploadUrl).toBe('https://test-bucket.s3.amazonaws.com/presigned-url');
      expect(body.expiresIn).toBe(900);
    });

    it('should accept various audio formats', async () => {
      ddbMock.on(PutCommand).resolves({});

      const formats = [
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/mp4',
        'audio/m4a',
        'audio/x-m4a',
        'audio/flac',
      ];

      for (const contentType of formats) {
        const event = createMockEvent({
          fileName: `test.${contentType.split('/')[1]}`,
          fileSize: 1024,
          contentType,
        });

        const result = await handler(event);
        expect(result.statusCode).toBe(200);
      }
    });
  });

  describe('DynamoDB Integration', () => {
    it('should create meeting record with correct attributes', async () => {
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent({
        fileName: 'board-meeting.mp3',
        fileSize: 2048,
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(ddbMock.calls()).toHaveLength(1);
      
      const putCall = ddbMock.call(0);
      const input = putCall.args[0].input as any;
      expect(input.Item).toMatchObject({
        userId: 'test-user-id',
        meetingId: expect.any(String),
        audioFileName: 'board-meeting.mp3',
        status: 'uploading',
        createdAt: expect.any(Number),
        audioFileKey: expect.stringContaining('uploads/test-user-id/'),
      });
    });

    it('should handle DynamoDB errors gracefully', async () => {
      ddbMock.on(PutCommand).rejects(new Error('DynamoDB error'));

      const event = createMockEvent({
        fileName: 'test.mp3',
        fileSize: 1024,
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Authentication', () => {
    it('should extract userId from Cognito claims', async () => {
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent({
        fileName: 'test.mp3',
        fileSize: 1024,
        contentType: 'audio/mpeg',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      const putCall = ddbMock.call(0);
      const item = (putCall.args[0].input as any).Item;
      expect(item.userId).toBe('test-user-id');
    });
  });
});
