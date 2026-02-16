import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { generateCorrelationId, logWithContext } from '../shared/utils';
import { TranscriptSegmentItem, WordItem } from '@meeting-platform/shared';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const sfnClient = new SFNClient({});

const MEETINGS_TABLE = process.env.MEETINGS_TABLE!;
const TRANSCRIPT_SEGMENTS_TABLE = process.env.TRANSCRIPT_SEGMENTS_TABLE!;
const PROCESSING_STATE_MACHINE_ARN = process.env.PROCESSING_STATE_MACHINE_ARN!;

// Transcribe JSON output types
interface TranscribeSegmentItem {
  speaker_label: string;
  start_time: string;
  end_time: string;
}

interface TranscribeSegment {
  start_time: string;
  end_time: string;
  speaker_label: string;
  items: TranscribeSegmentItem[];
}

interface TranscribeItem {
  start_time?: string;
  end_time?: string;
  type: 'pronunciation' | 'punctuation';
  alternatives: Array<{
    content: string;
    confidence?: string;
  }>;
}

interface TranscribeLanguageIdentification {
  language_code: string;
  score: string;
}

interface TranscribeResult {
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items: TranscribeItem[];
    speaker_labels?: {
      segments: TranscribeSegment[];
      speakers: number;
      channel_label: string;
    };
    language_identification?: TranscribeLanguageIdentification[];
  };
}

/**
 * Extract word-level timestamps from Transcribe items array
 * Processes pronunciation items and attaches following punctuation
 * Converts timestamps from seconds to milliseconds
 * Includes confidence scores for each word
 */
export function extractWordLevelData(items: TranscribeItem[]): WordItem[] {
  const words: WordItem[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Only process pronunciation items
    if (item.type === 'pronunciation' && item.start_time && item.end_time) {
      let text = item.alternatives[0]?.content || '';
      
      // Check if next item is punctuation and attach it to this word
      if (i + 1 < items.length && items[i + 1].type === 'punctuation') {
        const punctuation = items[i + 1].alternatives[0]?.content || '';
        text += punctuation;
      }
      
      words.push({
        startTime: Math.round(parseFloat(item.start_time) * 1000),
        endTime: Math.round(parseFloat(item.end_time) * 1000),
        text,
        confidence: parseFloat(item.alternatives[0]?.confidence || '1.0'),
      });
    }
  }
  
  return words;
}

/**
 * Parse Transcribe JSON output and extract transcript segments
 */
export function parseTranscribeOutput(transcribeResult: TranscribeResult): TranscriptSegmentItem[] {
  const speakerLabels = transcribeResult.results.speaker_labels;
  
  // If speaker_labels exist (speaker diarization enabled), use them
  if (speakerLabels && speakerLabels.segments && speakerLabels.segments.length > 0) {
    return parseSegmentsWithDiarization(speakerLabels.segments, transcribeResult);
  }
  
  // Otherwise, create segments from items without speaker labels
  const items = transcribeResult.results.items;
  if (!items || items.length === 0) {
    throw new Error('No items found in Transcribe output');
  }
  
  return parseItemsWithoutDiarization(items, transcribeResult);
}

/**
 * Parse segments when speaker diarization is available
 */
function parseSegmentsWithDiarization(
  segments: TranscribeSegment[],
  transcribeResult: TranscribeResult
): TranscriptSegmentItem[] {
  const transcriptSegments: TranscriptSegmentItem[] = [];
  const allItems = transcribeResult.results.items;

  for (const segment of segments) {
    // Map segment items (which contain start/end times and speaker labels)
    // to the actual items from results.items (which contain text and confidence)
    const segmentItems: TranscribeItem[] = [];
    
    for (let i = 0; i < segment.items.length; i++) {
      const segmentItem = segment.items[i];
      
      // Find matching item in results.items by start_time and end_time
      const itemIndex = allItems?.findIndex(item => 
        item.start_time === segmentItem.start_time && 
        item.end_time === segmentItem.end_time
      );
      
      if (itemIndex !== undefined && itemIndex >= 0) {
        const matchingItem = allItems[itemIndex];
        segmentItems.push(matchingItem);
        
        // Check if the next item in results.items is punctuation (no timing)
        // If so, include it as it belongs to this segment
        if (itemIndex + 1 < allItems.length) {
          const nextItem = allItems[itemIndex + 1];
          if (nextItem.type === 'punctuation' && !nextItem.start_time) {
            segmentItems.push(nextItem);
          }
        }
      }
    }
    
    // Extract word-level data from segment items
    const words = extractWordLevelData(segmentItems);
    
    // Extract text from segment items
    const text = segmentItems
      .map(item => item.alternatives?.[0]?.content || '')
      .join(' ')
      .replace(/\s+([.,!?;:])/g, '$1'); // Fix punctuation spacing

    // Calculate average confidence for the segment
    const confidenceValues = segmentItems
      .filter(item => item.alternatives?.[0]?.confidence)
      .map(item => parseFloat(item.alternatives?.[0]?.confidence || '1.0'));
    
    const avgConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length
      : 1.0;

    // Detect language for this segment
    const languageCode = detectLanguageFromResult(transcribeResult);

    const transcriptSegment: Omit<TranscriptSegmentItem, 'meetingId'> = {
      startTime: Math.round(parseFloat(segment.start_time) * 1000), // Convert to milliseconds
      endTime: Math.round(parseFloat(segment.end_time) * 1000),
      speakerLabel: segment.speaker_label,
      text: text.trim(),
      languageCode,
      confidence: avgConfidence,
      words, // Add word-level data
    };

    transcriptSegments.push(transcriptSegment as TranscriptSegmentItem);
  }

  return transcriptSegments;
}

