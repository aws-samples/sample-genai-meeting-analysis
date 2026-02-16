// Set environment variables before importing the handler
process.env.MEETINGS_TABLE = 'test-meetings-table';
process.env.TRANSCRIPT_SEGMENTS_TABLE = 'test-transcript-segments-table';
process.env.PROMPT_TEMPLATES_TABLE = 'test-prompt-templates-table';
process.env.BEDROCK_MODEL_ID = 'amazon.nova-pro-v1:0';

import { handler } from './index';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { TranscriptSegmentItem } from '@meeting-platform/shared';
import * as fc from 'fast-check';

// Create mocks
const dynamoMock = mockClient(DynamoDBDocumentClient);
const bedrockRuntimeMock = mockClient(BedrockRuntimeClient);

describe('GenerateAnalysisFunction', () => {
  beforeEach(() => {
    // Reset all mocks
    dynamoMock.reset();
    bedrockRuntimeMock.reset();

    // Set environment variables
    process.env.MEETINGS_TABLE = 'test-meetings-table';
    process.env.TRANSCRIPT_SEGMENTS_TABLE = 'test-transcript-segments-table';
    process.env.PROMPT_TEMPLATES_TABLE = 'test-prompt-templates-table';
    process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    delete process.env.CUSTOM_PROMPT_TEMPLATE;
  });

  const mockTranscriptSegments: TranscriptSegmentItem[] = [
    {
      meetingId: 'meeting-123',
      startTime: 0,
      endTime: 5000,
      speakerLabel: 'spk_0',
      speakerName: 'John Doe',
      text: 'Welcome everyone to the board meeting.',
      languageCode: 'en-US',
      confidence: 0.99,
      words: [],
    },
    {
      meetingId: 'meeting-123',
      startTime: 5500,
      endTime: 12000,
      speakerLabel: 'spk_1',
      speakerName: 'Jane Smith',
      text: 'Thank you. Let\'s start with the quarterly results.',
      languageCode: 'en-US',
      confidence: 0.98,
      words: [],
    },
    {
      meetingId: 'meeting-123',
      startTime: 13000,
      endTime: 20000,
      speakerLabel: 'spk_0',
      text: 'Our revenue increased by 15% this quarter.',
      languageCode: 'en-US',
      confidence: 0.97,
      words: [],
    },
  ];

  // Mock response for Nova model format (default model is amazon.nova-pro-v1:0)
  const mockBedrockResponseBody = JSON.stringify({
    output: {
      message: {
        content: [
          {
            text: '# Meeting Analysis\n\n## Executive Summary\n\nThe board meeting discussed quarterly results showing 15% revenue growth.\n\n## Key Discussion Points\n\n- Quarterly financial performance\n- Revenue growth metrics\n\n## Decisions Made\n\nNo specific decisions recorded in this segment.\n\n## Action Items\n\nNone identified.\n\n## Next Steps\n\nContinue monitoring quarterly performance.\n\n## Sentiment Analysis\n\nPositive and professional tone throughout the meeting.',
          },
        ],
      },
    },
    stopReason: 'end_turn',
    usage: {
      inputTokens: 150,
      outputTokens: 200,
    },
  });

  it('should successfully generate analysis with default prompt', async () => {
    // Mock user settings retrieval (no custom settings)
    dynamoMock.on(GetCommand).resolves({});

    // Mock DynamoDB query for transcript segments
    dynamoMock.on(QueryCommand).resolves({
      Items: mockTranscriptSegments,
    });

    // Mock Bedrock invocation
    bedrockRuntimeMock.on(InvokeModelCommand).resolves({
      body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
      $metadata: {},
    } as any);

    // Mock DynamoDB update for storing analysis
    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
      correlationId: 'test-correlation-id',
    };

    const result = await handler(event);

    // Verify QueryCommand was called
    const queryCalls = dynamoMock.commandCalls(QueryCommand);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].args[0].input.KeyConditionExpression).toBe('meetingId = :meetingId');
    expect(queryCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':meetingId': 'meeting-123',
    });

    // Verify Bedrock was called (using default Nova model)
    const bedrockCalls = bedrockRuntimeMock.commandCalls(InvokeModelCommand);
    expect(bedrockCalls).toHaveLength(1);
    expect(bedrockCalls[0].args[0].input.modelId).toBe('amazon.nova-pro-v1:0');

    // Verify UpdateCommand was called to store analysis
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.Key).toMatchObject({
      userId: 'user-456',
      meetingId: 'meeting-123',
    });
    expect(updateCalls[0].args[0].input.UpdateExpression).toBe('SET #status = :status, analysisMarkdown = :analysis, analysisGeneratedAt = :timestamp, analysisTokenUsage = :tokenUsage');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('generating-report');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':analysis']).toContain('Meeting Analysis');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':tokenUsage']).toEqual({
      inputTokens: 150,
      outputTokens: 200,
      modelId: 'amazon.nova-pro-v1:0',
    });

    // Verify response for Step Functions
    expect(result).toMatchObject({
      statusCode: 200,
      meetingId: 'meeting-123',
      userId: 'user-456',
      status: 'generating-report',
    });
  });

  it('should format transcript with speaker names and timestamps', async () => {
    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: mockTranscriptSegments,
    });

    bedrockRuntimeMock.on(InvokeModelCommand).resolves({
      body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
      $metadata: {},
    } as any);

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await handler(event);

    // Verify the transcript formatting in Bedrock call (Nova format)
    const bedrockCalls = bedrockRuntimeMock.commandCalls(InvokeModelCommand);
    const requestBody = JSON.parse(bedrockCalls[0].args[0].input.body as string);
    const prompt = requestBody.messages[0].content[0].text;

    // Check that formatted transcript includes speaker names and timestamps
    expect(prompt).toContain('[00:00] John Doe [en-US]: Welcome everyone to the board meeting.');
    expect(prompt).toContain('[00:05] Jane Smith [en-US]: Thank you. Let\'s start with the quarterly results.');
    expect(prompt).toContain('[00:13] spk_0 [en-US]: Our revenue increased by 15% this quarter.');
  });

  it('should retry on throttling errors', async () => {
    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: mockTranscriptSegments,
    });

    // First call fails with throttling, second succeeds
    bedrockRuntimeMock.on(InvokeModelCommand)
      .rejectsOnce(Object.assign(new Error('ThrottlingException'), { name: 'ThrottlingException' }))
      .resolvesOnce({
        body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
        $metadata: {},
      } as any);

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await handler(event);

    // Verify Bedrock was called twice (initial + 1 retry)
    const bedrockCalls = bedrockRuntimeMock.commandCalls(InvokeModelCommand);
    expect(bedrockCalls).toHaveLength(2);

    // Verify analysis was stored successfully with status 'generating-report'
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('generating-report');
  });

  it('should update meeting status to failed on error', async () => {
    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: mockTranscriptSegments,
    });

    bedrockRuntimeMock.on(InvokeModelCommand).rejects(new Error('Model unavailable'));

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await expect(handler(event)).rejects.toThrow('Model unavailable');

    // Verify meeting status was updated to failed
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.Key).toMatchObject({
      userId: 'user-456',
      meetingId: 'meeting-123',
    });
    expect(updateCalls[0].args[0].input.UpdateExpression).toBe('SET #status = :status, errorMessage = :error');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'failed',
      ':error': 'Analysis generation failed: Model unavailable',
    });
  });

  it('should throw error when no transcript segments found', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
    });

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await expect(handler(event)).rejects.toThrow('No transcript segments found for meeting: meeting-123');

    // Verify meeting status was updated to failed
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('failed');
  });

  it('should handle Bedrock response with empty content', async () => {
    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: mockTranscriptSegments,
    });

    const emptyContentResponse = JSON.stringify({
      content: [],
      stop_reason: 'end_turn',
    });

    bedrockRuntimeMock.on(InvokeModelCommand).resolves({
      body: new Uint8Array(Buffer.from(emptyContentResponse)),
      $metadata: {},
    } as any);

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await expect(handler(event)).rejects.toThrow('No content in Bedrock response');

    // Verify meeting status was updated to failed
    const updateCalls = dynamoMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('failed');
  });

  it('should handle segments without speaker names', async () => {
    const segmentsWithoutNames: TranscriptSegmentItem[] = [
      {
        meetingId: 'meeting-123',
        startTime: 0,
        endTime: 5000,
        speakerLabel: 'spk_0',
        text: 'Hello everyone.',
        languageCode: 'en-US',
        confidence: 0.99,
        words: [],
      },
    ];

    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: segmentsWithoutNames,
    });

    bedrockRuntimeMock.on(InvokeModelCommand).resolves({
      body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
      $metadata: {},
    } as any);

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await handler(event);

    // Verify transcript uses speaker label when name is not available (Nova format)
    const bedrockCalls = bedrockRuntimeMock.commandCalls(InvokeModelCommand);
    const requestBody = JSON.parse(bedrockCalls[0].args[0].input.body as string);
    const prompt = requestBody.messages[0].content[0].text;
    expect(prompt).toContain('[00:00] spk_0 [en-US]: Hello everyone.');
  });

  it('should handle multilingual transcript segments', async () => {
    const multilingualSegments: TranscriptSegmentItem[] = [
      {
        meetingId: 'meeting-123',
        startTime: 0,
        endTime: 5000,
        speakerLabel: 'spk_0',
        text: 'Hello everyone.',
        languageCode: 'en-US',
        confidence: 0.99,
        words: [],
      },
      {
        meetingId: 'meeting-123',
        startTime: 5500,
        endTime: 10000,
        speakerLabel: 'spk_1',
        text: 'Hola a todos.',
        languageCode: 'es-ES',
        confidence: 0.98,
        words: [],
      },
    ];

    dynamoMock.on(GetCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({
      Items: multilingualSegments,
    });

    bedrockRuntimeMock.on(InvokeModelCommand).resolves({
      body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
      $metadata: {},
    } as any);

    dynamoMock.on(UpdateCommand).resolves({});

    const event = {
      meetingId: 'meeting-123',
      userId: 'user-456',
    };

    await handler(event);

    // Verify both languages are included in transcript (Nova format)
    const bedrockCalls = bedrockRuntimeMock.commandCalls(InvokeModelCommand);
    const requestBody = JSON.parse(bedrockCalls[0].args[0].input.body as string);
    const prompt = requestBody.messages[0].content[0].text;
    expect(prompt).toContain('[en-US]');
    expect(prompt).toContain('[es-ES]');
  });

  /**
   * Property test: Analysis function returns proper response for Step Functions
   * 
   * For any valid input, the function should return a response with statusCode, meetingId, userId, and status
   */
  it('property: returns proper Step Functions response on success', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random meeting IDs and user IDs
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        // Generate random transcript segments (at least 1)
        fc.array(
          fc.record({
            startTime: fc.nat(100000),
            endTime: fc.nat(100000),
            speakerLabel: fc.constantFrom('spk_0', 'spk_1', 'spk_2'),
            text: fc.string({ minLength: 10, maxLength: 200 }),
            languageCode: fc.constantFrom('en-US', 'es-ES', 'ro-RO'),
            confidence: fc.double({ min: 0.5, max: 1.0 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (meetingId, userId, segments) => {
          // Reset mocks for each iteration
          dynamoMock.reset();
          bedrockRuntimeMock.reset();

          // Ensure endTime > startTime for each segment
          const validSegments = segments.map(seg => ({
            ...seg,
            meetingId,
            endTime: seg.startTime + Math.abs(seg.endTime - seg.startTime) + 1000,
            words: [],
          }));

          // Mock user settings retrieval (no custom settings)
          dynamoMock.on(GetCommand).resolves({});

          // Mock transcript segments retrieval
          dynamoMock.on(QueryCommand).resolves({
            Items: validSegments,
          });

          // Mock Bedrock invocation (successful analysis)
          bedrockRuntimeMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(mockBedrockResponseBody)),
            $metadata: {},
          } as any);

          // Mock DynamoDB update for storing analysis (successful)
          dynamoMock.on(UpdateCommand).resolves({});

          const event = {
            meetingId,
            userId,
            correlationId: 'test-correlation-id',
          };

          const result = await handler(event);

          // Verify response structure for Step Functions
          expect(result).toMatchObject({
            statusCode: 200,
            meetingId,
            userId,
            status: 'generating-report',
          });

          // Verify analysis was stored with correct status
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBeGreaterThan(0);
          
          const analysisUpdateCall = updateCalls.find(call => 
            call.args[0].input.UpdateExpression?.includes('analysisMarkdown')
          );
          expect(analysisUpdateCall).toBeDefined();
          expect(analysisUpdateCall?.args[0].input.ExpressionAttributeValues?.[':status']).toBe('generating-report');
        }
      ),
      { numRuns: 100 }
    );
  });
});
