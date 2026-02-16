import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.TRANSCRIPT_SEGMENTS_TABLE = 'test-transcript-segments-table';

describe('GetTranscriptFunction', () => {
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
    path: `/meetings/${meetingId}/transcript`,
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
      path: `/meetings/${meetingId}/transcript`,
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings/{id}/transcript',
    },
    resource: '/meetings/{id}/transcript',
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
    it('should retrieve transcript segments successfully', async () => {
      const meetingId = 'test-meeting-123';
      const mockSegments = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          speakerName: 'John Doe',
          text: 'Hello everyone, welcome to the meeting.',
          languageCode: 'en-US',
          confidence: 0.98,
        },
        {
          meetingId,
          startTime: 5000,
          endTime: 10000,
          speakerLabel: 'spk_1',
          speakerName: 'Jane Smith',
          text: 'Thank you for having me.',
          languageCode: 'en-US',
          confidence: 0.95,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments).toHaveLength(2);
      expect(body.segments[0]).toEqual({
        startTime: 0,
        endTime: 5000,
        speakerLabel: 'spk_0',
        speakerName: 'John Doe',
        text: 'Hello everyone, welcome to the meeting.',
        languageCode: 'en-US',
        confidence: 0.98,
        words: [],
      });
      expect(body.segments[1]).toEqual({
        startTime: 5000,
        endTime: 10000,
        speakerLabel: 'spk_1',
        speakerName: 'Jane Smith',
        text: 'Thank you for having me.',
        languageCode: 'en-US',
        confidence: 0.95,
        words: [],
      });
    });

    it('should return empty array when no segments found', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createMockEvent('meeting-no-segments');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments).toEqual([]);
    });

    it('should query DynamoDB with correct parameters', async () => {
      const meetingId = 'test-meeting-456';
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createMockEvent(meetingId);
      await handler(event);

      expect(ddbMock.calls()).toHaveLength(1);
      const queryCall = ddbMock.call(0);
      const input = queryCall.args[0].input as any;
      expect(input.KeyConditionExpression).toBe('meetingId = :meetingId');
      expect(input.ExpressionAttributeValues).toEqual({
        ':meetingId': meetingId,
      });
    });

    it('should handle pagination correctly', async () => {
      const meetingId = 'test-meeting-paginated';
      const firstBatch = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          text: 'First segment',
          languageCode: 'en-US',
          confidence: 0.98,
        },
      ];
      const secondBatch = [
        {
          meetingId,
          startTime: 5000,
          endTime: 10000,
          speakerLabel: 'spk_1',
          text: 'Second segment',
          languageCode: 'en-US',
          confidence: 0.95,
        },
      ];

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: firstBatch,
          LastEvaluatedKey: { meetingId, startTime: 5000 },
        })
        .resolvesOnce({
          Items: secondBatch,
        });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments).toHaveLength(2);
      expect(ddbMock.calls()).toHaveLength(2);
    });
  });

  describe('Language Detection', () => {
    it('should include language codes in transcript segments', async () => {
      const meetingId = 'test-meeting-multilingual';
      const mockSegments = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          text: 'Hello everyone.',
          languageCode: 'en-US',
          confidence: 0.98,
        },
        {
          meetingId,
          startTime: 5000,
          endTime: 10000,
          speakerLabel: 'spk_1',
          text: 'Hola a todos.',
          languageCode: 'es-ES',
          confidence: 0.96,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments[0].languageCode).toBe('en-US');
      expect(body.segments[1].languageCode).toBe('es-ES');
    });
  });

  describe('Speaker Information', () => {
    it('should include speaker labels and names', async () => {
      const meetingId = 'test-meeting-speakers';
      const mockSegments = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          speakerName: 'Alice Johnson',
          text: 'I agree with the proposal.',
          languageCode: 'en-US',
          confidence: 0.97,
        },
        {
          meetingId,
          startTime: 5000,
          endTime: 10000,
          speakerLabel: 'spk_1',
          text: 'Let me add to that.',
          languageCode: 'en-US',
          confidence: 0.94,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments[0].speakerLabel).toBe('spk_0');
      expect(body.segments[0].speakerName).toBe('Alice Johnson');
      expect(body.segments[1].speakerLabel).toBe('spk_1');
      expect(body.segments[1].speakerName).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('DynamoDB error'));

      const event = createMockEvent('test-meeting-error');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should authenticate user from Cognito claims', async () => {
      const meetingId = 'test-meeting-auth';
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createMockEvent(meetingId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // User authentication is verified by getUserIdFromEvent
      // If it fails, it would throw an error before reaching DynamoDB
    });
  });
});
