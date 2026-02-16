/**
 * Translation utilities for Word template bilingual report generation
 * 
 * These utilities handle:
 * - Filtering placeholders that should be translated
 * - Building translation prompts for Amazon Bedrock
 * - Calling Bedrock to translate content
 * - Creating translated placeholder entries with naming convention
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PlaceholderConfig, SUPPORTED_LANGUAGES } from '@meeting-platform/shared';
import { logWithContext } from './utils';

/**
 * Result of a translation operation
 */
export interface TranslationResult {
  translatedValues: Record<string, string>;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Options for translation
 */
export interface TranslationOptions {
  sourceLanguage: string;
  targetLanguage: string;
  modelId?: string;
  correlationId: string;
}

/**
 * Default Bedrock model for translation
 */
const DEFAULT_TRANSLATION_MODEL = 'amazon.nova-pro-v1:0';

/**
 * Filters placeholders to only include those with translation enabled.
 * 
 * @param placeholders - Array of placeholder configurations
 * @param extractedData - Object containing placeholder values from the markdown report
 * @returns Object containing only the placeholder values that should be translated
 * 
 * **Validates: Requirements 3.5, 4.5**
 */
export function filterTranslatablePlaceholders(
  placeholders: PlaceholderConfig[],
  extractedData: Record<string, string>
): Record<string, string> {
  const translatablePlaceholders: Record<string, string> = {};

  for (const placeholder of placeholders) {
    if (placeholder.translateEnabled && extractedData[placeholder.name] !== undefined) {
      translatablePlaceholders[placeholder.name] = extractedData[placeholder.name];
    }
  }

  return translatablePlaceholders;
}

/**
 * Creates translated placeholder keys following the naming convention.
 * For each placeholder name, appends "_translated" suffix.
 * 
 * @param originalName - The original placeholder name
 * @returns The translated placeholder name with "_translated" suffix
 * 
 * **Validates: Requirements 4.2**
 */
export function getTranslatedPlaceholderName(originalName: string): string {
  return `${originalName}_translated`;
}

/**
 * Builds the data object combining original and translated values.
 * Original placeholders keep their values, translated placeholders get "_translated" suffix.
 * 
 * @param originalData - All extracted placeholder values
 * @param translatedData - Translated values for enabled placeholders
 * @returns Combined data object with both original and translated values
 */
export function buildDataObject(
  originalData: Record<string, string>,
  translatedData: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = { ...originalData };

  for (const [name, translatedValue] of Object.entries(translatedData)) {
    const translatedKey = getTranslatedPlaceholderName(name);
    result[translatedKey] = translatedValue;
  }

  return result;
}

/**
 * Gets the full language name from a language code.
 * 
 * @param code - Language code (e.g., 'en', 'es')
 * @returns Full language name or the code if not found
 */
export function getLanguageName(code: string): string {
  const language = SUPPORTED_LANGUAGES.find(lang => lang.code === code);
  return language?.name ?? code;
}

/**
 * Builds the translation prompt for Amazon Bedrock.
 * 
 * @param placeholders - Object containing placeholder names and values to translate
 * @param sourceLanguage - Source language code
 * @param targetLanguage - Target language code
 * @returns The formatted prompt string
 * 
 * **Validates: Requirements 4.1, 4.3**
 */
export function buildTranslationPrompt(
  placeholders: Record<string, string>,
  sourceLanguage: string,
  targetLanguage: string
): string {
  const sourceLangName = getLanguageName(sourceLanguage);
  const targetLangName = getLanguageName(targetLanguage);

  const placeholderEntries = Object.entries(placeholders)
    .map(([key, value]) => `"${key}": "${escapeJsonString(value)}"`)
    .join(',\n  ');

  return `You are a professional translator. Translate the following content from ${sourceLangName} to ${targetLangName}.

IMPORTANT INSTRUCTIONS:
- Preserve the meaning and context of the original content
- Maintain any formatting, bullet points, or structure in the text
- Do not add explanations or notes
- Return ONLY a valid JSON object with the same keys and translated values

Content to translate:
{
  ${placeholderEntries}
}

Return a JSON object with the exact same keys and the translated values. Example format:
{
  "key1": "translated value 1",
  "key2": "translated value 2"
}`;
}

/**
 * Escapes special characters in a string for JSON embedding.
 */
function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Parses the translation response from Bedrock.
 * Handles various response formats and extracts the JSON object.
 * 
 * @param responseText - Raw response text from Bedrock
 * @returns Parsed translation object
 */
export function parseTranslationResponse(responseText: string): Record<string, string> {
  // Try to extract JSON from the response
  // The model might return just JSON or JSON wrapped in markdown code blocks
  let jsonStr = responseText.trim();

  // Remove markdown code blocks if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    
    // Validate that all values are strings
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = String(value);
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to parse translation response: ${error}`);
  }
}

/**
 * Check if error is retryable (Bedrock throttling/transient errors)
 */
function isRetryableError(error: any): boolean {
  const retryableErrors = [
    'ThrottlingException',
    'ServiceUnavailableException',
    'InternalServerException',
    'ModelTimeoutException',
  ];

  return retryableErrors.some(errorType => 
    error.name === errorType || error.message?.includes(errorType)
  );
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Translates placeholder content using Amazon Bedrock with exponential backoff retries.
 * 
 * @param bedrockClient - Bedrock runtime client
 * @param placeholders - Object containing placeholder names and values to translate
 * @param options - Translation options including languages and correlation ID
 * @param retryCount - Current retry attempt (internal use)
 * @returns Translation result with translated values and token usage
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */
export async function translateWithBedrock(
  bedrockClient: BedrockRuntimeClient,
  placeholders: Record<string, string>,
  options: TranslationOptions,
  retryCount: number = 0
): Promise<TranslationResult> {
  const MAX_RETRIES = 5;
  const { sourceLanguage, targetLanguage, correlationId } = options;
  const modelId = options.modelId ?? DEFAULT_TRANSLATION_MODEL;

  // If no placeholders to translate, return empty result
  if (Object.keys(placeholders).length === 0) {
    logWithContext(correlationId, 'INFO', 'No placeholders to translate');
    return {
      translatedValues: {},
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  logWithContext(correlationId, 'INFO', 'Starting translation with Bedrock', {
    placeholderCount: Object.keys(placeholders).length,
    sourceLanguage,
    targetLanguage,
    modelId,
    retryCount,
  });

  const prompt = buildTranslationPrompt(placeholders, sourceLanguage, targetLanguage);

  // Determine if using Nova or Claude model
  const isNovaModel = modelId.includes('nova');

  const requestBody = isNovaModel
    ? {
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          max_new_tokens: 4096,
          temperature: 0.3, // Lower temperature for more consistent translations
        },
      }
    : {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      };

  const invokeCommand = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  try {
    const response = await bedrockClient.send(invokeCommand);

    if (!response.body) {
      throw new Error('Bedrock response body is empty');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract content and token usage based on model type
    let responseText: string;
    let tokenUsage: { inputTokens: number; outputTokens: number };

    if (isNovaModel) {
      if (!responseBody.output?.message?.content || responseBody.output.message.content.length === 0) {
        throw new Error('No content in Bedrock response');
      }
      responseText = responseBody.output.message.content[0].text;
      tokenUsage = {
        inputTokens: responseBody.usage?.inputTokens || 0,
        outputTokens: responseBody.usage?.outputTokens || 0,
      };
    } else {
      if (!responseBody.content || responseBody.content.length === 0) {
        throw new Error('No content in Bedrock response');
      }
      responseText = responseBody.content[0].text;
      tokenUsage = {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0,
      };
    }

    logWithContext(correlationId, 'INFO', 'Translation response received', {
      responseLength: responseText.length,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });

    // Parse the translation response
    const translatedValues = parseTranslationResponse(responseText);

    // Validate that we got translations for all requested placeholders
    const missingKeys = Object.keys(placeholders).filter(key => !(key in translatedValues));
    if (missingKeys.length > 0) {
      logWithContext(correlationId, 'WARN', 'Some placeholders were not translated', {
        missingKeys,
      });
      
      // Use original values as fallback for missing translations
      for (const key of missingKeys) {
        translatedValues[key] = placeholders[key];
      }
    }

    logWithContext(correlationId, 'INFO', 'Translation completed successfully', {
      translatedCount: Object.keys(translatedValues).length,
    });

    return {
      translatedValues,
      tokenUsage,
    };
  } catch (error: any) {
    logWithContext(correlationId, 'ERROR', 'Translation failed', {
      error: error.message,
      retryCount,
    });

    // Retry with exponential backoff for transient errors
    if (retryCount < MAX_RETRIES && isRetryableError(error)) {
      const backoffMs = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s, 8s, 16s
      
      logWithContext(correlationId, 'INFO', 'Retrying translation with exponential backoff', {
        retryCount: retryCount + 1,
        backoffMs,
      });

      await sleep(backoffMs);
      return translateWithBedrock(bedrockClient, placeholders, options, retryCount + 1);
    }

    // After all retries exhausted, throw error to let Step Functions handle it
    // This allows the workflow-level retry to kick in
    throw error;
  }
}
