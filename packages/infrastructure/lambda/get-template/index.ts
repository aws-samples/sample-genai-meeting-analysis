import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { ReportTemplateItem } from '@meeting-platform/shared';
import { getDefaultReportTemplate } from '../shared/report-template';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const REPORT_TEMPLATES_TABLE = process.env.REPORT_TEMPLATES_TABLE!

/**
 * Lambda handler for getting report template
 * GET /settings/report-template
 */
export const handler = async (event: any): Promise<any> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'GetTemplateFunction invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);

    logWithContext(correlationId, 'INFO', 'Fetching report template', { userId });

    const getCommand = new GetCommand({
      TableName: REPORT_TEMPLATES_TABLE,
      Key: {
        userId,
        templateId: 'default',
      },
    });

    const result = await docClient.send(getCommand);

    if (result.Item) {
      const template = result.Item as ReportTemplateItem;
      
      logWithContext(correlationId, 'INFO', 'Report template found', { userId });

      return createSuccessResponse({
        template: {
          templateId: template.templateId,
          templateName: template.templateName,
          templateContent: template.templateContent,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        }
      });
    }

    // Return default template if none exists
    logWithContext(correlationId, 'INFO', 'No report template found, returning default', { userId });

    return createSuccessResponse({
      template: {
        templateId: 'default',
        templateName: 'Default Template',
        templateContent: getDefaultReportTemplate(),
        createdAt: Date.now(),
        updatedAt: null,
      }
    });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GetTemplateFunction failed', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'GET_TEMPLATE_FAILED',
      message: 'Failed to retrieve template',
      details: error.message,
      retryable: true,
    });
  }
};
