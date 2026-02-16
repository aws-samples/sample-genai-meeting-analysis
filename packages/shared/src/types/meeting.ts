/**
 * Meeting status types
 * 
 * Processing flow:
 * 1. uploading - User uploads audio file
 * 2. transcribing - Amazon Transcribe processing audio
 * 3. analyzing - Bedrock generating meeting analysis
 * 4. generating-report - Bedrock generating structured report
 * 5. generating-word-report - Bedrock translating and generating Word document
 * 6. completed - All processing complete
 * 7. failed - Error occurred during processing
 */
export type MeetingStatus = 
  | 'uploading' 
  | 'transcribing' 
  | 'analyzing' 
  | 'generating-report' 
  | 'generating-word-report'
  | 'completed' 
  | 'failed';

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
 * Meeting entity
 */
export interface Meeting {
  meetingId: string;
  userId: string;
  fileName: string;
  duration?: number;
  status: MeetingStatus;
  createdAt: number;
  audioUrl?: string;
  analysisTokenUsage?: TokenUsage;  // Token usage for analysis generation
  reportTokenUsage?: TokenUsage;  // Token usage for report generation
  errorMessage?: string;
}

/**
 * Transcript segment with speaker and language information
 */
export interface TranscriptSegment {
  startTime: number;  // milliseconds
  endTime: number;    // milliseconds
  speakerLabel: string;
  speakerName?: string;
  text: string;
  languageCode: string;
  confidence: number;
  words: WordItem[];  // Word-level data (required)
}

/**
 * Meeting analysis result
 */
export interface MeetingAnalysis {
  meetingId: string;
  markdown: string;
  generatedAt: number;
}

/**
 * Processing status with progress information
 */
export type ProcessingStage = 'upload' | 'transcription' | 'analysis' | 'report-generation' | 'word-report-generation' | 'complete';

export interface ProcessingStatus {
  status: MeetingStatus;
  progress: number;  // 0-100
  stage: ProcessingStage;
  message?: string;
}
