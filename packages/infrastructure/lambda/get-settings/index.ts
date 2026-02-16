import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { PromptTemplateItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const PROMPT_TEMPLATES_TABLE = process.env.PROMPT_TEMPLATES_TABLE!;
const DEFAULT_BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

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
 * Lambda handler for getting user settings
 * GET /settings
 */
export const handler = async (event: any): Promise<any> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'GetSettingsFunction invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);

    logWithContext(correlationId, 'INFO', 'Fetching user settings', { userId });

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
      
      logWithContext(correlationId, 'INFO', 'User settings found', { userId });

      return createSuccessResponse({
        promptTemplate: settings.promptText,
        modelId: settings.modelId,
        templateName: settings.templateName,
        updatedAt: settings.updatedAt || settings.createdAt,
      });
    }

    // Return default settings if none exist
    logWithContext(correlationId, 'INFO', 'No user settings found, returning defaults', { userId });

    return createSuccessResponse({
      promptTemplate: getDefaultPrompt(),
      modelId: DEFAULT_BEDROCK_MODEL_ID,
      templateName: 'Default Template',
      updatedAt: null,
    });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GetSettingsFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'GET_SETTINGS_FAILED',
      message: 'Failed to retrieve settings',
      details: error.message,
      retryable: true,
    });
  }
};
