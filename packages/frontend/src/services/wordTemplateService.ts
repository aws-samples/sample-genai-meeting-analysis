/**
 * Word Template Service
 * 
 * Handles API calls for Word template configuration and management.
 */

import { apiClient } from '../lib/api-client';
import type { PlaceholderConfig } from '@meeting-platform/shared';

/**
 * Supported languages for translation
 * Must match the backend SUPPORTED_LANGUAGES in shared/types/word-template.ts
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ro', name: 'Romanian' },
] as const;

/**
 * Response from uploading a Word template
 */
export interface UploadWordTemplateResponse {
  templateId: string;
  placeholders: string[];
  message: string;
}

/**
 * Response from getting Word template config
 */
export interface WordTemplateConfigResponse {
  templateId: string;
  templateName: string;
  sourceLanguage: string;
  targetLanguage: string;
  placeholders: PlaceholderConfig[];
  templateUrl: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Request to update Word template config
 */
export interface UpdateWordTemplateConfigRequest {
  sourceLanguage?: string;
  targetLanguage?: string;
  placeholders?: PlaceholderConfig[];
}



/**
 * Upload a Word template file
 * 
 * @param file - The .docx file to upload
 * @param templateName - Name for the template
 * @param sourceLanguage - Source language code
 * @param targetLanguage - Target language code
 * @returns Upload response with template ID and extracted placeholders
 */
export async function uploadWordTemplate(
  file: File,
  templateName: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<UploadWordTemplateResponse> {
  // Convert file to base64
  const fileContent = await fileToBase64(file);
  
  const response = await apiClient.put<UploadWordTemplateResponse>(
    '/settings/word-template',
    {
      templateName,
      fileContent,
      sourceLanguage,
      targetLanguage,
    }
  );
  
  return response.data;
}

/**
 * Get Word template configuration
 * 
 * @returns The current Word template configuration or null if not configured
 */
export async function getWordTemplateConfig(): Promise<WordTemplateConfigResponse | null> {
  try {
    const response = await apiClient.get<WordTemplateConfigResponse>('/settings/word-template');
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update Word template configuration
 * 
 * @param config - The configuration updates to apply
 */
export async function updateWordTemplateConfig(
  config: UpdateWordTemplateConfigRequest
): Promise<void> {
  await apiClient.patch('/settings/word-template', config);
}

/**
 * Convert a File to base64 string
 * 
 * @param file - The file to convert
 * @returns Base64 encoded string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Validate that a file is a .docx file
 * 
 * @param file - The file to validate
 * @returns Validation result with error message if invalid
 */
export function validateDocxFile(file: File): { isValid: boolean; error?: string } {
  // Check file extension
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return {
      isValid: false,
      error: 'Invalid file type. Please upload a .docx file.',
    };
  }
  
  // Check MIME type
  const validMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  
  if (!validMimeTypes.includes(file.type) && file.type !== '') {
    return {
      isValid: false,
      error: 'Invalid file type. Please upload a valid Word document (.docx).',
    };
  }
  
  // Check file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: 'File too large. Maximum size is 10MB.',
    };
  }
  
  return { isValid: true };
}

/**
 * Response from generating a Word report
 */
export interface GenerateWordReportResponse {
  documentKey: string;
  downloadUrl: string;
  generatedAt: number;
  translationTokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Response from getting a Word report
 */
export interface GetWordReportResponse {
  downloadUrl: string;
  filename: string;
  generatedAt: number;
}

/**
 * Generate a Word report for a meeting
 * Uses the uploaded Word template and translates selected placeholders
 * 
 * @param meetingId - The meeting ID to generate the report for
 * @returns Generation response with download URL
 */
export async function generateWordReport(
  meetingId: string
): Promise<GenerateWordReportResponse> {
  const response = await apiClient.post<GenerateWordReportResponse>(
    `/meetings/${meetingId}/word-report`
  );
  
  return response.data;
}

/**
 * Get the Word report download URL for a meeting
 * 
 * @param meetingId - The meeting ID to get the report for
 * @returns Response with download URL and filename, or null if not generated
 */
export async function getWordReport(
  meetingId: string
): Promise<GetWordReportResponse | null> {
  try {
    const response = await apiClient.get<GetWordReportResponse>(
      `/meetings/${meetingId}/word-report`
    );
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Trigger browser download from a presigned URL
 * 
 * @param downloadUrl - The presigned URL to download from
 * @param filename - The filename for the download
 */
export function triggerDownload(downloadUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