/**
 * Parse items when speaker diarization is not available
 * Groups items into segments based on time windows (e.g., 30 seconds)
 */
function parseItemsWithoutDiarization(
  items: TranscribeItem[],
  transcribeResult: TranscribeResult
): TranscriptSegmentItem[] {
  const SEGMENT_DURATION_MS = 30000; // 30 seconds per segment
  const transcriptSegments: TranscriptSegmentItem[] = [];
  
  // Filter out punctuation-only items and get items with timestamps
  const timedItems = items.filter(item => 
    item.type === 'pronunciation' && item.start_time && item.end_time
  );
  
  if (timedItems.length === 0) {
    throw new Error('No timed items found in Transcribe output');
  }
  
  let currentSegmentItems: TranscribeItem[] = [];
  let segmentStartTime = parseFloat(timedItems[0].start_time!);
  let segmentIndex = 0;
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // For pronunciation items, check if we should start a new segment
    if (item.type === 'pronunciation' && item.start_time) {
      const itemTime = parseFloat(item.start_time);
      
      // Start new segment if time window exceeded
      if (itemTime - segmentStartTime >= SEGMENT_DURATION_MS / 1000) {
        // Save current segment if it has content
        if (currentSegmentItems.length > 0) {
          transcriptSegments.push(createSegmentFromItems(
            currentSegmentItems,
            segmentIndex,
            transcribeResult
          ) as TranscriptSegmentItem);
          segmentIndex++;
        }
        
        // Start new segment
        currentSegmentItems = [item];
        segmentStartTime = itemTime;
      } else {
        currentSegmentItems.push(item);
      }
    } else {
      // Add punctuation to current segment
      currentSegmentItems.push(item);
    }
  }
  
  // Add final segment
  if (currentSegmentItems.length > 0) {
    transcriptSegments.push(createSegmentFromItems(
      currentSegmentItems,
      segmentIndex,
      transcribeResult
    ) as TranscriptSegmentItem);
  }
  
  return transcriptSegments;
}

/**
 * Create a transcript segment from a list of items
 */
function createSegmentFromItems(
  items: TranscribeItem[],
  segmentIndex: number,
  transcribeResult: TranscribeResult
): Omit<TranscriptSegmentItem, 'meetingId'> {
  // Extract word-level data from items
  const words = extractWordLevelData(items);
  
  // Extract text
  const text = items
    .map(item => item.alternatives[0]?.content || '')
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1'); // Fix punctuation spacing
  
  // Calculate average confidence
  const confidenceValues = items
    .filter(item => item.alternatives[0]?.confidence)
    .map(item => parseFloat(item.alternatives[0].confidence!));
  
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length
    : 1.0;
  
  // Get start and end times from first and last timed items
  const timedItems = items.filter(item => item.start_time && item.end_time);
  const startTime = timedItems.length > 0 
    ? Math.round(parseFloat(timedItems[0].start_time!) * 1000)
    : 0;
  const endTime = timedItems.length > 0
    ? Math.round(parseFloat(timedItems[timedItems.length - 1].end_time!) * 1000)
    : startTime;
  
  // Detect language
  const languageCode = detectLanguageFromResult(transcribeResult);
  
  return {
    startTime,
    endTime,
    speakerLabel: `Speaker ${segmentIndex + 1}`, // Generic speaker label
    text: text.trim(),
    languageCode,
    confidence: avgConfidence,
    words, // Add word-level data
  };
}

