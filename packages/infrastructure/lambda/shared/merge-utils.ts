/**
 * Template merging utilities for Word document generation
 * 
 * These utilities handle:
 * - Merging data into Word templates using docxtemplater
 * - Building data objects combining original and translated values
 * - Preserving template formatting during merge
 * 
 * **Validates: Requirements 5.1, 5.2, 5.4, 5.5**
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

/**
 * Result of a template merge operation
 */
export interface MergeResult {
  success: boolean;
  documentBuffer?: Buffer;
  error?: string;
}

/**
 * Options for template merging
 */
export interface MergeOptions {
  /**
   * If true, undefined placeholders will be replaced with empty strings.
   * If false, undefined placeholders will remain as-is (e.g., {{name}}).
   * Default: false
   */
  replaceUndefinedWithEmpty?: boolean;
}

/**
 * Merges data into a Word template using docxtemplater.
 * 
 * Uses double curly brace delimiters ({{ and }}) for placeholder syntax.
 * Preserves all formatting including fonts, styles, colors, layout,
 * tables, columns, headers, and footers.
 * 
 * @param templateBuffer - The .docx template file as a Buffer
 * @param data - Object containing placeholder names and their values
 * @param options - Optional merge configuration
 * @returns MergeResult with the generated document buffer or error
 * 
 * **Validates: Requirements 5.1, 5.2, 5.4, 5.5**
 */
export function mergeTemplate(
  templateBuffer: Buffer,
  data: Record<string, string>,
  options: MergeOptions = {}
): MergeResult {
  const { replaceUndefinedWithEmpty = false } = options;

  try {
    // Load the template as a ZIP archive
    const zip = new PizZip(templateBuffer);

    // Create docxtemplater instance with configuration
    // Note: We use a simple parser to avoid issues with complex expressions
    const doc = new Docxtemplater(zip, {
      delimiters: {
        start: '{{',
        end: '}}',
      },
      paragraphLoop: true,
      linebreaks: true,
      // Use simple parser for basic placeholder replacement
      // Note: nullGetter doesn't work with custom parsers, so we handle
      // undefined placeholders directly in the parser
      parser: (tag: string) => ({
        get: (scope: Record<string, any>) => {
          const trimmedTag = tag.trim();
          if (trimmedTag === '.') {
            return scope;
          }
          const value = scope[trimmedTag];
          // Check if the key is missing or has empty/undefined value
          if (!(trimmedTag in scope) || value === undefined || value === null || value === '') {
            // Preserve original placeholder or replace with empty string
            return replaceUndefinedWithEmpty ? '' : `{{${trimmedTag}}}`;
          }
          return value;
        },
      }),
    });

    // Render the document with the provided data
    doc.render(data);

    // Generate the output document
    const outputBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    return {
      success: true,
      documentBuffer: outputBuffer as Buffer,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Handle docxtemplater-specific errors
      if ('properties' in error && (error as any).properties?.errors) {
        const errors = (error as any).properties.errors;
        const errorMessages = errors
          .map((e: any) => {
            // Provide more detailed error info
            const msg = e.message || e.toString();
            const context = e.properties?.explanation || '';
            return context ? `${msg} (${context})` : msg;
          })
          .join('; ');
        return {
          success: false,
          error: `Template merge failed: ${errorMessages}`,
        };
      }
      return {
        success: false,
        error: `Template merge failed: ${error.message}`,
      };
    }
    return {
      success: false,
      error: 'Template merge failed: unknown error',
    };
  }
}
