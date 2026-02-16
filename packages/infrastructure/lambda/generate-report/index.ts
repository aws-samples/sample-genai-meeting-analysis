import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { generateCorrelationId, logWithContext, getUserIdFromEvent } from '../shared/utils';
import { createSuccessResponse, createErrorResponse } from '../shared/types';
import { TranscriptSegmentItem, ReportTemplateItem, MeetingReportItem } from '@meeting-platform/shared';
import { getDefaultReportTemplate } from '../shared/report-template';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockRuntimeClient = new BedrockRuntimeClient({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const TRANSCRIPT_SEGMENTS_TABLE = process.env.TRANSCRIPT_SEGMENTS_TABLE!;
const REPORT_TEMPLATES_TABLE = process.env.REPORT_TEMPLATES_TABLE!;
const MEETING_REPORTS_TABLE = process.env.MEETING_REPORTS_TABLE!;
const DEFAULT_BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

/**
 * Retrieve user's report template from DynamoDB
 */
async function getReportTemplate(
  userId: string,
  templateId: string,
  correlationId: string
): Promise<ReportTemplateItem> {
  logWithContext(correlationId, 'INFO', 'Retrieving report template', { userId, templateId });

  const getCommand = new GetCommand({
    TableName: REPORT_TEMPLATES_TABLE,
    Key: {
      userId,
      templateId,
    },
  });

  const result = await docClient.send(getCommand);

  if (!result.Item) {
    // Return default template if none exists
    logWithContext(correlationId, 'INFO', 'No custom template found, using default', { userId });
    return {
      userId,
      templateId: 'default',
      templateName: 'Default Meeting Report',
      templateContent: getDefaultReportTemplate(),
      createdAt: Date.now(),
    };
  }

  logWithContext(correlationId, 'INFO', 'Report template retrieved', {
    userId,
    templateId,
    templateName: result.Item.templateName,
  });

  return result.Item as ReportTemplateItem;
}

/**
 * Retrieve transcript segments from DynamoDB
 */
async function retrieveTranscriptSegments(
  meetingId: string,
  correlationId: string
): Promise<TranscriptSegmentItem[]> {
  logWithContext(correlationId, 'INFO', 'Retrieving transcript segments', { meetingId });

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
 * Extract placeholder names from template
 * Matches patterns like {{placeholder_name}}
 */
function extractPlaceholderNames(templateContent: string): string[] {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const placeholders: string[] = [];
  let match;

  while ((match = placeholderRegex.exec(templateContent)) !== null) {
    const placeholderName = match[1].trim();
    if (!placeholders.includes(placeholderName)) {
      placeholders.push(placeholderName);
    }
  }

  return placeholders;
}

/**
 * Format transcript segments for LLM consumption
 */
function formatTranscriptForExtraction(segments: TranscriptSegmentItem[]): string {
  const lines: string[] = [];

  for (const segment of segments) {
    const speakerName = segment.speakerName || segment.speakerLabel;
    const startMs = segment.startTime;
    const endMs = segment.endTime;
    
    lines.push(`[${startMs}-${endMs}ms] ${speakerName}: ${segment.text}`);
  }

  return lines.join('\n\n');
}

/**
 * Build structured prompt for Bedrock extraction
 */
function buildExtractionPrompt(
  templateContent: string,
  placeholders: string[],
  formattedTranscript: string
): string {
  return `You are a meeting report assistant. Extract information from the meeting transcript to populate a report template.

TEMPLATE:
${templateContent}

TRANSCRIPT:
${formattedTranscript}

INSTRUCTIONS:
1. Extract values for these placeholders: ${placeholders.join(', ')}
2. Identify all agenda points discussed in the meeting
3. For each agenda point, extract the associated decision
4. For EVERY extracted piece of information, provide the timestamp (in milliseconds) from the transcript where it was found
5. If a placeholder cannot be filled, mark it as "UNFILLED"

OUTPUT FORMAT (JSON):
{
  "placeholders": {
    "placeholder_name": {
      "value": "extracted value",
      "citation": {
        "startTime": 12000,
        "endTime": 15000
      }
    }
  },
  "agendaPoints": [
    {
      "point": "Agenda item text",
      "citation": {
        "startTime": 20000,
        "endTime": 25000
      },
      "decision": "Decision text",
      "decisionCitation": {
        "startTime": 24000,
        "endTime": 27000
      }
    }
  ]
}

Respond ONLY with valid JSON. Do not include any explanatory text before or after the JSON.`;
}

/**
 * Bedrock extraction response structure
 */
interface BedrockExtractionResponse {
  placeholders: Record<string, {
    value: string;
    citation: {
      startTime: number;
      endTime: number;
    };
  }>;
  agendaPoints: Array<{
    point: string;
    citation: {
      startTime: number;
      endTime: number;
    };
    decision: string;
    decisionCitation: {
      startTime: number;
      endTime: number;
    };
  }>;
}

/**
 * Bedrock extraction result with token usage
 */
interface BedrockExtractionResult {
  data: BedrockExtractionResponse;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Call Amazon Bedrock to extract information from transcript
 */
async function extractWithBedrock(
  extractionPrompt: string,
  modelId: string,
  correlationId: string,
  retryCount: number = 0
): Promise<BedrockExtractionResult> {
  const MAX_RETRIES = 3;

  logWithContext(correlationId, 'INFO', 'Calling Bedrock for information extraction', {
    modelId,
    promptLength: extractionPrompt.length,
    retryCount,
  });

  // Determine if using Nova or Claude model
  const isNovaModel = modelId.includes('nova');
  
  // Prepare request body based on model type
  const requestBody = isNovaModel
    ? {
        // Nova model format
        messages: [
          {
            role: 'user',
            content: [{ text: extractionPrompt }],
          },
        ],
        inferenceConfig: {
          max_new_tokens: 8192,
          temperature: 0.3,  // Lower temperature for more consistent extraction
        },
      }
    : {
        // Claude model format
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: extractionPrompt,
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

    // Extract content and token usage based on model type
    let extractedText: string;
    let tokenUsage: { inputTokens: number; outputTokens: number };
    
    if (isNovaModel) {
      // Nova response format
      if (!responseBody.output?.message?.content || responseBody.output.message.content.length === 0) {
        throw new Error('No content in Bedrock response');
      }
      extractedText = responseBody.output.message.content[0].text;
      
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
      extractedText = responseBody.content[0].text;
      
      // Extract token usage from Claude response
      tokenUsage = {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0,
      };
    }

    // Parse JSON response
    const extractionData = parseExtractionResponse(extractedText, correlationId);

    logWithContext(correlationId, 'INFO', 'Extraction completed successfully', {
      placeholderCount: Object.keys(extractionData.placeholders).length,
      agendaPointCount: extractionData.agendaPoints.length,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });

    return {
      data: extractionData,
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
      return extractWithBedrock(extractionPrompt, modelId, correlationId, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Parse extraction response from LLM
 * Handles cases where LLM includes markdown code blocks or extra text
 */
function parseExtractionResponse(
  responseText: string,
  correlationId: string
): BedrockExtractionResponse {
  logWithContext(correlationId, 'INFO', 'Parsing extraction response', {
    responseLength: responseText.length,
  });

  // Try to extract JSON from markdown code blocks if present
  let jsonText = responseText.trim();
  
  // Remove markdown code block markers if present
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);
    
    // Validate structure
    if (!parsed.placeholders || typeof parsed.placeholders !== 'object') {
      throw new Error('Invalid extraction response: missing or invalid placeholders');
    }
    
    if (!parsed.agendaPoints || !Array.isArray(parsed.agendaPoints)) {
      throw new Error('Invalid extraction response: missing or invalid agendaPoints');
    }

    // Validate citations in placeholders
    for (const [key, value] of Object.entries(parsed.placeholders)) {
      const placeholder = value as any;
      if (!placeholder.citation || 
          typeof placeholder.citation.startTime !== 'number' ||
          typeof placeholder.citation.endTime !== 'number') {
        logWithContext(correlationId, 'WARN', 'Invalid citation for placeholder', { key });
      }
    }

    // Validate citations in agenda points
    for (const agendaPoint of parsed.agendaPoints) {
      if (!agendaPoint.citation || 
          typeof agendaPoint.citation.startTime !== 'number' ||
          typeof agendaPoint.citation.endTime !== 'number') {
        logWithContext(correlationId, 'WARN', 'Invalid citation for agenda point', {
          point: agendaPoint.point,
        });
      }
      
      if (!agendaPoint.decisionCitation || 
          typeof agendaPoint.decisionCitation.startTime !== 'number' ||
          typeof agendaPoint.decisionCitation.endTime !== 'number') {
        logWithContext(correlationId, 'WARN', 'Invalid decision citation for agenda point', {
          point: agendaPoint.point,
        });
      }
    }

    return parsed as BedrockExtractionResponse;
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Failed to parse extraction response', {
      error: error.message,
      responsePreview: jsonText.substring(0, 200),
    });
    
    throw new Error(`Failed to parse LLM response as JSON: ${error.message}`);
  }
}

/**
 * Validate citation timestamps against transcript bounds
 */
function validateCitationTimestamps(
  extractionData: BedrockExtractionResponse,
  segments: TranscriptSegmentItem[],
  correlationId: string
): void {
  if (segments.length === 0) {
    return;
  }

  const minTime = segments[0].startTime;
  const maxTime = segments[segments.length - 1].endTime;

  logWithContext(correlationId, 'INFO', 'Validating citation timestamps', {
    minTime,
    maxTime,
  });

  // Validate placeholder citations
  for (const [key, value] of Object.entries(extractionData.placeholders)) {
    const citation = value.citation;
    if (citation.startTime < minTime || citation.endTime > maxTime) {
      logWithContext(correlationId, 'WARN', 'Citation timestamp out of bounds', {
        placeholder: key,
        citation,
        bounds: { minTime, maxTime },
      });
    }
  }

  // Validate agenda point citations
  for (const agendaPoint of extractionData.agendaPoints) {
    if (agendaPoint.citation.startTime < minTime || agendaPoint.citation.endTime > maxTime) {
      logWithContext(correlationId, 'WARN', 'Agenda point citation out of bounds', {
        point: agendaPoint.point,
        citation: agendaPoint.citation,
        bounds: { minTime, maxTime },
      });
    }
    
    if (agendaPoint.decisionCitation.startTime < minTime || 
        agendaPoint.decisionCitation.endTime > maxTime) {
      logWithContext(correlationId, 'WARN', 'Decision citation out of bounds', {
        point: agendaPoint.point,
        citation: agendaPoint.decisionCitation,
        bounds: { minTime, maxTime },
      });
    }
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
 * Populate template with extracted values
 * NOTE: We keep placeholders in the reportContent so the frontend can add citations
 */
function populateTemplate(
  templateContent: string,
  extractionData: BedrockExtractionResponse,
  allPlaceholders: string[],
  correlationId: string
): { reportContent: string; placeholders: Record<string, any> } {
  logWithContext(correlationId, 'INFO', 'Populating template', {
    totalPlaceholders: allPlaceholders.length,
    extractedPlaceholders: Object.keys(extractionData.placeholders).length,
  });

  // Keep the template content as-is with placeholders
  const reportContent = templateContent;
  const placeholders: Record<string, any> = {};

  // Process each placeholder (excluding agenda_points which is handled separately)
  for (const placeholderName of allPlaceholders) {
    // Skip agenda_points as it's handled separately with formatAgendaPoints
    if (placeholderName === 'agenda_points') {
      continue;
    }
    
    const extracted = extractionData.placeholders[placeholderName];
    
    if (extracted && extracted.value && extracted.value !== 'UNFILLED') {
      // Placeholder was filled
      placeholders[placeholderName] = {
        value: extracted.value,
        citation: extracted.citation,
        isFilled: true,
        isManuallyEdited: false,
        originalValue: extracted.value,
      };
    } else {
      // Placeholder was not filled - mark it
      placeholders[placeholderName] = {
        value: '',
        citation: { startTime: 0, endTime: 0 },
        isFilled: false,
        isManuallyEdited: false,
      };
    }
  }

  logWithContext(correlationId, 'INFO', 'Template populated', {
    filledCount: Object.values(placeholders).filter((p: any) => p.isFilled).length,
    unfilledCount: Object.values(placeholders).filter((p: any) => !p.isFilled).length,
  });

  return { reportContent, placeholders };
}

/**
 * Format agenda points and decisions
 */
function formatAgendaPoints(
  agendaPoints: BedrockExtractionResponse['agendaPoints'],
  correlationId: string
): string {
  logWithContext(correlationId, 'INFO', 'Formatting agenda points', {
    count: agendaPoints.length,
  });

  if (agendaPoints.length === 0) {
    return 'No agenda points identified.';
  }

  const formatted = agendaPoints.map((item, index) => {
    return `### ${index + 1}. ${item.point}\n\n**Decision:** ${item.decision}`;
  }).join('\n\n');

  return formatted;
}

/**
 * Store report in DynamoDB and update meeting reportStatus
 */
async function storeReport(
  meetingId: string,
  userId: string,
  templateId: string,
  reportContent: string,
  placeholders: Record<string, any>,
  agendaPoints: BedrockExtractionResponse['agendaPoints'],
  tokenUsage: { inputTokens: number; outputTokens: number },
  modelId: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Storing report in DynamoDB', {
    meetingId,
    reportLength: reportContent.length,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    modelId,
  });

  const reportItem: MeetingReportItem = {
    meetingId,
    reportId: 'latest',
    userId,
    templateId,
    reportContent,
    extractedData: {
      placeholders,
      agendaPoints,
    },
    generatedAt: Date.now(),
    status: 'completed',
    placeholderEditHistory: [],
  };

  const putCommand = new PutCommand({
    TableName: MEETING_REPORTS_TABLE,
    Item: reportItem,
  });

  await docClient.send(putCommand);

  logWithContext(correlationId, 'INFO', 'Report stored successfully', {
    meetingId,
    reportId: 'latest',
  });

  // Update meeting status to generating-word-report (next step in workflow)
  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET #status = :status, reportStatus = :reportStatus, reportTokenUsage = :tokenUsage',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'generating-word-report',
      ':reportStatus': 'completed',
      ':tokenUsage': {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        modelId,
      },
    },
  });

  await docClient.send(updateCommand);

  logWithContext(correlationId, 'INFO', 'Meeting status updated to generating-word-report, reportStatus to completed', {
    meetingId,
  });
}

/**
 * Update meeting reportStatus to failed
 */
async function updateReportStatusToFailed(
  meetingId: string,
  userId: string,
  errorMessage: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'ERROR', 'Updating report status to failed', {
    meetingId,
    errorMessage,
  });

  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET reportStatus = :reportStatus',
    ExpressionAttributeValues: {
      ':reportStatus': 'failed',
    },
  });

  await docClient.send(updateCommand);
}