/**
 * Detect language from Transcribe result
 */
function detectLanguageFromResult(transcribeResult: TranscribeResult): string {
  // Check if language identification is available
  const languageIdentification = transcribeResult.results.language_identification;
  
  if (languageIdentification && languageIdentification.length > 0) {
    // Use the highest confidence language
    const topLanguage = languageIdentification.reduce((prev, current) => 
      parseFloat(current.score) > parseFloat(prev.score) ? current : prev
    );
    return topLanguage.language_code;
  }

  // Default to Romanian since that's what we're using
  return 'ro-RO';
}

/**
 * Store transcript segments in DynamoDB using batch writes
 */
async function storeTranscriptSegments(
  meetingId: string,
  segments: TranscriptSegmentItem[],
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Storing transcript segments', {
    meetingId,
    segmentCount: segments.length,
  });

  // DynamoDB BatchWrite can handle max 25 items per request
  const BATCH_SIZE = 25;
  const batches: TranscriptSegmentItem[][] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    batches.push(segments.slice(i, i + BATCH_SIZE));
  }

  logWithContext(correlationId, 'INFO', 'Batch write plan created', {
    totalSegments: segments.length,
    batchCount: batches.length,
  });

  // Process batches sequentially to avoid throttling
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    const batchWriteCommand = new BatchWriteCommand({
      RequestItems: {
        [TRANSCRIPT_SEGMENTS_TABLE]: batch.map(segment => ({
          PutRequest: {
            Item: {
              ...segment,
              meetingId,
            },
          },
        })),
      },
    });

    try {
      const result = await docClient.send(batchWriteCommand);
      
      // Handle unprocessed items
      if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
        logWithContext(correlationId, 'WARN', 'Batch write had unprocessed items', {
          batchIndex: i,
          unprocessedCount: result.UnprocessedItems[TRANSCRIPT_SEGMENTS_TABLE]?.length || 0,
        });
        
        // Retry unprocessed items
        const retryCommand = new BatchWriteCommand({
          RequestItems: result.UnprocessedItems,
        });
        
        await docClient.send(retryCommand);
      }

      logWithContext(correlationId, 'INFO', 'Batch write completed', {
        batchIndex: i + 1,
        totalBatches: batches.length,
      });
    } catch (error: any) {
      logWithContext(correlationId, 'ERROR', 'Batch write failed', {
        batchIndex: i,
        error: error.message,
      });
      throw error;
    }
  }

  logWithContext(correlationId, 'INFO', 'All transcript segments stored successfully', {
    meetingId,
    totalSegments: segments.length,
  });
}

/**
 * Update meeting status to "analyzing" and save duration
 */
async function updateMeetingStatus(
  meetingId: string,
  segments: TranscriptSegmentItem[],
  correlationId: string
): Promise<{ userId: string }> {
  logWithContext(correlationId, 'INFO', 'Updating meeting status to analyzing', {
    meetingId,
  });

  // First, query the meeting to get userId (since we only have meetingId from S3 key)
  const queryCommand = new QueryCommand({
    TableName: MEETINGS_TABLE,
    IndexName: 'meetingId-index',
    KeyConditionExpression: 'meetingId = :meetingId',
    ExpressionAttributeValues: {
      ':meetingId': meetingId,
    },
    Limit: 1,
  });

  const queryResult = await docClient.send(queryCommand);
  
  if (!queryResult.Items || queryResult.Items.length === 0) {
    throw new Error(`Meeting not found: ${meetingId}`);
  }

  const meeting = queryResult.Items[0];
  const userId = meeting.userId;

  logWithContext(correlationId, 'INFO', 'Meeting found', {
    meetingId,
    userId,
    currentStatus: meeting.status,
  });

  // Calculate duration from last segment's end time (in seconds)
  const duration = segments.length > 0 
    ? Math.round(segments[segments.length - 1].endTime / 1000)
    : 0;

  logWithContext(correlationId, 'INFO', 'Calculated meeting duration', {
    meetingId,
    durationSeconds: duration,
  });

  // Update meeting status and duration
  const updateCommand = new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: {
      userId,
      meetingId,
    },
    UpdateExpression: 'SET #status = :status, #duration = :duration',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#duration': 'duration',
    },
    ExpressionAttributeValues: {
      ':status': 'analyzing',
      ':duration': duration,
    },
    ConditionExpression: 'attribute_exists(meetingId)',
  });

  await docClient.send(updateCommand);

  logWithContext(correlationId, 'INFO', 'Meeting status and duration updated successfully', {
    meetingId,
    newStatus: 'analyzing',
    duration,
  });

  return { userId };
}

