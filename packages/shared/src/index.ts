/**
 * Shared types and interfaces for Meeting Analysis Platform
 */

// Meeting types
export type {
  Meeting,
  MeetingStatus,
  WordItem,
  TokenUsage,
  TranscriptSegment,
  MeetingAnalysis,
  ProcessingStatus,
  ProcessingStage
} from './types/meeting';

// Report types
export type {
  Citation,
  PlaceholderValue,
  AgendaPoint,
  ReportTemplate,
  ReportStatus,
  MeetingReport,
  EditablePlaceholder,
  PlaceholderEditEvent,
  ReportEditState
} from './types/report';

// API types
export type {
  CreateMeetingRequest,
  CreateMeetingResponse,
  StartTranscriptionResponse,
  UpdateSpeakersRequest,
  GenerateAnalysisRequest,
  SaveTemplateRequest,
  SaveTemplateResponse,
  GetTemplateResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  GetReportResponse,
  UpdatePlaceholderRequest,
  UpdatePlaceholderResponse,
  ErrorResponse
} from './types/api';

// DynamoDB types
export type {
  MeetingItem,
  TranscriptSegmentItem,
  PromptTemplateItem,
  CitationItem,
  PlaceholderValueItem,
  AgendaPointItem,
  ReportTemplateItem,
  MeetingReportItem,
  TokenUsage as DynamoDBTokenUsage
} from './types/dynamodb';

// Word template types
export {
  SUPPORTED_LANGUAGES
} from './types/word-template';

export type {
  LanguageCode,
  PlaceholderConfig,
  WordTemplateConfigItem,
  WordReportReference
} from './types/word-template';