/**
 * Lambda handler for generating meeting reports
 */
export const handler = async (event: any): Promise<any> => {
  // Detect if this is an API Gateway event or direct invocation
  const isApiGatewayEvent = event.requestContext && event.pathParameters;
  
  let meetingId: string;
  let userId: string;
  let templateId: string;
  let correlationId: string;

  if (isApiGatewayEvent) {
    correlationId = generateCorrelationId();
    
    logWithContext(correlationId, 'INFO', 'GenerateReportFunction invoked via API Gateway', {
      path: event.path,
      httpMethod: event.httpMethod,
    });

    try {
      userId = getUserIdFromEvent(event);
      meetingId = event.pathParameters?.id;
      
      if (!meetingId) {
        return createErrorResponse(400, {
          code: 'INVALID_REQUEST',
          message: 'Meeting ID is required',
          retryable: false,
        });
      }

      // Extract templateId from request body if provided
      templateId = 'default';
      if (event.body) {
        try {
          const body = JSON.parse(event.body);
          templateId = body.templateId || 'default';
        } catch (e) {
          // Ignore parse errors - use defaults
        }
      }

      logWithContext(correlationId, 'INFO', 'API Gateway request parsed', {
        meetingId,
        userId,
        templateId,
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
    // Direct invocation
    correlationId = event.correlationId || generateCorrelationId();
    meetingId = event.meetingId;
    userId = event.userId;
    templateId = event.templateId || 'default';

    logWithContext(correlationId, 'INFO', 'GenerateReportFunction invoked directly', {
      meetingId,
      userId,
      templateId,
    });
  }

  try {
    // Step 1: Retrieve user's template from DynamoDB
    const template = await getReportTemplate(userId, templateId, correlationId);

    // Step 2: Retrieve transcript segments from DynamoDB
    const segments = await retrieveTranscriptSegments(meetingId, correlationId);

    // Step 3: Extract placeholder names from template
    const placeholders = extractPlaceholderNames(template.templateContent);
    
    logWithContext(correlationId, 'INFO', 'Placeholders extracted from template', {
      placeholders,
      count: placeholders.length,
    });

    // Step 4: Build structured prompt for Bedrock
    const formattedTranscript = formatTranscriptForExtraction(segments);
    const extractionPrompt = buildExtractionPrompt(
      template.templateContent,
      placeholders,
      formattedTranscript
    );

    logWithContext(correlationId, 'INFO', 'Extraction prompt built', {
      promptLength: extractionPrompt.length,
      transcriptLength: formattedTranscript.length,
    });

    // Step 5: Call Bedrock to extract information
    const extractionResult = await extractWithBedrock(
      extractionPrompt,
      DEFAULT_BEDROCK_MODEL_ID,
      correlationId
    );

    // Step 6: Validate citation timestamps
    validateCitationTimestamps(extractionResult.data, segments, correlationId);

    // Step 7: Populate template with extracted values
    const { reportContent: populatedContent, placeholders: finalPlaceholders } = 
      populateTemplate(template.templateContent, extractionResult.data, placeholders, correlationId);

    // Step 8: Format agenda points
    const formattedAgenda = formatAgendaPoints(extractionResult.data.agendaPoints, correlationId);

    // Replace agenda_points placeholder if it exists
    let finalReportContent = populatedContent;
    if (finalReportContent.includes('{{agenda_points}}')) {
      finalReportContent = finalReportContent.replace(/\{\{agenda_points\}\}/g, formattedAgenda);
    }

    // Replace unfilled placeholders with [UNFILLED: name] markers
    for (const [name, placeholder] of Object.entries(finalPlaceholders)) {
      const placeholderData = placeholder as any;
      if (!placeholderData.isFilled) {
        const regex = new RegExp(`\\{\\{${name}\\}\\}`, 'g');
        finalReportContent = finalReportContent.replace(regex, `[UNFILLED: ${name}]`);
      }
    }

    // Step 9: Store report in DynamoDB
    await storeReport(
      meetingId,
      userId,
      templateId,
      finalReportContent,
      finalPlaceholders,
      extractionResult.data.agendaPoints,
      extractionResult.tokenUsage,
      DEFAULT_BEDROCK_MODEL_ID,
      correlationId
    );

    logWithContext(correlationId, 'INFO', 'GenerateReportFunction completed successfully', {
      meetingId,
      templateId,
      placeholderCount: placeholders.length,
      extractedPlaceholders: Object.keys(extractionResult.data.placeholders).length,
      agendaPoints: extractionResult.data.agendaPoints.length,
      inputTokens: extractionResult.tokenUsage.inputTokens,
      outputTokens: extractionResult.tokenUsage.outputTokens,
    });

    // Return appropriate response based on invocation type
    if (isApiGatewayEvent) {
      return createSuccessResponse({
        message: 'Report generation completed successfully',
        meetingId,
        reportId: 'latest',
      });
    }

    return {
      statusCode: 200,
      meetingId,
      userId,
      reportId: 'latest',
      status: 'completed',
    };
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'GenerateReportFunction failed', {
      meetingId,
      error: error.message,
      stack: error.stack,
    });

    // Update report status to failed
    try {
      await updateReportStatusToFailed(meetingId, userId, error.message, correlationId);
    } catch (updateError: any) {
      logWithContext(correlationId, 'ERROR', 'Failed to update report status to failed', {
        meetingId,
        error: updateError.message,
      });
    }

    if (isApiGatewayEvent) {
      return createErrorResponse(500, {
        code: 'REPORT_GENERATION_FAILED',
        message: 'Failed to generate report',
        details: error.message,
        retryable: true,
      });
    }

    throw error;
  }
};
