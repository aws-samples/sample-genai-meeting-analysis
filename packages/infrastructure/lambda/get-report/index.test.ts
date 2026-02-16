import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from './index';
import { MeetingReportItem } from '@meeting-platform/shared';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('GetReportFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env.MEETING_REPORTS_TABLE = 'test-reports-table';
  });

  const createMockEvent = (
    meetingId: string,
    userId: string = 'test-user-123'
  ): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: `/meetings/${meetingId}/report`,
    pathParameters: { id: meetingId },
    headers: {},
    body: null,
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        claims: {
          sub: userId,
        },
      },
    } as any,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    multiValueHeaders: {},
  });

  describe('Edit Metadata Inclusion', () => {
    it('should include isManuallyEdited flag in placeholder response', async () => {
      const meetingId = 'meeting-123';
      const userId = 'user-123';

      const mockReport: MeetingReportItem = {
        meetingId,
        reportId: 'latest',
        userId,
        templateId: 'template-1',
        reportContent: 'Test report content',
        extractedData: {
          placeholders: {
            company_name: {
              value: 'Acme Corp',
              citation: { startTime: 1000, endTime: 2000 },
              isFilled: true,
              isManuallyEdited: true,
            },
            project_name: {
              value: 'Project X',
              citation: { startTime: 3000, endTime: 4000 },
              isFilled: true,
              isManuallyEdited: false,
            },
          },
          agendaPoints: [],
        },
        generatedAt: Date.now(),
        status: 'completed',
      };

      ddbMock.on(GetCommand).resolves({ Item: mockReport });

      const event = createMockEvent(meetingId, userId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      expect(body.report.placeholders.company_name.isManuallyEdited).toBe(true);
      expect(body.report.placeholders.project_name.isManuallyEdited).toBe(false);
    });

    it('should include lastEditedAt timestamp when available', async () => {
      const meetingId = 'meeting-456';
      const userId = 'user-456';
      const editTimestamp = Date.now() - 3600000; // 1 hour ago

      const mockReport: MeetingReportItem = {
        meetingId,
        reportId: 'latest',
        userId,
        templateId: 'template-1',
        reportContent: 'Test report content',
        extractedData: {
          placeholders: {
            company_name: {
              value: 'Edited Corp',
              citation: { startTime: 1000, endTime: 2000 },
              isFilled: true,
              isManuallyEdited: true,
              lastEditedAt: editTimestamp,
            },
          },
          agendaPoints: [],
        },
        generatedAt: Date.now(),
        status: 'completed',
      };

      ddbMock.on(GetCommand).resolves({ Item: mockReport });

      const event = createMockEvent(meetingId, userId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      expect(body.report.placeholders.company_name.lastEditedAt).toBe(editTimestamp);
    });

    it('should include originalValue for manually edited placeholders', async () => {
      const meetingId = 'meeting-789';
      const userId = 'user-789';

      const mockReport: MeetingReportItem = {
        meetingId,
        reportId: 'latest',
        userId,
        templateId: 'template-1',
        reportContent: 'Test report content',
        extractedData: {
          placeholders: {
            company_name: {
              value: 'Manually Edited Corp',
              citation: { startTime: 1000, endTime: 2000 },
              isFilled: true,
              isManuallyEdited: true,
              lastEditedAt: Date.now(),
              originalValue: 'Original Corp',
            },
          },
          agendaPoints: [],
        },
        generatedAt: Date.now(),
        status: 'completed',
      };

      ddbMock.on(GetCommand).resolves({ Item: mockReport });

      const event = createMockEvent(meetingId, userId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      expect(body.report.placeholders.company_name.originalValue).toBe('Original Corp');
      expect(body.report.placeholders.company_name.value).toBe('Manually Edited Corp');
      expect(body.report.placeholders.company_name.isManuallyEdited).toBe(true);
    });

    it('should handle placeholders without edit metadata gracefully', async () => {
      const meetingId = 'meeting-old';
      const userId = 'user-old';

      const mockReport: MeetingReportItem = {
        meetingId,
        reportId: 'latest',
        userId,
        templateId: 'template-1',
        reportContent: 'Test report content',
        extractedData: {
          placeholders: {
            company_name: {
              value: 'Old Corp',
              citation: { startTime: 1000, endTime: 2000 },
              isFilled: true,
              // No edit metadata fields
            },
          },
          agendaPoints: [],
        },
        generatedAt: Date.now(),
        status: 'completed',
      };

      ddbMock.on(GetCommand).resolves({ Item: mockReport });

      const event = createMockEvent(meetingId, userId);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      expect(body.report.placeholders.company_name.value).toBe('Old Corp');
      expect(body.report.placeholders.company_name.isManuallyEdited).toBeUndefined();
      expect(body.report.placeholders.company_name.lastEditedAt).toBeUndefined();
      expect(body.report.placeholders.company_name.originalValue).toBeUndefined();
    });
  });

  describe('Authorization', () => {
    it('should return 403 when user does not own the report', async () => {
      const meetingId = 'meeting-123';
      const requestingUserId = 'user-123';
      const reportOwnerId = 'user-456';

      const mockReport: MeetingReportItem = {
        meetingId,
        reportId: 'latest',
        userId: reportOwnerId,
        templateId: 'template-1',
        reportContent: 'Test report content',
        extractedData: {
          placeholders: {},
          agendaPoints: [],
        },
        generatedAt: Date.now(),
        status: 'completed',
      };

      ddbMock.on(GetCommand).resolves({ Item: mockReport });

      const event = createMockEvent(meetingId, requestingUserId);
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 when report not found', async () => {
      const meetingId = 'nonexistent-meeting';
      const userId = 'user-123';

      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const event = createMockEvent(meetingId, userId);
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('REPORT_NOT_FOUND');
    });

    it('should return 400 when meetingId is missing', async () => {
      const event = createMockEvent('', 'user-123');
      event.pathParameters = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });
});
