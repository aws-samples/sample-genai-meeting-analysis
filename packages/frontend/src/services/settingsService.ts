import { apiClient } from '../lib/api-client';
import { ReportTemplate } from '@meeting-platform/shared';

export interface UserSettings {
  promptTemplate: string;
  modelId: string;
  templateName: string;
  updatedAt: number | null;
}

export interface UpdateSettingsRequest {
  promptTemplate: string;
  modelId: string;
  templateName?: string;
}

export interface SaveTemplateRequest {
  templateName: string;
  templateContent: string;
}

export interface SaveTemplateResponse {
  templateId: string;
  validationErrors?: string[];
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Get user settings
 */
export async function getUserSettings(): Promise<UserSettings> {
  const response = await apiClient.get<UserSettings>('/settings');
  return response.data;
}

/**
 * Update user settings
 */
export async function updateUserSettings(settings: UpdateSettingsRequest): Promise<void> {
  await apiClient.put('/settings', settings);
}

/**
 * Available Bedrock models
 */
export const AVAILABLE_MODELS = [
  {
    id: 'amazon.nova-pro-v1:0',
    name: 'Amazon Nova Pro',
    description: 'High-performance multimodal model',
  },
  {
    id: 'amazon.nova-lite-v1:0',
    name: 'Amazon Nova Lite',
    description: 'Fast and cost-effective model',
  },
  {
    id: 'amazon.nova-micro-v1:0',
    name: 'Amazon Nova Micro',
    description: 'Ultra-fast text-only model',
  },
  {
    id: 'us.anthropic.claude-4-5-sonnet-20250514-v1:0',
    name: 'Claude 4.5 Sonnet',
    description: 'Most capable model with enhanced reasoning',
  },
  {
    id: 'us.anthropic.claude-4-5-haiku-20250514-v1:0',
    name: 'Claude 4.5 Haiku',
    description: 'Fast with improved capabilities',
  },
  {
    id: 'us.anthropic.claude-4-0-sonnet-20250514-v1:0',
    name: 'Claude 4.0 Sonnet',
    description: 'Advanced reasoning and analysis',
  }
];

/**
 * Get default prompt template
 */
export function getDefaultPromptTemplate(): string {
  return `You are an AI assistant analyzing a board meeting transcript. Please provide a comprehensive analysis in markdown format that includes:

1. **Executive Summary**: A brief overview of the meeting (2-3 sentences)

2. **Key Discussion Points**: Main topics discussed during the meeting

3. **Decisions Made**: Important decisions and resolutions

4. **Action Items**: Tasks assigned with responsible parties (if mentioned)

5. **Next Steps**: Follow-up actions and future meeting topics

6. **Sentiment Analysis**: Overall tone and atmosphere of the meeting

Please format your response in clear, professional markdown. Be concise but thorough.

Here is the transcript:

{{transcript}}`;
}

/**
 * Get default report template
 */
export function getDefaultReportTemplate(): string {
  return `# Meeting Report

**Date:** {{meeting_date}}
**Location:** {{meeting_location}}
**Company:** {{company_name}}

## Participants
{{participants}}

## Agenda and Decisions

{{agenda_points}}

## Summary
{{meeting_summary}}`;
}

/**
 * Validate report template syntax
 * Checks that all placeholders follow the {{placeholder_name}} format
 */
export function validateReportTemplate(templateContent: string): TemplateValidationResult {
  const errors: string[] = [];
  
  // Check for invalid placeholder patterns
  // Valid: {{placeholder_name}}
  // Invalid: {placeholder}, {{placeholder name}}, {{placeholder-name}}
  
  // Find all potential placeholder patterns
  const singleBracePattern = /(?<!\{)\{(?!\{)[^}]*\}(?!\})/g;
  const singleBraceMatches = templateContent.match(singleBracePattern);
  
  if (singleBraceMatches) {
    errors.push(`Invalid placeholder syntax found: ${singleBraceMatches.join(', ')}. Use {{placeholder_name}} format.`);
  }
  
  // Find all valid placeholders and check their names
  const validPlaceholderPattern = /\{\{([^}]*)\}\}/g;
  const matches = [...templateContent.matchAll(validPlaceholderPattern)];
  
  for (const match of matches) {
    const placeholderName = match[1];
    
    // Check for empty placeholder
    if (placeholderName.trim() === '') {
      errors.push('Empty placeholder {{}} found. Provide a placeholder name.');
      continue;
    }
    
    // Check for spaces in placeholder name
    if (/\s/.test(placeholderName)) {
      errors.push(`Placeholder "{{${placeholderName}}}" contains spaces. Use underscores instead: {{${placeholderName.replace(/\s+/g, '_')}}}`);
    }
    
    // Check for invalid characters (only allow alphanumeric and underscores)
    if (!/^[a-zA-Z0-9_]+$/.test(placeholderName)) {
      errors.push(`Placeholder "{{${placeholderName}}}" contains invalid characters. Use only letters, numbers, and underscores.`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get user's report template
 */
export async function getReportTemplate(): Promise<ReportTemplate> {
  try {
    const response = await apiClient.get<{ template: ReportTemplate }>('/settings/report-template');
    return response.data.template;
  } catch (error: any) {
    // If template doesn't exist, return default
    if (error.response?.status === 404) {
      return {
        templateId: 'default',
        templateName: 'Default Template',
        templateContent: getDefaultReportTemplate(),
        createdAt: Date.now(),
      };
    }
    throw error;
  }
}

/**
 * Save user's report template with retry logic
 */
export async function saveReportTemplate(
  request: SaveTemplateRequest,
  retryCount = 0
): Promise<SaveTemplateResponse> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second
  
  try {
    // Validate template before sending
    const validation = validateReportTemplate(request.templateContent);
    if (!validation.isValid) {
      return {
        templateId: '',
        validationErrors: validation.errors,
      };
    }
    
    const response = await apiClient.put<SaveTemplateResponse>(
      '/settings/report-template',
      request
    );
    return response.data;
  } catch (error: any) {
    // Retry on network errors or 5xx errors
    const shouldRetry = 
      retryCount < MAX_RETRIES &&
      (!error.response || error.response.status >= 500);
    
    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return saveReportTemplate(request, retryCount + 1);
    }
    
    // Handle validation errors from backend
    if (error.response?.status === 400 && error.response.data?.validationErrors) {
      return {
        templateId: '',
        validationErrors: error.response.data.validationErrors,
      };
    }
    
    throw error;
  }
}
