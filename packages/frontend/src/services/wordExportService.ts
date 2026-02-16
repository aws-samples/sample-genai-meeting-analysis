/**
 * Word Export Service
 * 
 * Converts meeting reports to Microsoft Word (.docx) format for download.
 * Uses the docx library for client-side document generation.
 */

import { MeetingReport, PlaceholderValue, AgendaPoint } from '@meeting-platform/shared';
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  HighlightColor,
  Packer,
} from 'docx';
import { saveAs } from 'file-saver';

/**
 * Options for customizing Word document export
 */
export interface WordExportOptions {
  /** Include timestamp in document metadata (default: true) */
  includeTimestamp?: boolean;
  /** Highlight unfilled placeholders with visual indicator (default: true) */
  highlightUnfilled?: boolean;
}

/**
 * Result of a Word export operation
 */
export interface WordExportResult {
  /** Whether the export was successful */
  success: boolean;
  /** Generated filename (only present on success) */
  filename?: string;
  /** Error message (only present on failure) */
  error?: string;
}

/**
 * Represents a parsed element from markdown content
 */
export interface DocxElement {
  type: 'paragraph' | 'heading' | 'bulletList' | 'numberedList';
  level?: number;
  content: string;
  children?: TextRunElement[];
}

/**
 * Represents a text run with formatting
 */
export interface TextRunElement {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Represents a placeholder match found in text
 */
export interface PlaceholderMatch {
  /** Full match including braces (e.g., "{{name}}") */
  fullMatch: string;
  /** Placeholder name without braces (e.g., "name") */
  name: string;
  /** Start index in the original string */
  startIndex: number;
  /** End index in the original string */
  endIndex: number;
}

/**
 * Represents a processed placeholder with its resolved value and status
 */
export interface ProcessedPlaceholder {
  /** The placeholder name */
  name: string;
  /** The resolved value (either filled value or unfilled indicator) */
  value: string;
  /** Whether the placeholder is filled */
  isFilled: boolean;
  /** Whether the placeholder was manually edited */
  isManuallyEdited: boolean;
}

/**
 * Finds all placeholder patterns in text
 * Placeholders are in the format {{placeholderName}}
 * 
 * @param text - The text to search for placeholders
 * @returns Array of PlaceholderMatch objects
 */
export function findPlaceholders(text: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      name: match[1].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }
  
  return matches;
}

/**
 * Resolves a placeholder to its value from the placeholders record
 * Requirements: 3.1 - Render placeholder value inline with surrounding text
 * Requirements: 3.3 - Include edited value in export
 * 
 * @param name - The placeholder name
 * @param placeholders - Record of placeholder values
 * @returns ProcessedPlaceholder with resolved value and status
 */
export function resolvePlaceholder(
  name: string,
  placeholders: Record<string, PlaceholderValue>
): ProcessedPlaceholder {
  const placeholder = placeholders[name];
  
  if (!placeholder) {
    // Placeholder not found in record - treat as unfilled
    return {
      name,
      value: `[UNFILLED: ${name}]`,
      isFilled: false,
      isManuallyEdited: false
    };
  }
  
  if (placeholder.isFilled) {
    // Filled placeholder - use the value (which may be manually edited)
    return {
      name,
      value: placeholder.value,
      isFilled: true,
      isManuallyEdited: placeholder.isManuallyEdited || false
    };
  }
  
  // Unfilled placeholder - use visual indicator
  return {
    name,
    value: `[UNFILLED: ${name}]`,
    isFilled: false,
    isManuallyEdited: false
  };
}

/**
 * Substitutes all placeholders in text with their resolved values
 * Requirements: 3.1 - Replace {{placeholder}} patterns with actual values
 * Requirements: 3.3 - Handle both filled and unfilled placeholders
 * 
 * @param text - The text containing placeholders
 * @param placeholders - Record of placeholder values
 * @returns Text with placeholders substituted
 */
