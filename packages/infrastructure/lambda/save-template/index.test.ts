import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler, validateTemplateSyntax } from './index';
import * as fc from 'fast-check';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.REPORT_TEMPLATES_TABLE = 'test-report-templates-table';

describe('SaveTemplateFunction', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
  });

  const createMockEvent = (
    templateName: string,
    templateContent: string
  ): APIGatewayProxyEvent => ({
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

  describe('Request Validation', () => {
    it('should return 400 when request body is missing', async () => {
      const event = createMockEvent('Test Template', '{{test}}');
      event.body = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Request body is required');
    });

    it('should return 400 when request body is invalid JSON', async () => {
      const event = createMockEvent('Test Template', '{{test}}');
      event.body = 'invalid json{';

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_JSON');
    });

    it('should return 400 when templateName is missing', async () => {
      const event = createMockEvent('Test Template', '{{test}}');
      event.body = JSON.stringify({ templateContent: '{{test}}' });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('templateName is required and must be a string');
    });

    it('should return 400 when templateContent is missing', async () => {
      const event = createMockEvent('Test Template', '{{test}}');
      event.body = JSON.stringify({ templateName: 'Test Template' });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('templateContent is required and must be a string');
    });

    it('should return 400 when template size exceeds limit', async () => {
      const largeTemplate = 'x'.repeat(51 * 1024); // 51KB
      const event = createMockEvent('Large Template', largeTemplate);

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('TEMPLATE_TOO_LARGE');
    });
  });

  describe('Template Validation', () => {
    it('should accept valid template with placeholders', async () => {
      const validTemplate = 'Meeting on {{date}} at {{location}} with {{participants}}';
      
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent('Valid Template', validTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBe('default');
      expect(body.validationErrors).toEqual([]);
    });

    it('should reject template with empty placeholder', async () => {
      const invalidTemplate = 'Meeting on {{}} at {{location}}';
      
      const event = createMockEvent('Invalid Template', invalidTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBeNull();
      expect(body.validationErrors.length).toBeGreaterThan(0);
      expect(body.validationErrors[0]).toContain('Empty placeholder');
    });

    it('should reject template with invalid placeholder characters', async () => {
      const invalidTemplate = 'Meeting on {{date-time}} at {{location!}}';
      
      const event = createMockEvent('Invalid Template', invalidTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBeNull();
      expect(body.validationErrors.length).toBeGreaterThan(0);
    });

    it('should reject template with mismatched braces', async () => {
      const invalidTemplate = 'Meeting on {{date} at {{location}}';
      
      const event = createMockEvent('Invalid Template', invalidTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBeNull();
      expect(body.validationErrors.length).toBeGreaterThan(0);
      expect(body.validationErrors.some((e: string) => e.includes('Mismatched braces'))).toBe(true);
    });

    it('should detect single braces', async () => {
      const invalidTemplate = 'Meeting on {date} at {{location}}';
      
      const event = createMockEvent('Invalid Template', invalidTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBeNull();
      expect(body.validationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Template Storage', () => {
    it('should store valid template in DynamoDB', async () => {
      const validTemplate = 'Meeting on {{date}} at {{location}}';
      
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent('Test Template', validTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.templateId).toBe('default');
      expect(body.validationErrors).toEqual([]);
      
      // Verify PutCommand was called
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should handle DynamoDB errors', async () => {
      const validTemplate = 'Meeting on {{date}}';
      
      ddbMock.on(PutCommand).rejects(new Error('DynamoDB error'));

      const event = createMockEvent('Test Template', validTemplate);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('SAVE_TEMPLATE_FAILED');
      expect(body.error.retryable).toBe(true);
    });
  });

  /**
   * Property-Based Test
   * Feature: template-based-meeting-reports, Property 1: Template validation consistency
   * Validates: Requirements 1.4
   * 
   * For any template string, the validation function should correctly identify 
   * whether all placeholders follow the {{placeholder_name}} format
   */
  describe('Property 1: Template validation consistency', () => {
    it('should correctly validate templates with valid placeholders', () => {
      // Generator for valid placeholder names (alphanumeric and underscore)
      const validPlaceholderName = fc.stringMatching(/^[a-zA-Z0-9_]+$/);
      
      // Generator for safe text (no braces)
      const safeText = fc.string().filter((s: string) => !s.includes('{') && !s.includes('}'));
      
      // Generator for templates with valid placeholders
      const validTemplateArbitrary = fc.array(
        fc.tuple(
          safeText, // text before placeholder (no braces)
          validPlaceholderName // placeholder name
        ),
        { minLength: 0, maxLength: 10 }
      ).map(parts => {
        let template = '';
        for (const [text, placeholder] of parts) {
          template += text + `{{${placeholder}}}`;
        }
        return template;
      });

      fc.assert(
        fc.property(validTemplateArbitrary, (template) => {
          const errors = validateTemplateSyntax(template);
          // Valid templates should have no validation errors
          expect(errors).toEqual([]);
        }),
        { numRuns: 100 }
      );
    });

    it('should detect templates with empty placeholders', () => {
      // Generator for templates with at least one empty placeholder
      // Use strings that don't contain braces to avoid interference
      const safeString = fc.string().filter((s: string) => !s.includes('{') && !s.includes('}'));
      const templateWithEmptyPlaceholder = fc.tuple(
        safeString,
        safeString
      ).map(([before, after]) => `${before}{{}}${after}`);

      fc.assert(
        fc.property(templateWithEmptyPlaceholder, (template) => {
          const errors = validateTemplateSyntax(template);
          // Should detect empty placeholder
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e: string) => e.includes('Empty placeholder'))).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should detect templates with invalid placeholder characters', () => {
      // Generator for invalid placeholder names (containing special characters)
      const invalidPlaceholderName = fc.array(
        fc.constantFrom('-', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', ' '),
        { minLength: 1, maxLength: 10 }
      ).map(chars => chars.join(''));
      
      const templateWithInvalidPlaceholder = fc.tuple(
        fc.string(),
        invalidPlaceholderName,
        fc.string()
      ).map(([before, placeholder, after]) => `${before}{{${placeholder}}}${after}`);

      fc.assert(
        fc.property(templateWithInvalidPlaceholder, (template) => {
          const errors = validateTemplateSyntax(template);
          // Should detect invalid characters
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should detect templates with mismatched braces', () => {
      // Generator for templates with mismatched braces
      const templateWithMismatchedBraces = fc.oneof(
        // More opening than closing
        fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}{{${b}`),
        // More closing than opening
        fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}}}${b}`),
        // Single opening brace
        fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}{${b}`),
        // Single closing brace
        fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}}${b}`)
      );

      fc.assert(
        fc.property(templateWithMismatchedBraces, (template) => {
          const errors = validateTemplateSyntax(template);
          // Should detect brace issues
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});
