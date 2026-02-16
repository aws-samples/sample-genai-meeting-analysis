/**
 * Property-based tests for merge utilities
 * 
 * Tests the template merging functions for correctness properties.
 * 
 * **Feature: word-template-translation, Property 7: Valid DOCX Output**
 * **Validates: Requirements 5.1, 5.2, 5.5**
 */

import * as fc from 'fast-check';
import JSZip from 'jszip';
import { mergeTemplate } from './merge-utils';

/**
 * Helper function to create a minimal valid .docx file buffer with placeholders.
 * Creates a complete DOCX structure that docxtemplater can process.
 */
async function createValidDocxBuffer(documentXmlContent: string): Promise<Buffer> {
  const zip = new JSZip();
  
  // Document content
  zip.file('word/document.xml', documentXmlContent);
  
  // Content Types - required for docxtemplater to identify file type
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);
  
  // Root relationships - required for docxtemplater
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  zip.file('_rels/.rels', rels);
  
  // Document relationships - required for docxtemplater
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  zip.file('word/_rels/document.xml.rels', docRels);
  
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}

/**
 * Helper function to create a minimal document.xml with text content
 */
function createDocumentXml(textContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${textContent}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;
}

/**
 * Arbitrary for generating valid placeholder names
 * Placeholder names must start with a letter or underscore, followed by alphanumeric or underscore
 */
const placeholderNameArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,19}$/);

/**
 * Arbitrary for generating placeholder values (simple alphanumeric strings to avoid XML issues)
 */
const placeholderValueArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

/**
 * Arbitrary for generating data objects with placeholder names and values
 */
const dataObjectArb = fc.dictionary(placeholderNameArb, placeholderValueArb, {
  minKeys: 0,
  maxKeys: 10,
});

describe('merge-utils property tests', () => {
  /**
   * **Feature: word-template-translation, Property 7: Valid DOCX Output**
   * 
   * For any valid template and data object, the merge function SHALL produce 
   * a valid .docx file that can be parsed and contains the merged content.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.5**
   */
  describe('Property 7: Valid DOCX Output', () => {
    it('mergeTemplate produces valid ZIP archive for any valid template and data', async () => {
      await fc.assert(
        fc.asyncProperty(
          dataObjectArb,
          async (data) => {
            // Create a template with placeholders matching the data keys
            const placeholderText = Object.keys(data).length > 0
              ? Object.keys(data).map(k => `{{${k}}}`).join(' ')
              : 'No placeholders';
            
            const templateBuffer = await createValidDocxBuffer(
              createDocumentXml(placeholderText)
            );
            
            const result = mergeTemplate(templateBuffer, data);
            
            // The merge should succeed
            if (!result.success || !result.documentBuffer) {
              return false;
            }
            
            // The output should be a valid ZIP archive
            try {
              const outputZip = await JSZip.loadAsync(result.documentBuffer);
              const documentXml = outputZip.file('word/document.xml');
              
              // Must contain word/document.xml
              if (!documentXml) {
                return false;
              }
              
              // Must be able to read the content
              const content = await documentXml.async('string');
              return content.length > 0;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('merged document contains the data values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 5 }),
          async (data) => {
            // Create a template with placeholders matching the data keys
            const placeholderText = Object.keys(data).map(k => `{{${k}}}`).join(' ');
            
            const templateBuffer = await createValidDocxBuffer(
              createDocumentXml(placeholderText)
            );
            
            const result = mergeTemplate(templateBuffer, data);
            
            if (!result.success || !result.documentBuffer) {
              return false;
            }
            
            // Read the merged document content
            const outputZip = await JSZip.loadAsync(result.documentBuffer);
            const documentXml = outputZip.file('word/document.xml');
            
            if (!documentXml) {
              return false;
            }
            
            const content = await documentXml.async('string');
            
            // All data values should appear in the merged document
            for (const value of Object.values(data)) {
              if (!content.includes(value)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('placeholders are replaced and not present in output', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 5 }),
          async (data) => {
            // Create a template with placeholders matching the data keys
            const placeholderText = Object.keys(data).map(k => `{{${k}}}`).join(' ');
            
            const templateBuffer = await createValidDocxBuffer(
              createDocumentXml(placeholderText)
            );
            
            const result = mergeTemplate(templateBuffer, data);
            
            if (!result.success || !result.documentBuffer) {
              return false;
            }
            
            // Read the merged document content
            const outputZip = await JSZip.loadAsync(result.documentBuffer);
            const documentXml = outputZip.file('word/document.xml');
            
            if (!documentXml) {
              return false;
            }
            
            const content = await documentXml.async('string');
            
            // Placeholders should be replaced (not present in output)
            for (const key of Object.keys(data)) {
              if (content.includes(`{{${key}}}`)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('undefined placeholders are replaced with empty strings by default', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(placeholderNameArb, { minLength: 1, maxLength: 5 }),
          async (placeholderNames) => {
            // Create a template with placeholders
            const placeholderText = placeholderNames.map(k => `{{${k}}}`).join(' ');
            
            const templateBuffer = await createValidDocxBuffer(
              createDocumentXml(placeholderText)
            );
            
            // Provide empty data object (no values for placeholders)
            const result = mergeTemplate(templateBuffer, {});
            
            if (!result.success || !result.documentBuffer) {
              return false;
            }
            
            // Read the merged document content
            const outputZip = await JSZip.loadAsync(result.documentBuffer);
            const documentXml = outputZip.file('word/document.xml');
            
            if (!documentXml) {
              return false;
            }
            
            const content = await documentXml.async('string');
            
            // Placeholders should be replaced (not present in output)
            for (const name of placeholderNames) {
              if (content.includes(`{{${name}}}`)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('merge preserves document structure', async () => {
      await fc.assert(
        fc.asyncProperty(
          dataObjectArb,
          async (data) => {
            const placeholderText = Object.keys(data).length > 0
              ? Object.keys(data).map(k => `{{${k}}}`).join(' ')
              : 'Static content';
            
            const templateBuffer = await createValidDocxBuffer(
              createDocumentXml(placeholderText)
            );
            
            const result = mergeTemplate(templateBuffer, data);
            
            if (!result.success || !result.documentBuffer) {
              return false;
            }
            
            // Verify the output maintains valid DOCX structure
            const outputZip = await JSZip.loadAsync(result.documentBuffer);
            
            // Check for required DOCX components
            const hasDocumentXml = outputZip.file('word/document.xml') !== null;
            const hasContentTypes = outputZip.file('[Content_Types].xml') !== null;
            
            return hasDocumentXml && hasContentTypes;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