export function substitutePlaceholders(
  text: string,
  placeholders: Record<string, PlaceholderValue>
): string {
  const matches = findPlaceholders(text);
  
  if (matches.length === 0) {
    return text;
  }
  
  let result = text;
  // Process matches in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const resolved = resolvePlaceholder(match.name, placeholders);
    result = result.slice(0, match.startIndex) + resolved.value + result.slice(match.endIndex);
  }
  
  return result;
}

/**
 * Parses inline text formatting (bold and italic) from markdown
 * Requirements: 2.2 - Preserve bold and italic text formatting
 * 
 * @param text - The text to parse for inline formatting
 * @returns Array of TextRunElement with formatting applied
 */
export function parseInlineFormatting(text: string): TextRunElement[] {
  const elements: TextRunElement[] = [];
  
  // Regex to match bold (**text** or __text__) and italic (*text* or _text_)
  // Order matters: check bold first (** or __), then italic (* or _)
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_([^_]+)_)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add any text before this match as plain text
    if (match.index > lastIndex) {
      elements.push({ text: text.slice(lastIndex, match.index) });
    }
    
    // Determine if it's bold or italic
    if (match[2] !== undefined) {
      // Bold with **
      elements.push({ text: match[2], bold: true });
    } else if (match[3] !== undefined) {
      // Bold with __
      elements.push({ text: match[3], bold: true });
    } else if (match[4] !== undefined) {
      // Italic with *
      elements.push({ text: match[4], italic: true });
    } else if (match[5] !== undefined) {
      // Italic with _
      elements.push({ text: match[5], italic: true });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text after the last match
  if (lastIndex < text.length) {
    elements.push({ text: text.slice(lastIndex) });
  }
  
  // If no formatting was found, return the original text
  if (elements.length === 0) {
    elements.push({ text });
  }
  
  return elements;
}

/**
 * Parses markdown content into DocxElement array
 * Requirements: 2.1 - Preserve heading hierarchy (H1, H2, H3)
 * Requirements: 2.2 - Preserve bold and italic text formatting
 * Requirements: 2.3 - Preserve bullet and numbered lists
 * 
 * @param markdown - The markdown content to parse
 * @returns Array of DocxElement representing the document structure
 */
export function parseMarkdownToDocxElements(markdown: string): DocxElement[] {
  const elements: DocxElement[] = [];
  const lines = markdown.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }
    
    // Check for headings (# ## ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      elements.push({
        type: 'heading',
        level,
        content,
        children: parseInlineFormatting(content)
      });
      i++;
      continue;
    }
    
    // Check for bullet list items (- item or * item)
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      elements.push({
        type: 'bulletList',
        content: bulletMatch[1],
        children: parseInlineFormatting(bulletMatch[1])
      });
      i++;
      continue;
    }
    
    // Check for numbered list items (1. item, 2. item, etc.)
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      elements.push({
        type: 'numberedList',
        content: numberedMatch[1],
        children: parseInlineFormatting(numberedMatch[1])
      });
      i++;
      continue;
    }
    
    // Regular paragraph
    elements.push({
      type: 'paragraph',
      content: line,
      children: parseInlineFormatting(line)
    });
    i++;
  }
  
  return elements;
}

/**
 * Maps heading level to docx HeadingLevel
 * Requirements: 2.1 - Map H1 to HeadingLevel.HEADING_1, H2 to HEADING_2, H3 to HEADING_3
 * 
 * @param level - The heading level (1, 2, or 3)
 * @returns The corresponding HeadingLevel enum value
 */
export function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    default:
      return HeadingLevel.HEADING_3;
  }
}

/**
 * Creates TextRun elements from TextRunElement array
 * Requirements: 2.2 - Convert to docx TextRun with bold/italics properties
 * 
 * @param children - Array of TextRunElement with formatting
 * @returns Array of docx TextRun objects
 */
export function createTextRuns(children: TextRunElement[]): TextRun[] {
  return children.map(child => new TextRun({
    text: child.text,
    bold: child.bold,
    italics: child.italic
  }));
}

/**
 * Extended TextRunElement that includes placeholder information
 */
