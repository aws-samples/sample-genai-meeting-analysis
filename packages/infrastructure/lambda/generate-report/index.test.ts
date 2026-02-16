import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Set up environment variables
process.env.MEETINGS_TABLE = 'test-meetings-table';
process.env.TRANSCRIPT_SEGMENTS_TABLE = 'test-transcript-segments-table';
process.env.REPORT_TEMPLATES_TABLE = 'test-report-templates-table';
process.env.MEETING_REPORTS_TABLE = 'test-meeting-reports-table';
process.env.BEDROCK_MODEL_ID = 'amazon.nova-pro-v1:0';

// Create mocks
const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);

// Import handler after mocks are set up
import { handler } from './index';

describe('Generate Report Lambda - Property Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
    bedrockMock.reset();
  });

  /**
   * Feature: template-based-meeting-reports, Property 3: Metadata extraction completeness
   * 
   * For any transcript containing date, location, participants, or company details,
   * the extraction should identify and extract those fields when they are present
   * 
   * Validates: Requirements 2.2
   */
  test('Property 3: Metadata extraction completeness', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary metadata fields
        fc.record({
          date: fc.option(fc.date().map(d => d.toISOString().split('T')[0]), { nil: undefined }),
          location: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
          participants: fc.option(
            fc.array(fc.string({ minLength: 3, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
            { nil: undefined }
          ),
          company: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
        }),
        async (metadata) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Build transcript that contains the metadata
          const transcriptSegments: any[] = [];
          let startTime = 0;

          if (metadata.date) {
            transcriptSegments.push({
              meetingId: 'test-meeting',
              startTime,
              endTime: startTime + 5000,
              speakerLabel: 'spk_0',
              text: `This meeting is scheduled for ${metadata.date}`,
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            });
            startTime += 5000;
          }

          if (metadata.location) {
            transcriptSegments.push({
              meetingId: 'test-meeting',
              startTime,
              endTime: startTime + 5000,
              speakerLabel: 'spk_0',
              text: `We are meeting at ${metadata.location}`,
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            });
            startTime += 5000;
          }

          if (metadata.participants) {
            transcriptSegments.push({
              meetingId: 'test-meeting',
              startTime,
              endTime: startTime + 5000,
              speakerLabel: 'spk_0',
              text: `Participants include ${metadata.participants.join(', ')}`,
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            });
            startTime += 5000;
          }

          if (metadata.company) {
            transcriptSegments.push({
              meetingId: 'test-meeting',
              startTime,
              endTime: startTime + 5000,
              speakerLabel: 'spk_0',
              text: `This is a meeting for ${metadata.company}`,
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            });
            startTime += 5000;
          }

          // If no metadata, add a generic segment
          if (transcriptSegments.length === 0) {
            transcriptSegments.push({
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 5000,
              speakerLabel: 'spk_0',
              text: 'This is a generic meeting discussion',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            });
          }

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent: '{{meeting_date}} {{meeting_location}} {{participants}} {{company_name}}',
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: transcriptSegments,
          });

          ddbMock.on(PutCommand).resolves({});

          // Mock Bedrock extraction response
          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders: {
                        meeting_date: metadata.date ? {
                          value: metadata.date,
                          citation: { startTime: 0, endTime: 5000 },
                        } : { value: 'UNFILLED', citation: { startTime: 0, endTime: 0 } },
                        meeting_location: metadata.location ? {
                          value: metadata.location,
                          citation: { startTime: 5000, endTime: 10000 },
                        } : { value: 'UNFILLED', citation: { startTime: 0, endTime: 0 } },
                        participants: metadata.participants ? {
                          value: metadata.participants.join(', '),
                          citation: { startTime: 10000, endTime: 15000 },
                        } : { value: 'UNFILLED', citation: { startTime: 0, endTime: 0 } },
                        company_name: metadata.company ? {
                          value: metadata.company,
                          citation: { startTime: 15000, endTime: 20000 },
                        } : { value: 'UNFILLED', citation: { startTime: 0, endTime: 0 } },
                      },
                      agendaPoints: [],
                    }),
                  }],
                },
              },
            }))),
          } as any);

          // Call handler
          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored with correct extraction
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();
          expect(storedReport.extractedData.placeholders).toBeDefined();

          // Verify that metadata fields present in transcript were extracted
          if (metadata.date) {
            expect(storedReport.extractedData.placeholders.meeting_date.value).toBe(metadata.date);
          }
          if (metadata.location) {
            expect(storedReport.extractedData.placeholders.meeting_location.value).toBe(metadata.location);
          }
          if (metadata.participants) {
            expect(storedReport.extractedData.placeholders.participants.value).toBe(metadata.participants.join(', '));
          }
          if (metadata.company) {
            expect(storedReport.extractedData.placeholders.company_name.value).toBe(metadata.company);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 4: Placeholder extraction coverage
   * 
   * For any template with placeholders and any transcript, the system should
   * attempt to extract a value for each placeholder
   * 
   * Validates: Requirements 2.3
   */
  test('Property 4: Placeholder extraction coverage', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary placeholders
        fc.array(
          fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-z_]+$/.test(s)),
          { minLength: 1, maxLength: 10 }
        ).map(arr => [...new Set(arr)]), // Remove duplicates
        async (placeholderNames) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Build template with placeholders
          const templateContent = placeholderNames.map(name => `{{${name}}}`).join(' ');

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent,
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 5000,
              speakerLabel: 'spk_0',
              text: 'Test transcript content',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Mock Bedrock to return extraction for all placeholders
          const placeholders: any = {};
          placeholderNames.forEach(name => {
            placeholders[name] = {
              value: `extracted_${name}`,
              citation: { startTime: 0, endTime: 5000 },
            };
          });

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders,
                      agendaPoints: [],
                    }),
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored with all placeholders
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();
          expect(storedReport.extractedData.placeholders).toBeDefined();

          // Verify all placeholders were attempted for extraction
          for (const name of placeholderNames) {
            expect(storedReport.extractedData.placeholders).toHaveProperty(name);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 5, 8, 9: Citation completeness
   * 
   * For any extracted placeholder value, agenda point, or decision,
   * there should be an associated citation with valid startTime and endTime
   * 
   * Validates: Requirements 2.4, 3.3, 3.4
   */
  test('Property 5, 8, 9: Citation completeness for placeholders, agenda points, and decisions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          placeholderCount: fc.integer({ min: 1, max: 5 }),
          agendaPointCount: fc.integer({ min: 0, max: 5 }),
        }),
        async ({ placeholderCount, agendaPointCount }) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Build template with the placeholders we'll generate
          const templatePlaceholders = [];
          for (let i = 0; i < placeholderCount; i++) {
            templatePlaceholders.push(`{{placeholder_${i}}}`);
          }
          const templateContent = templatePlaceholders.join(' ');

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent,
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 100000,
              speakerLabel: 'spk_0',
              text: 'Test transcript',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Generate placeholders with citations
          const placeholders: any = {};
          for (let i = 0; i < placeholderCount; i++) {
            placeholders[`placeholder_${i}`] = {
              value: `value_${i}`,
              citation: {
                startTime: i * 1000,
                endTime: (i * 1000) + 500,  // Ensure endTime > startTime
              },
            };
          }

          // Generate agenda points with citations
          const agendaPoints: any[] = [];
          for (let i = 0; i < agendaPointCount; i++) {
            agendaPoints.push({
              point: `Agenda point ${i}`,
              citation: {
                startTime: i * 2000,
                endTime: (i * 2000) + 1000,
              },
              decision: `Decision ${i}`,
              decisionCitation: {
                startTime: (i * 2000) + 1000,
                endTime: (i + 1) * 2000,
              },
            });
          }

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders,
                      agendaPoints,
                    }),
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored with citations
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();

          // Verify all placeholders have valid citations
          for (const [, value] of Object.entries(storedReport.extractedData.placeholders)) {
            const placeholder = value as any;
            expect(placeholder.citation).toBeDefined();
            expect(typeof placeholder.citation.startTime).toBe('number');
            expect(typeof placeholder.citation.endTime).toBe('number');
            expect(placeholder.citation.startTime).toBeGreaterThanOrEqual(0);
            expect(placeholder.citation.endTime).toBeGreaterThan(placeholder.citation.startTime);
          }

          // Verify all agenda points have valid citations
          for (const agendaPoint of storedReport.extractedData.agendaPoints) {
            expect(agendaPoint.citation).toBeDefined();
            expect(typeof agendaPoint.citation.startTime).toBe('number');
            expect(typeof agendaPoint.citation.endTime).toBe('number');
            expect(agendaPoint.citation.startTime).toBeGreaterThanOrEqual(0);
            expect(agendaPoint.citation.endTime).toBeGreaterThan(agendaPoint.citation.startTime);

            // Verify decision citations
            expect(agendaPoint.decisionCitation).toBeDefined();
            expect(typeof agendaPoint.decisionCitation.startTime).toBe('number');
            expect(typeof agendaPoint.decisionCitation.endTime).toBe('number');
            expect(agendaPoint.decisionCitation.startTime).toBeGreaterThanOrEqual(0);
            expect(agendaPoint.decisionCitation.endTime).toBeGreaterThan(agendaPoint.decisionCitation.startTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 6: Unfilled placeholder marking
   * 
   * For any placeholder that cannot be filled from the transcript, it should be
   * marked as unfilled in the report data
   * 
   * Validates: Requirements 2.5
   */
  test('Property 6: Unfilled placeholder marking', async () => {
    // Reserved JavaScript property names that should be excluded
    const reservedNames = new Set([
      '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
      'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
      'toLocaleString', '__defineGetter__', '__defineSetter__',
      '__lookupGetter__', '__lookupSetter__'
    ]);

    await fc.assert(
      fc.asyncProperty(
        // Generate a set of placeholders, some will be filled, some unfilled
        fc.record({
          filledPlaceholders: fc.array(
            fc.string({ minLength: 3, maxLength: 20 })
              .filter(s => /^[a-z_]+$/.test(s) && !reservedNames.has(s)),
            { minLength: 0, maxLength: 5 }
          ).map(arr => [...new Set(arr)]), // Remove duplicates
          unfilledPlaceholders: fc.array(
            fc.string({ minLength: 3, maxLength: 20 })
              .filter(s => /^[a-z_]+$/.test(s) && !reservedNames.has(s)),
            { minLength: 1, maxLength: 5 }
          ).map(arr => [...new Set(arr)]), // Remove duplicates
        }).chain(({ filledPlaceholders, unfilledPlaceholders }) => {
          // Ensure no overlap between filled and unfilled
          const filledSet = new Set(filledPlaceholders);
          const uniqueUnfilled = unfilledPlaceholders.filter(p => !filledSet.has(p));
          
          // If all unfilled were duplicates, add at least one unique unfilled
          if (uniqueUnfilled.length === 0) {
            uniqueUnfilled.push('unique_unfilled_placeholder');
          }
          
          return fc.constant({
            filledPlaceholders,
            unfilledPlaceholders: uniqueUnfilled,
          });
        }),
        async ({ filledPlaceholders, unfilledPlaceholders }) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Build template with all placeholders (filled and unfilled)
          const allPlaceholders = [...filledPlaceholders, ...unfilledPlaceholders];
          const templateContent = allPlaceholders.map(name => `{{${name}}}`).join(' ');

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent,
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 5000,
              speakerLabel: 'spk_0',
              text: 'Test transcript content',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Mock Bedrock to return extraction for only filled placeholders
          const placeholders: any = {};
          
          // Add filled placeholders with values
          filledPlaceholders.forEach((name, index) => {
            placeholders[name] = {
              value: `extracted_value_${index}`,
              citation: { startTime: index * 1000, endTime: (index * 1000) + 500 },
            };
          });
          
          // Add unfilled placeholders marked as UNFILLED
          unfilledPlaceholders.forEach(name => {
            placeholders[name] = {
              value: 'UNFILLED',
              citation: { startTime: 0, endTime: 0 },
            };
          });

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders,
                      agendaPoints: [],
                    }),
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();
          expect(storedReport.extractedData.placeholders).toBeDefined();

          // Property: All unfilled placeholders should be marked with isFilled: false
          for (const unfilledName of unfilledPlaceholders) {
            expect(storedReport.extractedData.placeholders).toHaveProperty(unfilledName);
            const placeholder = storedReport.extractedData.placeholders[unfilledName];
            expect(placeholder.isFilled).toBe(false);
            expect(placeholder.value).toBe('');
          }

          // Property: All filled placeholders should be marked with isFilled: true
          for (const filledName of filledPlaceholders) {
            expect(storedReport.extractedData.placeholders).toHaveProperty(filledName);
            const placeholder = storedReport.extractedData.placeholders[filledName];
            expect(placeholder.isFilled).toBe(true);
            expect(placeholder.value).not.toBe('');
          }

          // Property: Unfilled placeholders should appear in report content with [UNFILLED: name] marker
          for (const unfilledName of unfilledPlaceholders) {
            expect(storedReport.reportContent).toContain(`[UNFILLED: ${unfilledName}]`);
          }

          // Property: Filled placeholders should NOT appear with [UNFILLED: name] marker
          for (const filledName of filledPlaceholders) {
            expect(storedReport.reportContent).not.toContain(`[UNFILLED: ${filledName}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 7: Agenda-decision pairing
   * 
   * For any identified agenda point, there should be an associated decision text
   * 
   * Validates: Requirements 3.2
   */
  test('Property 7: Agenda-decision pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary number of agenda points
        fc.integer({ min: 1, max: 10 }),
        async (agendaPointCount) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent: '{{agenda_points}}',
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 100000,
              speakerLabel: 'spk_0',
              text: 'Test transcript with agenda items',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Generate agenda points with decisions
          const agendaPoints: any[] = [];
          for (let i = 0; i < agendaPointCount; i++) {
            agendaPoints.push({
              point: `Agenda point ${i}`,
              citation: {
                startTime: i * 2000,
                endTime: (i * 2000) + 1000,
              },
              decision: `Decision for agenda point ${i}`,
              decisionCitation: {
                startTime: (i * 2000) + 1000,
                endTime: (i + 1) * 2000,
              },
            });
          }

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders: {},
                      agendaPoints,
                    }),
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();
          expect(storedReport.extractedData.agendaPoints).toBeDefined();

          // Property: For any identified agenda point, there should be an associated decision text
          for (const agendaPoint of storedReport.extractedData.agendaPoints) {
            expect(agendaPoint.decision).toBeDefined();
            expect(typeof agendaPoint.decision).toBe('string');
            expect(agendaPoint.decision.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 10: Template format preservation
   * 
   * For any template structure and extracted agenda points/decisions, the formatted
   * output should preserve the template's structural elements
   * 
   * Validates: Requirements 3.5
   */
  test('Property 10: Template format preservation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Generate template with structural elements
          headerLevel: fc.constantFrom('#', '##', '###'),
          // Filter out strings containing placeholder delimiters to avoid malformed templates
          beforeText: fc.string({ minLength: 5, maxLength: 50 }).filter(s => !s.includes('{{') && !s.includes('}}')),
          afterText: fc.string({ minLength: 5, maxLength: 50 }).filter(s => !s.includes('{{') && !s.includes('}}')),
          hasPlaceholder: fc.boolean(),
          placeholderName: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-z_]+$/.test(s)),
          agendaPointCount: fc.integer({ min: 1, max: 5 }),
        }),
        async ({ headerLevel, beforeText, afterText, hasPlaceholder, placeholderName, agendaPointCount }) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Build template with structural elements
          let templateContent = `${headerLevel} Meeting Report\n\n`;
          templateContent += `${beforeText}\n\n`;
          
          if (hasPlaceholder) {
            templateContent += `**Info:** {{${placeholderName}}}\n\n`;
          }
          
          templateContent += `${headerLevel}# Agenda Items\n\n`;
          templateContent += `{{agenda_points}}\n\n`;
          templateContent += `${afterText}`;

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent,
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 100000,
              speakerLabel: 'spk_0',
              text: 'Test transcript with agenda items',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Generate agenda points with decisions
          const agendaPoints: any[] = [];
          for (let i = 0; i < agendaPointCount; i++) {
            agendaPoints.push({
              point: `Agenda point ${i}`,
              citation: {
                startTime: i * 2000,
                endTime: (i * 2000) + 1000,
              },
              decision: `Decision for agenda point ${i}`,
              decisionCitation: {
                startTime: (i * 2000) + 1000,
                endTime: (i + 1) * 2000,
              },
            });
          }

          // Generate placeholder extraction
          const placeholders: any = {};
          if (hasPlaceholder) {
            placeholders[placeholderName] = {
              value: 'Extracted value',
              citation: { startTime: 0, endTime: 1000 },
            };
          }

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      placeholders,
                      agendaPoints,
                    }),
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.reportContent).toBeDefined();

          const reportContent = storedReport.reportContent;

          // Property: Template structural elements should be preserved
          
          // 1. Header should be preserved
          expect(reportContent).toContain(`${headerLevel} Meeting Report`);
          
          // 2. Before text should be preserved
          expect(reportContent).toContain(beforeText);
          
          // 3. After text should be preserved
          expect(reportContent).toContain(afterText);
          
          // 4. Agenda section header should be preserved
          expect(reportContent).toContain(`${headerLevel}# Agenda Items`);
          
          // 5. If placeholder exists, the bold formatting should be preserved
          if (hasPlaceholder) {
            expect(reportContent).toContain('**Info:**');
          }
          
          // 6. Agenda points should be formatted with the expected structure
          // The formatAgendaPoints function formats as: ### N. {point}\n\n**Decision:** {decision}
          for (let i = 0; i < agendaPointCount; i++) {
            expect(reportContent).toContain(`### ${i + 1}. Agenda point ${i}`);
            expect(reportContent).toContain(`**Decision:** Decision for agenda point ${i}`);
          }
          
          // 7. Verify that the template structure is maintained (not just content)
          // The order should be: header -> beforeText -> placeholder -> agenda header -> agenda points -> afterText
          const headerIndex = reportContent.indexOf(`${headerLevel} Meeting Report`);
          const beforeTextIndex = reportContent.indexOf(beforeText);
          const agendaHeaderIndex = reportContent.indexOf(`${headerLevel}# Agenda Items`);
          const afterTextIndex = reportContent.lastIndexOf(afterText);
          
          expect(headerIndex).toBeGreaterThanOrEqual(0);
          expect(beforeTextIndex).toBeGreaterThan(headerIndex);
          expect(agendaHeaderIndex).toBeGreaterThan(beforeTextIndex);
          expect(afterTextIndex).toBeGreaterThan(agendaHeaderIndex);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Feature: template-based-meeting-reports, Property 24: LLM response parsing completeness
   * 
   * For any LLM response, the parsed result should contain both extracted content
   * and citation metadata for all extracted items
   * 
   * Validates: Requirements 8.5
   */
  test('Property 24: LLM response parsing completeness', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Generate arbitrary placeholders with values and citations
          placeholderCount: fc.integer({ min: 1, max: 10 }),
          agendaPointCount: fc.integer({ min: 0, max: 10 }),
          // Test different response formats: plain JSON, JSON in markdown code blocks
          useMarkdownCodeBlock: fc.boolean(),
          codeBlockLanguage: fc.constantFrom('json', ''), // with or without language specifier
        }),
        async ({ placeholderCount, agendaPointCount, useMarkdownCodeBlock, codeBlockLanguage }) => {
          // Reset mocks for each iteration
          ddbMock.reset();
          bedrockMock.reset();
          
          // Generate placeholders with citations
          const placeholders: any = {};
          const placeholderNames: string[] = [];
          
          for (let i = 0; i < placeholderCount; i++) {
            const name = `placeholder_${i}`;
            placeholderNames.push(name);
            placeholders[name] = {
              value: `extracted_value_${i}`,
              citation: {
                startTime: i * 1000,
                endTime: (i * 1000) + 500,
              },
            };
          }

          // Generate agenda points with citations
          const agendaPoints: any[] = [];
          for (let i = 0; i < agendaPointCount; i++) {
            agendaPoints.push({
              point: `Agenda point ${i}`,
              citation: {
                startTime: i * 2000,
                endTime: (i * 2000) + 1000,
              },
              decision: `Decision ${i}`,
              decisionCitation: {
                startTime: (i * 2000) + 1000,
                endTime: (i + 1) * 2000,
              },
            });
          }

          // Build the extraction response
          const extractionResponse = {
            placeholders,
            agendaPoints,
          };

          // Format the response based on whether we're using markdown code blocks
          let responseText = JSON.stringify(extractionResponse, null, 2);
          
          if (useMarkdownCodeBlock) {
            const langSpec = codeBlockLanguage ? codeBlockLanguage : '';
            responseText = `\`\`\`${langSpec}\n${responseText}\n\`\`\``;
          }

          // Build template with the placeholders
          const templateContent = placeholderNames.map(name => `{{${name}}}`).join(' ') + ' {{agenda_points}}';

          // Mock DynamoDB responses
          ddbMock.on(GetCommand).resolves({
            Item: {
              userId: 'test-user',
              templateId: 'default',
              templateName: 'Test Template',
              templateContent,
              createdAt: Date.now(),
            },
          });

          ddbMock.on(QueryCommand).resolves({
            Items: [{
              meetingId: 'test-meeting',
              startTime: 0,
              endTime: 100000,
              speakerLabel: 'spk_0',
              text: 'Test transcript content',
              languageCode: 'en-US',
              confidence: 0.95,
              words: [],
            }],
          });

          ddbMock.on(PutCommand).resolves({});

          // Mock Bedrock response with the formatted text
          bedrockMock.on(InvokeModelCommand).resolves({
            body: new Uint8Array(Buffer.from(JSON.stringify({
              output: {
                message: {
                  content: [{
                    text: responseText,
                  }],
                },
              },
            }))),
          } as any);

          const event = {
            meetingId: 'test-meeting',
            userId: 'test-user',
            templateId: 'default',
          };

          await handler(event);

          // Verify that the report was stored
          const putCalls = ddbMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);
          
          const storedReport = putCalls[0].args[0].input.Item as any;
          expect(storedReport).toBeDefined();
          expect(storedReport.extractedData).toBeDefined();

          // Property: The parsed result should contain both extracted content and citation metadata
          
          // 1. All placeholders should be present in the parsed result
          expect(storedReport.extractedData.placeholders).toBeDefined();
          expect(Object.keys(storedReport.extractedData.placeholders).length).toBe(placeholderCount);

          // 2. Each placeholder should have both content (value) and citation metadata
          for (const name of placeholderNames) {
            const placeholder = storedReport.extractedData.placeholders[name];
            expect(placeholder).toBeDefined();
            
            // Content should be present
            expect(placeholder.value).toBeDefined();
            expect(typeof placeholder.value).toBe('string');
            
            // Citation metadata should be present
            expect(placeholder.citation).toBeDefined();
            expect(typeof placeholder.citation.startTime).toBe('number');
            expect(typeof placeholder.citation.endTime).toBe('number');
            expect(placeholder.citation.startTime).toBeGreaterThanOrEqual(0);
            expect(placeholder.citation.endTime).toBeGreaterThan(placeholder.citation.startTime);
          }

          // 3. All agenda points should be present in the parsed result
          expect(storedReport.extractedData.agendaPoints).toBeDefined();
          expect(Array.isArray(storedReport.extractedData.agendaPoints)).toBe(true);
          expect(storedReport.extractedData.agendaPoints.length).toBe(agendaPointCount);

          // 4. Each agenda point should have both content and citation metadata
          for (let i = 0; i < agendaPointCount; i++) {
            const agendaPoint = storedReport.extractedData.agendaPoints[i];
            expect(agendaPoint).toBeDefined();
            
            // Agenda point content should be present
            expect(agendaPoint.point).toBeDefined();
            expect(typeof agendaPoint.point).toBe('string');
            expect(agendaPoint.point.length).toBeGreaterThan(0);
            
            // Agenda point citation metadata should be present
            expect(agendaPoint.citation).toBeDefined();
            expect(typeof agendaPoint.citation.startTime).toBe('number');
            expect(typeof agendaPoint.citation.endTime).toBe('number');
            expect(agendaPoint.citation.startTime).toBeGreaterThanOrEqual(0);
            expect(agendaPoint.citation.endTime).toBeGreaterThan(agendaPoint.citation.startTime);
            
            // Decision content should be present
            expect(agendaPoint.decision).toBeDefined();
            expect(typeof agendaPoint.decision).toBe('string');
            expect(agendaPoint.decision.length).toBeGreaterThan(0);
            
            // Decision citation metadata should be present
            expect(agendaPoint.decisionCitation).toBeDefined();
            expect(typeof agendaPoint.decisionCitation.startTime).toBe('number');
            expect(typeof agendaPoint.decisionCitation.endTime).toBe('number');
            expect(agendaPoint.decisionCitation.startTime).toBeGreaterThanOrEqual(0);
            expect(agendaPoint.decisionCitation.endTime).toBeGreaterThan(agendaPoint.decisionCitation.startTime);
          }

          // 5. Verify that the parser handles different response formats correctly
          // (plain JSON vs markdown code blocks) - this is implicit in the test passing
          // since we vary the format and expect the same structured output
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
