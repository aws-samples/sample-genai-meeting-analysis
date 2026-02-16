import apiClient from '../lib/api-client';
import type {
  Meeting,
  TranscriptSegment,
  MeetingAnalysis,
  MeetingReport,
  ProcessingStatus,
  CreateMeetingRequest,
  CreateMeetingResponse,
  StartTranscriptionResponse,
  UpdateSpeakersRequest,
  GenerateAnalysisRequest,
  GetReportResponse,
} from '@meeting-platform/shared';

/**
 * Meeting API Service
 * Handles all API calls related to meetings
 */

export const meetingService = {
  /**
   * Create a new meeting and get upload URL
   */
  async createMeeting(request: CreateMeetingRequest): Promise<CreateMeetingResponse> {
    const response = await apiClient.post<CreateMeetingResponse>('/meetings', request);
    return response.data;
  },

  /**
   * Start transcription for a meeting
   */
  async startTranscription(meetingId: string): Promise<StartTranscriptionResponse> {
    const response = await apiClient.post<StartTranscriptionResponse>(
      `/meetings/${meetingId}/start-transcription`
    );
    return response.data;
  },

  /**
   * Get list of user's meetings
   */
  async getMeetings(): Promise<Meeting[]> {
    const response = await apiClient.get<Meeting[]>('/meetings');
    return response.data;
  },

  /**
   * Get meeting details
   */
  async getMeeting(meetingId: string): Promise<Meeting> {
    const response = await apiClient.get<Meeting>(`/meetings/${meetingId}`);
    return response.data;
  },

  /**
   * Get meeting processing status
   */
  async getMeetingStatus(meetingId: string): Promise<ProcessingStatus> {
    const response = await apiClient.get<ProcessingStatus>(`/meetings/${meetingId}/status`);
    return response.data;
  },

  /**
   * Get meeting transcript
   */
  async getTranscript(meetingId: string): Promise<TranscriptSegment[]> {
    const response = await apiClient.get<{ segments: TranscriptSegment[] } | TranscriptSegment[]>(
      `/meetings/${meetingId}/transcript`
    );
    
    // Handle both array format and object with segments property
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && typeof response.data === 'object' && 'segments' in response.data) {
      return response.data.segments;
    }
    
    return [];
  },

  /**
   * Update speaker names
   */
  async updateSpeakers(meetingId: string, request: UpdateSpeakersRequest): Promise<TranscriptSegment[]> {
    const response = await apiClient.put<{ segments: TranscriptSegment[] } | TranscriptSegment[]>(
      `/meetings/${meetingId}/speakers`,
      request
    );
    
    // Handle both array format and object with segments property
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && typeof response.data === 'object' && 'segments' in response.data) {
      return response.data.segments;
    }
    
    return [];
  },

  /**
   * Generate meeting analysis
   */
  async generateAnalysis(meetingId: string, request?: GenerateAnalysisRequest): Promise<void> {
    await apiClient.post(`/meetings/${meetingId}/analysis`, request || {});
  },

  /**
   * Get meeting analysis
   */
  async getAnalysis(meetingId: string): Promise<MeetingAnalysis> {
    const response = await apiClient.get<MeetingAnalysis>(`/meetings/${meetingId}/analysis`);
    return response.data;
  },

  /**
   * Generate meeting report
   */
  async generateReport(meetingId: string, templateId?: string, overwriteManualEdits?: boolean): Promise<void> {
    await apiClient.post(`/meetings/${meetingId}/generate-report`, { 
      templateId,
      overwriteManualEdits,
    });
  },

  /**
   * Get meeting report
   */
  async getReport(meetingId: string): Promise<MeetingReport> {
    const response = await apiClient.get<GetReportResponse>(
      `/meetings/${meetingId}/report`
    );
    return response.data.report;
  },

  /**
   * Upload audio file to S3 using pre-signed URL
   */
  async uploadAudioFile(uploadUrl: string, file: File, onProgress?: (progress: number) => void): Promise<void> {
    await axios.put(uploadUrl, file, {
      headers: {
        'Content-Type': file.type,
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      },
    });
  },
};

// Import axios for direct S3 upload (bypasses interceptors)
import axios from 'axios';