export interface TextRunWithPlaceholder extends TextRunElement {
  /** Whether this text run represents an unfilled placeholder */
  isUnfilledPlaceholder?: boolean;
  /** The original placeholder name if this is a placeholder */
  placeholderName?: string;
}

/**
 * Parses text with placeholders and inline formatting
 * Requirements: 3.1 - Replace {{placeholder}} patterns with actual values
 * Requirements: 3.2 - Render unfilled placeholders with visual indicator
 * Requirements: 3.3 - Include edited value in export
 * 
 * @param text - The text to parse
 * @param placeholders - Record of placeholder values
 * @returns Array of TextRunWithPlaceholder with formatting and placeholder info
 */
export function parseTextWithPlaceholders(
  text: string,
  placeholders: Record<string, PlaceholderValue>
): TextRunWithPlaceholder[] {
  const elements: TextRunWithPlaceholder[] = [];
  const placeholderMatches = findPlaceholders(text);
  
  if (placeholderMatches.length === 0) {
    // No placeholders, just parse inline formatting
    return parseInlineFormatting(text);
  }
  
  let lastIndex = 0;
  
  for (const match of placeholderMatches) {
    // Add text before this placeholder (with inline formatting)
    if (match.startIndex > lastIndex) {
      const beforeText = text.slice(lastIndex, match.startIndex);
      elements.push(...parseInlineFormatting(beforeText));
    }
    
    // Resolve and add the placeholder
    const resolved = resolvePlaceholder(match.name, placeholders);
    
    if (resolved.isFilled) {
      // Filled placeholder - add as regular text (may contain formatting)
      elements.push(...parseInlineFormatting(resolved.value));
    } else {
      // Unfilled placeholder - mark for special styling
      elements.push({
        text: resolved.value,
        isUnfilledPlaceholder: true,
        placeholderName: match.name
      });
    }
    
    lastIndex = match.endIndex;
  }
  
  // Add any remaining text after the last placeholder
  if (lastIndex < text.length) {
    elements.push(...parseInlineFormatting(text.slice(lastIndex)));
  }
  
  return elements;
}

/**
 * Creates TextRun elements with placeholder styling support
 * Requirements: 3.2 - Render unfilled placeholders with visual indicator (yellow highlight)
 * 
 * @param children - Array of TextRunWithPlaceholder with formatting and placeholder info
 * @param highlightUnfilled - Whether to apply highlight to unfilled placeholders
 * @returns Array of docx TextRun objects
 */
export function createTextRunsWithPlaceholders(
  children: TextRunWithPlaceholder[],
  highlightUnfilled: boolean = true
): TextRun[] {
  return children.map(child => {
    const options: {
      text: string;
      bold?: boolean;
      italics?: boolean;
      highlight?: (typeof HighlightColor)[keyof typeof HighlightColor];
    } = {
      text: child.text,
      bold: child.bold,
      italics: child.italic
    };
    
    // Apply yellow highlight to unfilled placeholders
    if (child.isUnfilledPlaceholder && highlightUnfilled) {
      options.highlight = HighlightColor.YELLOW;
    }
    
    return new TextRun(options);
  });
}

/**
 * Converts a DocxElement to a docx Paragraph
 * Requirements: 2.1, 2.2, 2.3 - Convert markdown elements to docx Paragraphs
 * 
 * @param element - The DocxElement to convert
 * @param numbering - Optional numbering configuration for lists
 * @returns A docx Paragraph object
 */
export function createDocxParagraph(
  element: DocxElement,
  numbering?: { reference: string; level: number }
): Paragraph {
  const children = element.children || [{ text: element.content }];
  const textRuns = createTextRuns(children);
  
  switch (element.type) {
    case 'heading':
      return new Paragraph({
        children: textRuns,
        heading: getHeadingLevel(element.level || 1),
        spacing: { before: 240, after: 120 }
      });
    
    case 'bulletList':
      return new Paragraph({
        children: textRuns,
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 }
      });
    
    case 'numberedList':
      if (numbering) {
        return new Paragraph({
          children: textRuns,
          numbering: {
            reference: numbering.reference,
            level: numbering.level
          },
          spacing: { before: 60, after: 60 }
        });
      }
      // Fallback if no numbering config provided
      return new Paragraph({
        children: textRuns,
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 }
      });
    
    case 'paragraph':
    default:
      return new Paragraph({
        children: textRuns,
        alignment: AlignmentType.LEFT,
        spacing: { before: 120, after: 120 }
      });
  }
}

