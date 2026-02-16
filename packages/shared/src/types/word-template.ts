/**
 * Word template configuration types for bilingual report generation
 */

/**
 * Supported languages for translation
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
 * Language code type derived from supported languages
 */
export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

/**
 * Placeholder configuration for translation settings
 */
export interface PlaceholderConfig {
  name: string;
  translateEnabled: boolean;
}

/**
 * WordTemplateConfig DynamoDB table item
 */
export interface WordTemplateConfigItem {
  userId: string;           // Partition key
  templateId: string;       // Sort key (use 'default' for primary)
  templateName: string;
  templateS3Key: string;    // S3 key for .docx file
  sourceLanguage: string;   // e.g., 'en', 'es', 'fr'
  targetLanguage: string;
  placeholders: PlaceholderConfig[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Word report reference stored in MeetingReportItem
 */
export interface WordReportReference {
  documentS3Key: string;
  generatedAt: number;
  templateId: string;
  translationTokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
