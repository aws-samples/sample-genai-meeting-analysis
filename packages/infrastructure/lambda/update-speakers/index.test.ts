import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './index';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.TRANSCRIPT_SEGMENTS_TABLE = 'test-transcript-segments-table';

describe('UpdateSpeakersFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (
    meetingId: string,
    speakerMappings: Record<string, string>
  ): APIGatewayProxyEvent => ({
    body: JSON.stringify({ speakerMappings }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'PUT',
    isBase64Encoded: false,
    path: `/meetings/${meetingId}/speakers`,
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
      httpMethod: 'PUT',
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
      path: `/meetings/${meetingId}/speakers`,
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/meetings/{id}/speakers',
    },
    resource: '/meetings/{id}/speakers',
  });

  describe('Request Validation', () => {
    it('should return 400 when meetingId is missing', async () => {
      const event = createMockEvent('test-meeting-id', { spk_0: 'John Doe' });
      event.pathParameters = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Meeting ID is required');
    });

    it('should return 400 when request body is missing', async () => {
      const event = createMockEvent('test-meeting-id', { spk_0: 'John Doe' });
      event.body = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Request body is required');
    });

    it('should return 400 when request body is invalid JSON', async () => {
      const event = createMockEvent('test-meeting-id', { spk_0: 'John Doe' });
      event.body = 'invalid json{';

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid JSON in request body');
    });

    it('should return 400 when speakerMappings is missing', async () => {
      const event = createMockEvent('test-meeting-id', { spk_0: 'John Doe' });
      event.body = JSON.stringify({});

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('speakerMappings must be an object');
    });

    it('should return 400 when speakerMappings is empty', async () => {
      const event = createMockEvent('test-meeting-id', {});

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('speakerMappings cannot be empty');
    });
  });

  describe('Speaker Name Updates', () => {
    it('should update speaker names across all segments', async () => {
      const meetingId = 'test-meeting-123';
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
          text: 'Thank you.',
          languageCode: 'en-US',
          confidence: 0.95,
        },
        {
          meetingId,
          startTime: 10000,
          endTime: 15000,
          speakerLabel: 'spk_0',
          text: 'Let me continue.',
          languageCode: 'en-US',
          confidence: 0.97,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'John Doe',
        spk_1: 'Jane Smith',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments).toHaveLength(3);
      expect(body.segments[0].speakerName).toBe('John Doe');
      expect(body.segments[1].speakerName).toBe('Jane Smith');
      expect(body.segments[2].speakerName).toBe('John Doe');
    });

    it('should update only specified speakers', async () => {
      const meetingId = 'test-meeting-456';
      const mockSegments = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          speakerName: 'Old Name',
          text: 'Hello.',
          languageCode: 'en-US',
          confidence: 0.98,
        },
        {
          meetingId,
          startTime: 5000,
          endTime: 10000,
          speakerLabel: 'spk_1',
          text: 'Hi there.',
          languageCode: 'en-US',
          confidence: 0.95,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'John Doe',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments[0].speakerName).toBe('John Doe');
      expect(body.segments[1].speakerName).toBeUndefined();
    });

    it('should preserve existing data while updating speaker names', async () => {
      const meetingId = 'test-meeting-789';
      const mockSegments = [
        {
          meetingId,
          startTime: 1000,
          endTime: 6000,
          speakerLabel: 'spk_0',
          text: 'Important meeting content.',
          languageCode: 'en-US',
          confidence: 0.99,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'Alice Johnson',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments[0]).toEqual({
        startTime: 1000,
        endTime: 6000,
        speakerLabel: 'spk_0',
        speakerName: 'Alice Johnson',
        text: 'Important meeting content.',
        languageCode: 'en-US',
        confidence: 0.99,
        words: [],
      });
    });
  });

  describe('Batch Write Operations', () => {
    it('should use batch write for efficiency', async () => {
      const meetingId = 'test-meeting-batch';
      const mockSegments = Array.from({ length: 10 }, (_, i) => ({
        meetingId,
        startTime: i * 1000,
        endTime: (i + 1) * 1000,
        speakerLabel: `spk_${i % 2}`,
        text: `Segment ${i}`,
        languageCode: 'en-US',
        confidence: 0.95,
      }));

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'Speaker A',
        spk_1: 'Speaker B',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(ddbMock.calls()).toHaveLength(2); // 1 Query + 1 BatchWrite
      
      // Verify BatchWriteCommand was called
      const batchWriteCall = ddbMock.call(1);
      expect(batchWriteCall.args[0].constructor.name).toBe('BatchWriteCommand');
    });

    it('should handle large number of segments with multiple batches', async () => {
      const meetingId = 'test-meeting-large';
      // Create 60 segments (will require 3 batches of 25, 25, 10)
      const mockSegments = Array.from({ length: 60 }, (_, i) => ({
        meetingId,
        startTime: i * 1000,
        endTime: (i + 1) * 1000,
        speakerLabel: `spk_${i % 3}`,
        text: `Segment ${i}`,
        languageCode: 'en-US',
        confidence: 0.95,
      }));

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'Speaker A',
        spk_1: 'Speaker B',
        spk_2: 'Speaker C',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Verify 3 BatchWriteCommands were called (for 60 items in batches of 25)
      expect(ddbMock.calls()).toHaveLength(4); // 1 Query + 3 BatchWrites
    });

    it('should handle unprocessed items in batch write', async () => {
      const meetingId = 'test-meeting-unprocessed';
      const mockSegments = [
        {
          meetingId,
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          text: 'Test segment.',
          languageCode: 'en-US',
          confidence: 0.98,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      // First batch write returns unprocessed items
      ddbMock.on(BatchWriteCommand)
        .resolvesOnce({
          UnprocessedItems: {
            'test-transcript-segments-table': [
              {
                PutRequest: {
                  Item: mockSegments[0],
                },
              },
            ],
          },
        })
        .resolvesOnce({}); // Retry succeeds

      const speakerMappings = {
        spk_0: 'John Doe',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Verify BatchWriteCommand was called twice (initial + retry)
      expect(ddbMock.calls()).toHaveLength(3); // 1 Query + 2 BatchWrites (initial + retry)
    });
  });

  describe('Error Handling', () => {
    it('should return 404 when no transcript segments found', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createMockEvent('meeting-no-segments', { spk_0: 'John Doe' });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('TRANSCRIPT_NOT_FOUND');
      expect(body.error.message).toBe('No transcript segments found for this meeting');
    });

    it('should handle DynamoDB query errors', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('DynamoDB query error'));

      const event = createMockEvent('test-meeting-error', { spk_0: 'John Doe' });
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });

    it('should handle DynamoDB batch write errors', async () => {
      const mockSegments = [
        {
          meetingId: 'test-meeting',
          startTime: 0,
          endTime: 5000,
          speakerLabel: 'spk_0',
          text: 'Test.',
          languageCode: 'en-US',
          confidence: 0.98,
        },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockSegments,
      });

      ddbMock.on(BatchWriteCommand).rejects(new Error('DynamoDB write error'));

      const event = createMockEvent('test-meeting', { spk_0: 'John Doe' });
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });
  });

  describe('Pagination', () => {
    it('should handle paginated query results', async () => {
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

      ddbMock.on(BatchWriteCommand).resolves({});

      const speakerMappings = {
        spk_0: 'John Doe',
        spk_1: 'Jane Smith',
      };

      const event = createMockEvent(meetingId, speakerMappings);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.segments).toHaveLength(2);
      
      // Verify 2 QueryCommands were called (pagination)
      expect(ddbMock.calls()).toHaveLength(3); // 2 Queries + 1 BatchWrite
    });
  });
});