/**
 * Converts markdown content to an array of docx Paragraphs
 * Requirements: 2.1, 2.2, 2.3 - Full markdown to DOCX conversion
 * 
 * @param markdown - The markdown content to convert
 * @param numberingReference - Optional reference for numbered lists
 * @returns Array of docx Paragraph objects
 */
export function convertMarkdownToDocxParagraphs(
  markdown: string,
  numberingReference?: string
): Paragraph[] {
  const elements = parseMarkdownToDocxElements(markdown);
  const paragraphs: Paragraph[] = [];
  
  let numberedListIndex = 0;
  
  for (const element of elements) {
    if (element.type === 'numberedList' && numberingReference) {
      paragraphs.push(createDocxParagraph(element, {
        reference: numberingReference,
        level: 0
      }));
      numberedListIndex++;
    } else {
      paragraphs.push(createDocxParagraph(element));
      // Reset numbered list index when we hit a non-numbered element
      if (element.type !== 'numberedList') {
        numberedListIndex = 0;
      }
    }
  }
  
  return paragraphs;
}

/**
 * Extended DocxElement that includes placeholder-aware children
 */
export interface DocxElementWithPlaceholders extends Omit<DocxElement, 'children'> {
  children?: TextRunWithPlaceholder[];
}

/**
 * Parses markdown content with placeholder substitution
 * Requirements: 2.1, 2.2, 2.3 - Preserve markdown formatting
 * Requirements: 3.1, 3.2, 3.3 - Handle placeholders
 * 
 * @param markdown - The markdown content to parse
 * @param placeholders - Record of placeholder values
 * @returns Array of DocxElementWithPlaceholders
 */
export function parseMarkdownWithPlaceholders(
  markdown: string,
  placeholders: Record<string, PlaceholderValue>
): DocxElementWithPlaceholders[] {
  const elements: DocxElementWithPlaceholders[] = [];
  const lines = markdown.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }
    
    // Check for headings (# ## ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      elements.push({
        type: 'heading',
        level,
        content,
        children: parseTextWithPlaceholders(content, placeholders)
      });
      i++;
      continue;
    }
    
    // Check for bullet list items (- item or * item)
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      elements.push({
        type: 'bulletList',
        content: bulletMatch[1],
        children: parseTextWithPlaceholders(bulletMatch[1], placeholders)
      });
      i++;
      continue;
    }
    
    // Check for numbered list items (1. item, 2. item, etc.)
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      elements.push({
        type: 'numberedList',
        content: numberedMatch[1],
        children: parseTextWithPlaceholders(numberedMatch[1], placeholders)
      });
      i++;
      continue;
    }
    
    // Regular paragraph
    elements.push({
      type: 'paragraph',
      content: line,
      children: parseTextWithPlaceholders(line, placeholders)
    });
    i++;
  }
  
  return elements;
}

/**
 * Creates a docx Paragraph from a DocxElementWithPlaceholders
 * Requirements: 2.1, 2.2, 2.3 - Convert markdown elements to docx Paragraphs
 * Requirements: 3.2 - Apply visual indicator to unfilled placeholders
 * 
 * @param element - The DocxElementWithPlaceholders to convert
 * @param options - Configuration options
 * @param numbering - Optional numbering configuration for lists
 * @returns A docx Paragraph object
 */
