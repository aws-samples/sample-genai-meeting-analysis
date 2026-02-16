/**
 * DOCX utility functions for Word template processing
 * Provides validation and placeholder extraction for .docx files
 */

import JSZip from 'jszip';

/**
 * Result of DOCX validation
 */
export interface DocxValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Result of placeholder extraction
 */
export interface PlaceholderExtractionResult {
  success: boolean;
  placeholders: string[];
  error?: string;
}

/**
 * Validates that a buffer contains a valid .docx file
 * A valid .docx file is a ZIP archive containing word/document.xml
 * 
 * @param fileBuffer - The file content as a Buffer
 * @returns DocxValidationResult indicating if the file is valid
 */
export async function validateDocxFile(
  fileBuffer: Buffer
): Promise<DocxValidationResult> {
  try {
    // Attempt to load as ZIP archive
    const zip = await JSZip.loadAsync(fileBuffer);
    
    // Check for required word/document.xml file
    const documentXml = zip.file('word/document.xml');
    
    if (!documentXml) {
      return {
        isValid: false,
        error: 'Invalid Word document: missing word/document.xml',
      };
    }
    
    // Verify we can read the document.xml content
    const content = await documentXml.async('string');
    if (!content || content.length === 0) {
      return {
        isValid: false,
        error: 'Invalid Word document: word/document.xml is empty',
      };
    }
    
    return { isValid: true };
  } catch (error) {
    // Handle ZIP parsing errors
    if (error instanceof Error) {
      if (error.message.includes('not a valid zip file') || 
          error.message.includes('End of data reached')) {
        return {
          isValid: false,
          error: 'Invalid file format: not a valid ZIP archive',
        };
      }
      return {
        isValid: false,
        error: `Invalid file: ${error.message}`,
      };
    }
    return {
      isValid: false,
      error: 'Invalid file: unknown error during validation',
    };
  }
}

/**
 * Extracts placeholder names from a .docx file
 * Placeholders are in the format {{name}} where name contains alphanumeric characters and underscores
 * 
 * @param fileBuffer - The .docx file content as a Buffer
 * @returns PlaceholderExtractionResult with array of unique placeholder names
 */
export async function extractPlaceholders(
  fileBuffer: Buffer
): Promise<PlaceholderExtractionResult> {
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    const documentXml = zip.file('word/document.xml');
    
    if (!documentXml) {
      return {
        success: false,
        placeholders: [],
        error: 'Invalid Word document: missing word/document.xml',
      };
    }
    
    const content = await documentXml.async('string');
    
    // Extract placeholders using regex
    // Pattern matches {{name}} where name is alphanumeric with underscores
    // Note: In Word XML, the placeholder might be split across XML tags
    // We need to handle both clean text and XML-fragmented placeholders
    
    // First, try to extract from clean text (remove XML tags for matching)
    const textContent = content.replace(/<[^>]+>/g, '');
    const placeholderRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
    
    const placeholders = new Set<string>();
    let match: RegExpExecArray | null;
    
    while ((match = placeholderRegex.exec(textContent)) !== null) {
      const placeholderName = match[1];
      // Filter out _translated placeholders - these are auto-generated during report generation
      if (!placeholderName.endsWith('_translated')) {
        placeholders.add(placeholderName);
      }
    }
    
    return {
      success: true,
      placeholders: Array.from(placeholders),
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        placeholders: [],
        error: `Failed to extract placeholders: ${error.message}`,
      };
    }
    return {
      success: false,
      placeholders: [],
      error: 'Failed to extract placeholders: unknown error',
    };
  }
}
