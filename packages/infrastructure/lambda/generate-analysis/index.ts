import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { generateCorrelationId, logWithContext } from '../shared/utils';
import { TranscriptSegmentItem, PromptTemplateItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockRuntimeClient = new BedrockRuntimeClient({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const TRANSCRIPT_SEGMENTS_TABLE = process.env.TRANSCRIPT_SEGMENTS_TABLE!;
const PROMPT_TEMPLATES_TABLE = process.env.PROMPT_TEMPLATES_TABLE!;
const DEFAULT_BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
const CUSTOM_PROMPT_TEMPLATE = process.env.CUSTOM_PROMPT_TEMPLATE;

// Event payload from ProcessTranscribeOutputFunction
interface GenerateAnalysisEvent {
  meetingId: string;
  userId: string;
  correlationId?: string;
  customPrompt?: string;
}

/**
 * Retrieve user's prompt template settings from DynamoDB
 */
async function getUserSettings(
  userId: string,
  correlationId: string
): Promise<{ promptTemplate: string; modelId: string }> {
  logWithContext(correlationId, 'INFO', 'Retrieving user settings', { userId });

  try {
    const getCommand = new GetCommand({
      TableName: PROMPT_TEMPLATES_TABLE,
      Key: {
        userId,
        templateId: 'default',
      },
    });

    const result = await docClient.send(getCommand);

    if (result.Item) {
      const settings = result.Item as PromptTemplateItem;
      logWithContext(correlationId, 'INFO', 'User settings found', {
        userId,
        modelId: settings.modelId,
        hasCustomPrompt: !!settings.promptText,
      });

      return {
        promptTemplate: settings.promptText,
        modelId: settings.modelId,
      };
    }

    logWithContext(correlationId, 'INFO', 'No user settings found, using defaults', { userId });
    return {
      promptTemplate: getDefaultPrompt(),
      modelId: DEFAULT_BEDROCK_MODEL_ID,
    };
  } catch (error: any) {
    logWithContext(correlationId, 'WARN', 'Failed to retrieve user settings, using defaults', {
      userId,
      error: error.message,
    });

    return {
      promptTemplate: getDefaultPrompt(),
      modelId: DEFAULT_BEDROCK_MODEL_ID,
    };
  }
}

/**
 * Retrieve transcript segments from DynamoDB
 */
async function retrieveTranscriptSegments(
  meetingId: string,
  correlationId: string
): Promise<TranscriptSegmentItem[]> {
  logWithContext(correlationId, 'INFO', 'Retrieving transcript segments', {
    meetingId,
  });

  const queryCommand = new QueryCommand({
    TableName: TRANSCRIPT_SEGMENTS_TABLE,
    KeyConditionExpression: 'meetingId = :meetingId',
    ExpressionAttributeValues: {
      ':meetingId': meetingId,
    },
  });

  const result = await docClient.send(queryCommand);

  if (!result.Items || result.Items.length === 0) {
    throw new Error(`No transcript segments found for meeting: ${meetingId}`);
  }

  logWithContext(correlationId, 'INFO', 'Transcript segments retrieved', {
    meetingId,
    segmentCount: result.Items.length,
  });

  return result.Items as TranscriptSegmentItem[];
}

/**
 * Format transcript segments into a readable text format
 */
function formatTranscript(segments: TranscriptSegmentItem[]): string {
  const lines: string[] = [];

  for (const segment of segments) {
    const speakerName = segment.speakerName || segment.speakerLabel;
    const timestamp = formatTimestamp(segment.startTime);
    const language = segment.languageCode ? ` [${segment.languageCode}]` : '';
    
    lines.push(`[${timestamp}] ${speakerName}${language}: ${segment.text}`);
  }

  return lines.join('\n\n');
}

/**
 * Format milliseconds to MM:SS timestamp
 */
function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Get prompt template (custom or default)
 * Priority: event customPrompt > user settings > environment variable > default
 */
function getPromptTemplate(
  customPrompt: string | undefined,
  userSettingsPrompt: string,
  correlationId: string
): string {
  // Use custom prompt from event if provided (highest priority)
  if (customPrompt) {
    logWithContext(correlationId, 'INFO', 'Using custom prompt from event');
    return customPrompt;
  }

  // Use prompt from user settings (from database)
  if (userSettingsPrompt && userSettingsPrompt !== getDefaultPrompt()) {
    logWithContext(correlationId, 'INFO', 'Using prompt from user settings');
    return userSettingsPrompt;
  }

  // Use custom prompt from environment variable if set
  if (CUSTOM_PROMPT_TEMPLATE) {
    logWithContext(correlationId, 'INFO', 'Using custom prompt from environment');
    return CUSTOM_PROMPT_TEMPLATE;
  }

  // Fall back to default prompt
  logWithContext(correlationId, 'INFO', 'Using default prompt template');
  return getDefaultPrompt();
}

/**
 * Get default prompt template
 */
function getDefaultPrompt(): string {
  return `You are an AI assistant analyzing a board meeting transcript. Please provide a comprehensive analysis in markdown format that includes:

1. **Executive Summary**: A brief overview of the meeting (2-3 sentences)

2. **Key Discussion Points**: Main topics discussed during the meeting

3. **Decisions Made**: Important decisions and resolutions

4. **Action Items**: Tasks assigned with responsible parties (if mentioned)

5. **Next Steps**: Follow-up actions and future meeting topics

6. **Sentiment Analysis**: Overall tone and atmosphere of the meeting

Please format your response in clear, professional markdown. Be concise but thorough.

Here is the transcript:

{{transcript}}`;
}

/**
 * Token usage result from Bedrock
 */
interface BedrockAnalysisResult {
  markdown: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Call Amazon Bedrock to generate analysis
 */
async function generateAnalysisWithBedrock(
  transcript: string,
  promptTemplate: string,
  modelId: string,
  correlationId: string,
  retryCount: number = 0
): Promise<BedrockAnalysisResult> {
  const MAX_RETRIES = 3;

  logWithContext(correlationId, 'INFO', 'Calling Bedrock for analysis generation', {
    modelId,
    transcriptLength: transcript.length,
    retryCount,
  });

  // Replace {{transcript}} placeholder in prompt template
  const prompt = promptTemplate.replace('{{transcript}}', transcript);

  // Determine if using Nova or Claude model
  const isNovaModel = modelId.includes('nova');
  
  // Prepare request body based on model type
  const requestBody = isNovaModel
    ? {
        // Nova model format
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          max_new_tokens: 4096,
          temperature: 0.7,
        },
      }
    : {
        // Claude model format
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      };

  const invokeCommand = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  try {
    const response = await bedrockRuntimeClient.send(invokeCommand);

    if (!response.body) {
      throw new Error('Bedrock response body is empty');
    }

    // Parse response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    logWithContext(correlationId, 'INFO', 'Bedrock response received', {
      stopReason: responseBody.stop_reason || responseBody.stopReason,
      usage: responseBody.usage,
    });

    // Extract markdown content and token usage based on model type
    let analysisMarkdown: string;
    let tokenUsage: { inputTokens: number; outputTokens: number };
    
    if (isNovaModel) {
      // Nova response format
      if (!responseBody.output?.message?.content || responseBody.output.message.content.length === 0) {
        throw new Error('No content in Bedrock response');
      }
      analysisMarkdown = responseBody.output.message.content[0].text;
      
      // Extract token usage from Nova response
      tokenUsage = {
        inputTokens: responseBody.usage?.inputTokens || 0,
        outputTokens: responseBody.usage?.outputTokens || 0,
      };
    } else {
      // Claude response format
      if (!responseBody.content || responseBody.content.length === 0) {
        throw new Error('No content in Bedrock response');
      }
      analysisMarkdown = responseBody.content[0].text;
      
      // Extract token usage from Claude response
      tokenUsage = {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0,
      };
    }

    logWithContext(correlationId, 'INFO', 'Analysis generated successfully', {
      analysisLength: analysisMarkdown.length,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });

    return {
      markdown: analysisMarkdown,
      tokenUsage,
    };
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Bedrock invocation failed', {
      error: error.message,
      retryCount,
    });

    // Retry logic for transient errors
    if (retryCount < MAX_RETRIES && isRetryableError(error)) {
      const backoffMs = Math.pow(2, retryCount) * 1000; // Exponential backoff
      
      logWithContext(correlationId, 'INFO', 'Retrying Bedrock invocation', {
        retryCount: retryCount + 1,
        backoffMs,
      });

      await sleep(backoffMs);
      return generateAnalysisWithBedrock(transcript, promptTemplate, modelId, correlationId, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Check if error is retryable
 */
function isRetryableError(error: any): boolean {
  const retryableErrors = [
    'ThrottlingException',
    'ServiceUnavailableException',
    'InternalServerException',
    'ModelTimeoutException',
  ];

  return retryableErrors.some(errorType => 
    error.name === errorType || error.message?.includes(errorType)
  );
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Store analysis in DynamoDB and update meeting status
 */
async function storeAnalysis(
  userId: string,
  meetingId: string,
  analysisMarkdown: string,
  tokenUsage: { inputTokens: number; outputTokens: number },
  modelId: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Storing analysis in DynamoDB', {
    meetingId,
    analysisLength: analysisMarkdown.length,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    modelId,
  });

  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET #status = :status, analysisMarkdown = :analysis, analysisGeneratedAt = :timestamp, analysisTokenUsage = :tokenUsage',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'generating-report',  // Next step in the workflow
      ':analysis': analysisMarkdown,
      ':timestamp': Date.now(),
      ':tokenUsage': {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        modelId,
      },
    },
    ConditionExpression: 'attribute_exists(meetingId)',
  });

  await docClient.send(updateCommand);

  logWithContext(correlationId, 'INFO', 'Analysis stored and meeting status updated to generating-report', {
    meetingId,
  });
}

