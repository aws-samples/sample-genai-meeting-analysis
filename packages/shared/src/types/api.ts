/**
 * API Request and Response types
 */

import { ReportStatus } from './report';

// POST /meetings
export interface CreateMeetingRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface CreateMeetingResponse {
  meetingId: string;
  uploadUrl: string;  // Pre-signed S3 URL
  expiresIn: number;
}

// POST /meetings/{id}/start-transcription
export interface StartTranscriptionResponse {
  transcriptionJobName: string;
  status: string;
}

// PUT /meetings/{id}/speakers
export interface UpdateSpeakersRequest {
  speakerMappings: {
    [speakerLabel: string]: string;  // e.g., { "spk_0": "John Doe" }
  };
}

// POST /meetings/{id}/analyze
export interface GenerateAnalysisRequest {
  promptTemplateId?: string;  // Optional custom prompt
}

// PUT /settings/report-template
export interface SaveTemplateRequest {
  templateName: string;
  templateContent: string;
}

export interface SaveTemplateResponse {
  templateId: string;
  validationErrors?: string[];
}

// GET /settings/report-template
export interface GetTemplateResponse {
  template: {
    templateId: string;
    templateName: string;
    templateContent: string;
    createdAt: number;
    updatedAt?: number;
  };
}

// POST /meetings/{id}/generate-report
export interface GenerateReportRequest {
  templateId?: string;  // Optional, defaults to user's default template
}

export interface GenerateReportResponse {
  reportId: string;
  status: string;
}

// GET /meetings/{id}/report
export interface GetReportResponse {
  report: {
    meetingId: string;
    reportId: string;
    templateId: string;
    reportContent: string;
    placeholders: Record<string, {
      value: string;
      citation: {
        startTime: number;
        endTime: number;
      };
      isFilled: boolean;
      isManuallyEdited?: boolean;
      lastEditedAt?: number;
      originalValue?: string;
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
    generatedAt: number;
    status: ReportStatus;
    errorMessage?: string;
  };
}

// PATCH /meetings/{id}/report/placeholders/{placeholderName}
export interface UpdatePlaceholderRequest {
  value: string;
  isManuallyEdited: boolean;
}

export interface UpdatePlaceholderResponse {
  success: boolean;
  placeholder: {
    name: string;
    value: string;
    isManuallyEdited: boolean;
    updatedAt: number;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
    retryable: boolean;
    currentVersion?: number;
  };
}

// Error response format
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
    retryable: boolean;
    partialResults?: {
      placeholders?: Record<string, unknown>;
      agendaPoints?: unknown[];
    };
  };
}
