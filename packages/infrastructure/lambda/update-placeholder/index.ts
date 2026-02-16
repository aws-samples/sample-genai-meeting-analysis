import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { getUserIdFromEvent, generateCorrelationId, logWithContext } from '../shared/utils';
import { MeetingReportItem, UpdatePlaceholderRequest } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MEETING_REPORTS_TABLE = process.env.MEETING_REPORTS_TABLE!;

/**
 * Lambda handler for PATCH /meetings/{id}/report/placeholders/{placeholderName}
 * Updates a placeholder value in a meeting report
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = generateCorrelationId();
  
  logWithContext(correlationId, 'INFO', 'UpdatePlaceholder invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract userId from Cognito claims
    const userId = getUserIdFromEvent(event);
    
    logWithContext(correlationId, 'INFO', 'User authenticated', { userId });

    // Extract meetingId and placeholderName from path parameters
    const meetingId = event.pathParameters?.id;
    const placeholderName = event.pathParameters?.placeholderName;
    
    if (!meetingId) {
      logWithContext(correlationId, 'ERROR', 'Missing meetingId in path parameters');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Meeting ID is required',
        retryable: false,
      });
    }

    if (!placeholderName) {
      logWithContext(correlationId, 'ERROR', 'Missing placeholderName in path parameters');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Placeholder name is required',
        retryable: false,
      });
    }

    // Parse request body
    let requestBody: UpdatePlaceholderRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      logWithContext(correlationId, 'ERROR', 'Invalid JSON in request body');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Invalid JSON in request body',
        retryable: false,
      });
    }

    // Validate request body
    if (requestBody.value === undefined) {
      logWithContext(correlationId, 'ERROR', 'Missing value in request body');
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Placeholder value is required',
        retryable: false,
      });
    }

    // Validate value length (max 10KB)
    if (requestBody.value.length > 10240) {
      logWithContext(correlationId, 'ERROR', 'Placeholder value too long', {
        length: requestBody.value.length,
      });
      return createErrorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'Placeholder value exceeds maximum length of 10KB',
        retryable: false,
      });
    }

    logWithContext(correlationId, 'INFO', 'Retrieving report', {
      meetingId,
      placeholderName,
      userId,
    });

    // Retrieve current report from DynamoDB
    const getCommand = new GetCommand({
      TableName: MEETING_REPORTS_TABLE,
      Key: {
        meetingId,
        reportId: 'latest',
      },
    });

    const result = await docClient.send(getCommand);

    if (!result.Item) {
      logWithContext(correlationId, 'ERROR', 'Report not found', {
        meetingId,
      });
      
      return createErrorResponse(404, {
        code: 'REPORT_NOT_FOUND',
        message: 'Report not found for this meeting',
        retryable: false,
      });
    }

    const reportItem = result.Item as MeetingReportItem;
    
    // Verify the report belongs to the requesting user
    if (reportItem.userId !== userId) {
      logWithContext(correlationId, 'ERROR', 'Unauthorized access attempt', {
        meetingId,
        requestingUserId: userId,
        reportUserId: reportItem.userId,
      });
      
      return createErrorResponse(403, {
        code: 'FORBIDDEN',
        message: 'You do not have access to this report',
        retryable: false,
      });
    }

    // Verify placeholder exists in report
    if (!reportItem.extractedData.placeholders[placeholderName]) {
      logWithContext(correlationId, 'ERROR', 'Placeholder not found', {
        placeholderName,
        availablePlaceholders: Object.keys(reportItem.extractedData.placeholders),
      });
      
      return createErrorResponse(404, {
        code: 'PLACEHOLDER_NOT_FOUND',
        message: `Placeholder '${placeholderName}' not found in report`,
        retryable: false,
      });
    }

    const currentPlaceholder = reportItem.extractedData.placeholders[placeholderName];
    const oldValue = currentPlaceholder.value;
    const updatedAt = Date.now();

    // Preserve original LLM-extracted value if this is the first edit
    const originalValue = currentPlaceholder.isManuallyEdited 
      ? currentPlaceholder.originalValue 
      : currentPlaceholder.value;

    logWithContext(correlationId, 'INFO', 'Updating placeholder', {
      meetingId,
      placeholderName,
      oldValue,
      newValue: requestBody.value,
      isManuallyEdited: requestBody.isManuallyEdited,
    });

    // Update placeholder in DynamoDB with optimistic locking
    const updateCommand = new UpdateCommand({
      TableName: MEETING_REPORTS_TABLE,
      Key: {
        meetingId,
        reportId: 'latest',
      },
      UpdateExpression: `SET extractedData.placeholders.#placeholderName = :placeholderValue`,
      ConditionExpression: 'attribute_exists(meetingId) AND userId = :userId',
      ExpressionAttributeNames: {
        '#placeholderName': placeholderName,
      },
      ExpressionAttributeValues: {
        ':placeholderValue': {
          ...currentPlaceholder,
          value: requestBody.value,
          isManuallyEdited: requestBody.isManuallyEdited,
          lastEditedAt: updatedAt,
          originalValue: originalValue,
          isFilled: requestBody.value !== '',
        },
        ':userId': userId,
      },
      ReturnValues: 'NONE',
    });

    try {
      await docClient.send(updateCommand);
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        logWithContext(correlationId, 'ERROR', 'Concurrent modification detected', {
          meetingId,
          placeholderName,
        });
        
        return createErrorResponse(409, {
          code: 'CONCURRENT_MODIFICATION',
          message: 'The report was modified by another request. Please refresh and try again.',
          retryable: true,
        });
      }
      throw error;
    }

    logWithContext(correlationId, 'INFO', 'Placeholder updated successfully', {
      meetingId,
      placeholderName,
      updatedAt,
    });

    // Build success response
    const response = {
      success: true,
      placeholder: {
        name: placeholderName,
        value: requestBody.value,
        isManuallyEdited: requestBody.isManuallyEdited,
        updatedAt,
      },
    };

    logWithContext(correlationId, 'INFO', 'UpdatePlaceholder completed successfully', {
      meetingId,
      placeholderName,
    });

    return createSuccessResponse(response);
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in UpdatePlaceholder', {
      error: error.message,
      stack: error.stack,
    });

    return createErrorResponse(500, {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: error.message,
      retryable: true,
    });
  }
};
