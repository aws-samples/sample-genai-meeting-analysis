import JSZip from 'jszip';
import { validateDocxFile, extractPlaceholders } from './docx-utils';

/**
 * Helper function to create a minimal valid .docx file buffer
 */
async function createValidDocxBuffer(documentXmlContent: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXmlContent);
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types></Types>');
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

describe('docx-utils', () => {
  describe('validateDocxFile', () => {
    it('should validate a valid .docx file', async () => {
      const docxBuffer = await createValidDocxBuffer(createDocumentXml('Hello World'));
      const result = await validateDocxFile(docxBuffer);
      
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject non-ZIP files', async () => {
      const invalidBuffer = Buffer.from('This is not a ZIP file');
      const result = await validateDocxFile(invalidBuffer);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject ZIP files without word/document.xml', async () => {
      const zip = new JSZip();
      zip.file('some-other-file.txt', 'content');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      
      const result = await validateDocxFile(buffer);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('missing word/document.xml');
    });

    it('should reject empty buffers', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await validateDocxFile(emptyBuffer);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('extractPlaceholders', () => {
    it('should extract single placeholder', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('Hello {{name}}!')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('name');
      expect(result.placeholders).toHaveLength(1);
    });

    it('should extract multiple placeholders', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('Meeting on {{date}} at {{location}} with {{attendees}}')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('date');
      expect(result.placeholders).toContain('location');
      expect(result.placeholders).toContain('attendees');
      expect(result.placeholders).toHaveLength(3);
    });

    it('should return unique placeholders only', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('{{name}} and {{name}} again')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('name');
      expect(result.placeholders).toHaveLength(1);
    });

    it('should handle placeholders with underscores', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('{{meeting_date}} and {{action_items}}')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('meeting_date');
      expect(result.placeholders).toContain('action_items');
    });

    it('should return empty array for documents without placeholders', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('No placeholders here')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toHaveLength(0);
    });

    it('should fail for invalid .docx files', async () => {
      const invalidBuffer = Buffer.from('Not a valid docx');
      const result = await extractPlaceholders(invalidBuffer);
      
      expect(result.success).toBe(false);
      expect(result.placeholders).toHaveLength(0);
      expect(result.error).toBeDefined();
    });

    it('should ignore placeholders ending with _translated', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('{{agenda_points}} and {{agenda_points_translated}} and {{summary}} and {{summary_translated}}')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('agenda_points');
      expect(result.placeholders).toContain('summary');
      expect(result.placeholders).not.toContain('agenda_points_translated');
      expect(result.placeholders).not.toContain('summary_translated');
      expect(result.placeholders).toHaveLength(2);
    });

    it('should include placeholders with translated in the middle of the name', async () => {
      const docxBuffer = await createValidDocxBuffer(
        createDocumentXml('{{translated_content}} and {{my_translated_field}}')
      );
      const result = await extractPlaceholders(docxBuffer);
      
      expect(result.success).toBe(true);
      expect(result.placeholders).toContain('translated_content');
      expect(result.placeholders).toContain('my_translated_field');
      expect(result.placeholders).toHaveLength(2);
    });
  });
});
