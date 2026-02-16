/**
 * Report template and meeting report types
 */

/**
 * Citation reference linking report content to transcript segments
 */
export interface Citation {
  startTime: number;  // milliseconds
  endTime: number;    // milliseconds
}

/**
 * Placeholder value with fill status and citation
 */
export interface PlaceholderValue {
  value: string;
  citation: Citation;
  isFilled: boolean;
  isManuallyEdited?: boolean;
  lastEditedAt?: number;
  originalValue?: string;
}

/**
 * Agenda point with associated decision and citations
 */
export interface AgendaPoint {
  point: string;
  citation: Citation;
  decision: string;
  decisionCitation: Citation;
}

/**
 * Report template entity
 */
export interface ReportTemplate {
  templateId: string;
  templateName: string;
  templateContent: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Meeting report status
 */
export type ReportStatus = 'generating' | 'completed' | 'failed';

/**
 * Placeholder edit history entry for audit trail
 */
export interface PlaceholderEditHistoryEntry {
  placeholderName: string;
  oldValue: string;
  newValue: string;
  editedAt: number;
  editedBy: string;  // userId
}

/**
 * Meeting report entity
 */
export interface MeetingReport {
  meetingId: string;
  reportId: string;
  templateId: string;
  reportContent: string;  // Rendered HTML/text with citations
  placeholders: Record<string, PlaceholderValue>;
  agendaPoints: AgendaPoint[];
  generatedAt: number;
  status: ReportStatus;
  errorMessage?: string;
  placeholderEditHistory?: PlaceholderEditHistoryEntry[];  // Optional audit trail
}

/**
 * Editable placeholder with metadata for UI state management
 */
export interface EditablePlaceholder {
  name: string;
  value: string;
  isFilled: boolean;
  isManuallyEdited: boolean;
  citation?: Citation;
  lastEditedAt?: number;
  originalValue?: string;
}

/**
 * Placeholder edit event for tracking changes
 */
export interface PlaceholderEditEvent {
  placeholderName: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
}

/**
 * Report edit state for managing placeholder editing in UI
 */
export interface ReportEditState {
  editingPlaceholder: string | null;
  savingPlaceholders: Set<string>;
  placeholderValues: Map<string, EditablePlaceholder>;
  editHistory: PlaceholderEditEvent[];
}
