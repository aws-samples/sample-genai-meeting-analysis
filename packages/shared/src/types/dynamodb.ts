/**
 * DynamoDB table schemas
 */

/**
 * Word-level timestamp data
 */
export interface WordItem {
  startTime: number;  // milliseconds
  endTime: number;    // milliseconds
  text: string;
  confidence: number;
}

/**
 * Token usage tracking for AI model invocations
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
}

/**
 * Meetings table item
 */
export interface MeetingItem {
  userId: string;  // Partition key
  meetingId: string;  // Sort key
  createdAt: number;
  audioFileKey: string;
  audioFileName: string;
  audioDuration?: number;
  status: 'uploading' | 'transcribing' | 'analyzing' | 'generating-report' | 'completed' | 'failed';
  transcribeJobName?: string;
  analysisMarkdown?: string;
  analysisGeneratedAt?: number;
  analysisTokenUsage?: TokenUsage;  // Token usage for analysis generation
  reportStatus?: 'generating' | 'completed' | 'failed';  // Report generation status
  reportTokenUsage?: TokenUsage;  // Token usage for report generation
  errorMessage?: string;
}

/**
 * TranscriptSegments table item
 */
export interface TranscriptSegmentItem {
  meetingId: string;  // Partition key
  startTime: number;  // Sort key (milliseconds)
  endTime: number;
  speakerLabel: string;
  speakerName?: string;
  text: string;
  languageCode: string;
  confidence: number;
  words: WordItem[];  // Word-level data (required)
}

/**
 * PromptTemplates table item
 */
export interface PromptTemplateItem {
  userId: string;  // Partition key
  templateId: string;  // Sort key (use 'default' for user's default settings)
  templateName: string;
  promptText: string;
  modelId: string;  // Bedrock model ID to use
  isDefault: boolean;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Citation reference for report content
 */
export interface CitationItem {
  startTime: number;  // milliseconds
  endTime: number;    // milliseconds
}

/**
 * Placeholder value with citation
 */
export interface PlaceholderValueItem {
  value: string;
  citation: CitationItem;
  isFilled: boolean;
  isManuallyEdited?: boolean;
  lastEditedAt?: number;
  originalValue?: string;
}

/**
 * Agenda point with decision and citations
 */
export interface AgendaPointItem {
  point: string;
  citation: CitationItem;
  decision: string;
  decisionCitation: CitationItem;
}

/**
 * ReportTemplates table item
 */
export interface ReportTemplateItem {
  userId: string;  // Partition key
  templateId: string;  // Sort key (use 'default' for user's primary template)
  templateName: string;
  templateContent: string;  // Template text with placeholders
  createdAt: number;
  updatedAt?: number;
}

/**
 * Placeholder edit history entry for audit trail
 */
export interface PlaceholderEditHistoryItem {
  placeholderName: string;
  oldValue: string;
  newValue: string;
  editedAt: number;
  editedBy: string;  // userId
}

/**
 * MeetingReports table item
 */
export interface MeetingReportItem {
  meetingId: string;  // Partition key
  reportId: string;  // Sort key (use 'latest' for most recent)
  userId: string;
  templateId: string;  // Reference to template used
  reportContent: string;  // Populated template
  extractedData: {
    placeholders: Record<string, PlaceholderValueItem>;
    agendaPoints: AgendaPointItem[];
  };
  generatedAt: number;
  status: 'generating' | 'completed' | 'failed';
  errorMessage?: string;
  placeholderEditHistory?: PlaceholderEditHistoryItem[];  // Optional audit trail
}
