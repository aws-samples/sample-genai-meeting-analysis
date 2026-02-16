/**
 * Frontend-specific types
 * Re-export shared types for convenience
 */

// Re-export all shared types
export type {
  Meeting,
  MeetingStatus,
  TranscriptSegment,
  MeetingAnalysis,
  ProcessingStatus,
  ProcessingStage,
  CreateMeetingRequest,
  CreateMeetingResponse,
  StartTranscriptionResponse,
  UpdateSpeakersRequest,
  GenerateAnalysisRequest,
  ErrorResponse,
} from '@meeting-platform/shared';

/**
 * Frontend-specific authentication types
 */
export interface AuthUser {
  userId: string;
  email: string;
  name?: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Upload progress tracking
 */
export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}