/**
 * Start the processing workflow Step Functions state machine
 */
async function startProcessingWorkflow(
  meetingId: string,
  userId: string,
  correlationId: string
): Promise<void> {
  logWithContext(correlationId, 'INFO', 'Starting processing workflow', {
    meetingId,
    userId,
    stateMachineArn: PROCESSING_STATE_MACHINE_ARN,
  });

  const startCommand = new StartExecutionCommand({
    stateMachineArn: PROCESSING_STATE_MACHINE_ARN,
    name: `meeting-${meetingId}-${Date.now()}`,
    input: JSON.stringify({
      meetingId,
      userId,
      correlationId,
    }),
  });

  try {
    const result = await sfnClient.send(startCommand);
    
    logWithContext(correlationId, 'INFO', 'Processing workflow started successfully', {
      meetingId,
      executionArn: result.executionArn,
    });
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Failed to start processing workflow', {
      meetingId,
      error: error.message,
    });
    throw error;
  }
}

// EventBridge S3 event detail type
interface S3EventDetail {
  version: string;
  bucket: {
    name: string;
  };
  object: {
    key: string;
    size: number;
    etag: string;
    sequencer: string;
  };
  'request-id': string;
  requester: string;
  'source-ip-address': string;
  reason?: string;
}

/**
 * Process a single EventBridge S3 event
 */
async function processEvent(
  event: EventBridgeEvent<'Object Created', S3EventDetail>,
  correlationId: string
): Promise<void> {
  const bucket = event.detail.bucket.name;
  const key = event.detail.object.key;

  logWithContext(correlationId, 'INFO', 'Processing EventBridge S3 event', {
    bucket,
    key,
    eventName: event['detail-type'],
  });

  // Extract meetingId from S3 key: transcribe-output/{meetingId}/...
  const keyParts = key.split('/');
  if (keyParts.length < 2 || keyParts[0] !== 'transcribe-output') {
    logWithContext(correlationId, 'WARN', 'Invalid S3 key format, skipping', { key });
    return;
  }

  const meetingId = keyParts[1];

  logWithContext(correlationId, 'INFO', 'Extracted meetingId from S3 key', {
    meetingId,
    key,
  });

  // Retrieve Transcribe output from S3
  logWithContext(correlationId, 'INFO', 'Retrieving Transcribe output from S3', {
    bucket,
    key,
  });

  const getObjectCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const s3Response = await s3Client.send(getObjectCommand);
  
  if (!s3Response.Body) {
    throw new Error('S3 object body is empty');
  }

  // Read and parse JSON
  const bodyContents = await s3Response.Body.transformToString();
  const transcribeResult: TranscribeResult = JSON.parse(bodyContents);

  logWithContext(correlationId, 'INFO', 'Transcribe output retrieved and parsed', {
    meetingId,
    hasSegments: !!transcribeResult.results.speaker_labels?.segments,
    segmentCount: transcribeResult.results.speaker_labels?.segments?.length || 0,
  });

  // Parse and extract transcript segments
  const segments = parseTranscribeOutput(transcribeResult);

  logWithContext(correlationId, 'INFO', 'Transcript segments extracted', {
    meetingId,
    segmentCount: segments.length,
  });

  // Store segments in DynamoDB
  await storeTranscriptSegments(meetingId, segments, correlationId);

  // Update meeting status to "analyzing" and save duration
  const { userId } = await updateMeetingStatus(meetingId, segments, correlationId);

  // Start the processing workflow (Step Functions)
  await startProcessingWorkflow(meetingId, userId, correlationId);

  logWithContext(correlationId, 'INFO', 'ProcessTranscribeOutput completed successfully', {
    meetingId,
  });
}

/**
 * Lambda handler for EventBridge S3 events
 */
export const handler = async (
  event: EventBridgeEvent<'Object Created', S3EventDetail>
): Promise<void> => {
  const correlationId = generateCorrelationId();

  logWithContext(correlationId, 'INFO', 'ProcessTranscribeOutput invoked', {
    source: event.source,
    detailType: event['detail-type'],
  });

  try {
    await processEvent(event, correlationId);

    logWithContext(correlationId, 'INFO', 'Event processed successfully');
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Unexpected error in ProcessTranscribeOutput', {
      error: error.message,
      stack: error.stack,
    });
    
    throw error;
  }
};