export function createDocxParagraphWithPlaceholders(
  element: DocxElementWithPlaceholders,
  options: { highlightUnfilled?: boolean } = {},
  numbering?: { reference: string; level: number }
): Paragraph {
  const { highlightUnfilled = true } = options;
  const children = element.children || [{ text: element.content }];
  const textRuns = createTextRunsWithPlaceholders(children, highlightUnfilled);
  
  switch (element.type) {
    case 'heading':
      return new Paragraph({
        children: textRuns,
        heading: getHeadingLevel(element.level || 1),
        spacing: { before: 240, after: 120 }
      });
    
    case 'bulletList':
      return new Paragraph({
        children: textRuns,
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 }
      });
    
    case 'numberedList':
      if (numbering) {
        return new Paragraph({
          children: textRuns,
          numbering: {
            reference: numbering.reference,
            level: numbering.level
          },
          spacing: { before: 60, after: 60 }
        });
      }
      // Fallback if no numbering config provided
      return new Paragraph({
        children: textRuns,
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 }
      });
    
    case 'paragraph':
    default:
      return new Paragraph({
        children: textRuns,
        alignment: AlignmentType.LEFT,
        spacing: { before: 120, after: 120 }
      });
  }
}

/**
 * Converts markdown content with placeholders to an array of docx Paragraphs
 * Requirements: 2.1, 2.2, 2.3 - Full markdown to DOCX conversion
 * Requirements: 3.1, 3.2, 3.3 - Handle placeholders with proper styling
 * 
 * @param markdown - The markdown content to convert
 * @param placeholders - Record of placeholder values
 * @param options - Configuration options
 * @param numberingReference - Optional reference for numbered lists
 * @returns Array of docx Paragraph objects
 */
export function convertMarkdownWithPlaceholdersToDocxParagraphs(
  markdown: string,
  placeholders: Record<string, PlaceholderValue>,
  options: { highlightUnfilled?: boolean } = {},
  numberingReference?: string
): Paragraph[] {
  const elements = parseMarkdownWithPlaceholders(markdown, placeholders);
  const paragraphs: Paragraph[] = [];
  
  let numberedListIndex = 0;
  
  for (const element of elements) {
    if (element.type === 'numberedList' && numberingReference) {
      paragraphs.push(createDocxParagraphWithPlaceholders(element, options, {
        reference: numberingReference,
        level: 0
      }));
      numberedListIndex++;
    } else {
      paragraphs.push(createDocxParagraphWithPlaceholders(element, options));
      // Reset numbered list index when we hit a non-numbered element
      if (element.type !== 'numberedList') {
        numberedListIndex = 0;
      }
    }
  }
  
  return paragraphs;
}

/**
 * Creates paragraphs for the agenda points section
 * Requirements: 2.4 - Format each agenda point with its decision as a distinct section
 * 
 * @param agendaPoints - Array of agenda points to format
 * @returns Array of docx Paragraph objects representing the agenda section
 */
export function createAgendaPointsParagraphs(agendaPoints: AgendaPoint[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  if (!agendaPoints || agendaPoints.length === 0) {
    return paragraphs;
  }
  
  // Add section heading for Agenda Points
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: 'Agenda Points', bold: true })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 200 }
  }));
  
  // Add each agenda point as a numbered subsection
  agendaPoints.forEach((agendaPoint, index) => {
    const pointNumber = index + 1;
    
    // Agenda point heading (numbered)
    paragraphs.push(new Paragraph({
      children: [
        new TextRun({ text: `${pointNumber}. ${agendaPoint.point}`, bold: true })
      ],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 240, after: 120 }
    }));
    
    // Decision label and text
    if (agendaPoint.decision && agendaPoint.decision.trim() !== '') {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: 'Decision: ', bold: true }),
          new TextRun({ text: agendaPoint.decision })
        ],
        alignment: AlignmentType.LEFT,
        spacing: { before: 60, after: 120 }
      }));
    } else {
      // No decision recorded
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: 'Decision: ', bold: true }),
          new TextRun({ text: 'No decision recorded', italics: true })
        ],
        alignment: AlignmentType.LEFT,
        spacing: { before: 60, after: 120 }
      }));
    }
  });
  
  return paragraphs;
}

