import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Meeting } from '@meeting-platform/shared';
import { createSuccessResponse, createErrorResponse } from '../shared/types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;

/**
 * Lambda handler for listing user's meetings
 * GET /meetings
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Extract userId from Cognito authorizer
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, {
        code: 'UNAUTHORIZED',
        message: 'User ID not found in token',
      });
    }

    // Query meetings by userId (partition key)
    const result = await docClient.send(
      new QueryCommand({
        TableName: MEETINGS_TABLE,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by meetingId descending (newest first)
      })
    );

    const meetings = (result.Items || []) as Meeting[];

    return createSuccessResponse(meetings);
  } catch (error) {
    console.error('Error listing meetings:', error);

    return createErrorResponse(500, {
      code: 'INTERNAL_ERROR',
      message: 'Failed to list meetings',
    });
  }
}
