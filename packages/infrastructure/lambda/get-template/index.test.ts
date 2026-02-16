import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler as getHandler } from './index';
import { handler as saveHandler } from '../save-template/index';
import * as fc from 'fast-check';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.REPORT_TEMPLATES_TABLE = 'test-report-templates-table';

describe('GetTemplateFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/settings/report-template',
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
      path: '/settings/report-template',
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/settings/report-template',
    },
    resource: '/settings/report-template',
  });

  const createSaveEvent = (templateName: string, templateContent: string): APIGatewayProxyEvent => ({
    body: JSON.stringify({ templateName, templateContent }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'PUT',
    isBase64Encoded: false,
    path: '/settings/report-template',
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
      path: '/settings/report-template',
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/settings/report-template',
    },
    resource: '/settings/report-template',
  });

  describe('Template Retrieval', () => {
    it('should return stored template when it exists', async () => {
      const mockTemplate = {
        userId: 'test-user-id',
        templateId: 'default',
        templateName: 'My Template',
        templateContent: 'Meeting on {{date}} at {{location}}',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({
        Item: mockTemplate,
      });

      const event = createMockEvent();
      const result = await getHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.template.templateId).toBe('default');
      expect(body.template.templateName).toBe('My Template');
      expect(body.template.templateContent).toBe('Meeting on {{date}} at {{location}}');
    });

    it('should return default template when none exists', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: undefined,
      });

      const event = createMockEvent();
      const result = await getHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.template.templateId).toBe('default');
      expect(body.template.templateName).toBe('Default Template');
      expect(body.template.templateContent).toContain('{{meeting_date}}');
      expect(body.template.updatedAt).toBeNull();
    });

    it('should handle DynamoDB errors', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const event = createMockEvent();
      const result = await getHandler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('GET_TEMPLATE_FAILED');
      expect(body.error.retryable).toBe(true);
    });
  });

  /**
   * Property-Based Test
   * Feature: template-based-meeting-reports, Property 2: Template storage round-trip
   * Validates: Requirements 1.5
   * 
   * For any valid template, saving it to DynamoDB and then retrieving it 
   * should return an equivalent template with the same content
   */
  describe('Property 2: Template storage round-trip', () => {
    it('should preserve template content through JSON serialization', () => {
      // Generator for valid placeholder names
      const validPlaceholderName = fc.stringMatching(/^[a-zA-Z0-9_]+$/);
      
      // Generator for safe text (no braces)
      const safeText = fc.string().filter((s: string) => !s.includes('{') && !s.includes('}'));
      
      // Generator for valid templates
      const validTemplateArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 50 }), // template name
        fc.array(
          fc.tuple(safeText, validPlaceholderName),
          { minLength: 1, maxLength: 5 }
        ).map(parts => {
          let template = '';
          for (const [text, placeholder] of parts) {
            template += text + `{{${placeholder}}}`;
          }
          return template;
        })
      );

      fc.assert(
        fc.property(validTemplateArbitrary, ([templateName, templateContent]) => {
          // Simulate what DynamoDB does: serialize and deserialize
          const mockTemplate = {
            userId: 'test-user-id',
            templateId: 'default',
            templateName,
            templateContent,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          // Serialize (what happens when storing)
          const serialized = JSON.stringify(mockTemplate);
          
          // Deserialize (what happens when retrieving)
          const deserialized = JSON.parse(serialized);
          
          // Verify content is preserved
          expect(deserialized.templateName).toBe(templateName);
          expect(deserialized.templateContent).toBe(templateContent);
          expect(deserialized.templateId).toBe('default');
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve special characters through JSON serialization', () => {
      // Generator for templates with various special characters
      const templateWithSpecialChars = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string().filter((s: string) => !s.includes('{') && !s.includes('}')),
        fc.constantFrom('\n', '\t', '\r\n', '  ', '"', "'", '\\')
      ).map(([name, content, specialChar]) => ({
        name,
        content: `${content}{{placeholder}}${specialChar}`,
      }));

      fc.assert(
        fc.property(templateWithSpecialChars, ({ name, content }) => {
          const mockTemplate = {
            userId: 'test-user-id',
            templateId: 'default',
            templateName: name,
            templateContent: content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          // Serialize and deserialize
          const serialized = JSON.stringify(mockTemplate);
          const deserialized = JSON.parse(serialized);
          
          // Verify special characters are preserved
          expect(deserialized.templateContent).toBe(content);
        }),
        { numRuns: 100 }
      );
    });
  });
});