/**
 * Generates a filename for the exported Word document
 * Requirements: 1.3 - Use format "meeting-report-{meetingId}-{timestamp}.docx"
 * 
 * @param meetingId - The meeting ID to include in the filename
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns The generated filename
 */
export function generateFilename(meetingId: string, timestamp?: Date): string {
  const date = timestamp || new Date();
  // Format: YYYYMMDD-HHmmss for uniqueness and readability
  const isoTimestamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\.\d{3}Z$/, '');
  
  return `meeting-report-${meetingId}-${isoTimestamp}.docx`;
}

/**
 * Creates the document title paragraph
 * 
 * @returns A Paragraph for the document title
 */
function createTitleParagraph(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: 'Meeting Report',
        bold: true,
        size: 48, // 24pt
      })
    ],
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 }
  });
}

/**
 * Creates the document metadata paragraph with generation date
 * 
 * @param generatedAt - Timestamp when the report was generated
 * @returns A Paragraph for the metadata
 */
function createMetadataParagraph(generatedAt: number): Paragraph {
  const date = new Date(generatedAt);
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  return new Paragraph({
    children: [
      new TextRun({
        text: `Generated: ${formattedDate}`,
        italics: true,
        color: '666666'
      })
    ],
    spacing: { after: 400 }
  });
}

/**
 * Triggers a browser download of the generated blob
 * Requirements: 1.2 - Automatically trigger browser download
 * 
 * @param blob - The blob to download
 * @param filename - The filename for the download
 * @throws Error if download fails
 */
function triggerDownload(blob: Blob, filename: string): void {
  try {
    saveAs(blob, filename);
  } catch (error) {
    throw new Error('Download was blocked. Please allow downloads and try again.');
  }
}

/**
 * Exports a meeting report to a Word document and triggers browser download.
 * Requirements: 1.1 - Generate .docx file containing full report content
 * Requirements: 1.2 - Automatically trigger browser download
 * Requirements: 1.3 - Use format "meeting-report-{meetingId}-{timestamp}.docx"
 * Requirements: 1.4 - Display error message on failure
 * 
 * @param report - The meeting report to export
 * @param options - Optional export configuration
 * @returns Promise resolving to the export result
 */
export async function exportReportToWord(
  report: MeetingReport,
  options?: WordExportOptions
): Promise<WordExportResult> {
  const { includeTimestamp = true, highlightUnfilled = true } = options || {};
  
  try {
    // Validate report content
    if (!report.reportContent || report.reportContent.trim() === '') {
      return {
        success: false,
        error: 'Cannot export empty report'
      };
    }
    
    // Build document sections
    const sections: Paragraph[] = [];
    
    // Add title
    sections.push(createTitleParagraph());
    
    // Add metadata with timestamp if requested
    if (includeTimestamp) {
      sections.push(createMetadataParagraph(report.generatedAt));
    }
    
    // Convert report content (markdown) to DOCX paragraphs with placeholder handling
    const contentParagraphs = convertMarkdownWithPlaceholdersToDocxParagraphs(
      report.reportContent,
      report.placeholders || {},
      { highlightUnfilled }
    );
    sections.push(...contentParagraphs);
    
    // Add agenda points section if present
    if (report.agendaPoints && report.agendaPoints.length > 0) {
      const agendaParagraphs = createAgendaPointsParagraphs(report.agendaPoints);
      sections.push(...agendaParagraphs);
    }
    
    // Create the Document
    const doc = new Document({
      title: 'Meeting Report',
      description: `Meeting report for ${report.meetingId}`,
      creator: 'Meeting Analysis Platform',
      sections: [{
        properties: {},
        children: sections
      }]
    });
    
    // Generate blob using Packer
    const blob = await Packer.toBlob(doc);
    
    // Generate filename
    const filename = generateFilename(report.meetingId);
    
    // Trigger browser download
    triggerDownload(blob, filename);
    
    return {
      success: true,
      filename
    };
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Failed to generate document. Please try again.';
    
    return {
      success: false,
      error: errorMessage
    };
  }
}