/**
 * Update meeting status to failed with error message
 */
async function updateMeetingStatusToFailed(
  userId: string,
  meetingId: string,
  errorMessage: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'ERROR', 'Updating meeting status to failed', {
    meetingId,
    errorMessage,
  });

  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET #status = :status, errorMessage = :error',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'failed',
      ':error': errorMessage,
    },
    ConditionExpression: 'attribute_exists(meetingId)',
  });

  await docClient.send(updateCommand);
}

/**
 * Lambda handler for generating meeting analysis
 * Handles both async invocation (from ProcessTranscribeOutput) and API Gateway requests
 */
export const handler = async (event: any): Promise<any> => {
  // Detect if this is an API Gateway event or direct invocation
  const isApiGatewayEvent = event.requestContext && event.pathParameters;
  
  let meetingId: string;
  let userId: string;
  let customPrompt: string | undefined;
  let correlationId: string;

  if (isApiGatewayEvent) {
    // API Gateway invocation - import necessary functions
    const { getUserIdFromEvent } = await import('../shared/utils');
    const { createSuccessResponse, createErrorResponse } = await import('../shared/types');
    
    correlationId = generateCorrelationId();
    
    logWithContext(correlationId, 'INFO', 'GenerateAnalysisFunction invoked via API Gateway', {
      path: event.path,
      httpMethod: event.httpMethod,
    });

    try {
      // Extract userId from Cognito claims
      userId = getUserIdFromEvent(event);
      
      // Extract meetingId from path parameters
      meetingId = event.pathParameters?.id;
      
      if (!meetingId) {
        return createErrorResponse(400, {
          code: 'INVALID_REQUEST',
          message: 'Meeting ID is required',
          retryable: false,
        });
      }

      // Extract custom prompt from request body if provided
      if (event.body) {
        try {
          const body = JSON.parse(event.body);
          customPrompt = body.customPrompt;
        } catch (e) {
          // Ignore parse errors - customPrompt is optional
        }
      }

      logWithContext(correlationId, 'INFO', 'API Gateway request parsed', {
        meetingId,
        userId,
        hasCustomPrompt: !!customPrompt,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to parse API Gateway request', {
        error: error.message,
      });
      
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: error.message,
        retryable: false,
      });
    }
  } else {
    // Direct invocation (from ProcessTranscribeOutput)
    correlationId = event.correlationId || generateCorrelationId();
    meetingId = event.meetingId;
    userId = event.userId;
    customPrompt = event.customPrompt;

    logWithContext(correlationId, 'INFO', 'GenerateAnalysisFunction invoked directly', {
      meetingId,
      userId,
      hasCustomPrompt: !!customPrompt,
    });
  }

  try {
    // Retrieve user settings (prompt template and model)
    const userSettings = await getUserSettings(userId, correlationId);

    // Retrieve transcript segments from DynamoDB
    const segments = await retrieveTranscriptSegments(meetingId, correlationId);

    // Format transcript for analysis
    const formattedTranscript = formatTranscript(segments);

    logWithContext(correlationId, 'INFO', 'Transcript formatted', {
      meetingId,
      transcriptLength: formattedTranscript.length,
    });

    // Get prompt template (with priority: event > user settings > env > default)
    const promptTemplate = getPromptTemplate(customPrompt, userSettings.promptTemplate, correlationId);

    // Generate analysis using Bedrock with user's preferred model
    const analysisResult = await generateAnalysisWithBedrock(
      formattedTranscript,
      promptTemplate,
      userSettings.modelId,
      correlationId
    );

    // Store analysis and update meeting status
    await storeAnalysis(
      userId,
      meetingId,
      analysisResult.markdown,
      analysisResult.tokenUsage,
      userSettings.modelId,
      correlationId
    );

    logWithContext(correlationId, 'INFO', 'GenerateAnalysisFunction completed successfully', {
      meetingId,
    });

    // Return appropriate response based on invocation type
    if (isApiGatewayEvent) {
      const { createSuccessResponse } = await import('../shared/types');
      return createSuccessResponse({
        message: 'Analysis generation completed successfully',
        meetingId,
      });
    }

    // Return response for Step Functions
    return {
      statusCode: 200,
      meetingId,
      userId,
      status: 'generating-report',
    };
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GenerateAnalysisFunction failed', {
      meetingId,
      error: error.message,
      stack: error.stack,
    });

    // Update meeting status to failed
    try {
      await updateMeetingStatusToFailed(
        userId,
        meetingId,
        `Analysis generation failed: ${error.message}`,
        correlationId
      );
    } catch (updateError: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to update meeting status to failed', {
        error: updateError.message,
      });
    }

    // Return appropriate error response based on invocation type
    if (isApiGatewayEvent) {
      const { createErrorResponse } = await import('../shared/types');
      return createErrorResponse(500, {
        code: 'ANALYSIS_GENERATION_FAILED',
        message: 'Failed to generate analysis',
        details: error.message,
        retryable: true,
      });
    }

    throw error;
  }
};
