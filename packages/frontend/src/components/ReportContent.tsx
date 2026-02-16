import React, { useMemo, useState, useRef, useCallback } from 'react';
import { Box, SpaceBetween, Alert, Button, Spinner } from '@cloudscape-design/components';
import ReactMarkdown from 'react-markdown';
import type { MeetingReport, EditablePlaceholder as EditablePlaceholderType } from '@meeting-platform/shared';
import { EditablePlaceholder } from './EditablePlaceholder';
import { PlaceholderEditor } from './PlaceholderEditor';
import apiClient from '../lib/api-client';
import { 
  generateWordReport, 
  getWordReport,
  triggerDownload,
  getWordTemplateConfig 
} from '../services/wordTemplateService';

interface ReportContentProps {
  report: MeetingReport | null;
  isLoading: boolean;
  error: string | null;
  isRegenerating: boolean;
  onRegenerate: () => void;
  onCitationClick: (timestamp: number) => void;
}

export const ReportContent: React.FC<ReportContentProps> = ({
  report,
  isLoading,
  error,
  isRegenerating,
  onRegenerate,
  onCitationClick,
}) => {
  // Task 7.1: Add placeholder state management
  // Track editing by unique key: "placeholderName-instanceIndex"
  const [editingPlaceholder, setEditingPlaceholder] = useState<string | null>(null);
  const [savingPlaceholders, setSavingPlaceholders] = useState<Set<string>>(new Set());
  const [placeholderValues, setPlaceholderValues] = useState<Map<string, EditablePlaceholderType>>(new Map());
  const [placeholderErrors, setPlaceholderErrors] = useState<Map<string, string>>(new Map());
  const [focusedPlaceholder, setFocusedPlaceholder] = useState<string | null>(null);
  
  // Task 14.1: Add Word report generation state management
  const [isGeneratingWordReport, setIsGeneratingWordReport] = useState(false);
  const [wordReportError, setWordReportError] = useState<string | null>(null);
  const [wordReportSuccess, setWordReportSuccess] = useState(false);
  const [hasWordTemplate, setHasWordTemplate] = useState<boolean | null>(null);
  
  // Task 14.2: Add Word report download state management
  const [isDownloadingWordReport, setIsDownloadingWordReport] = useState(false);
  const [existingWordReport, setExistingWordReport] = useState<{ filename: string; generatedAt: number } | null>(null);
  

  
  // Task 9.1: Queue for pending save operations
  const saveQueue = useRef<Map<string, { value: string; timestamp: number }>>(new Map());
  
  // Refs map for keyboard navigation (reserved for future keyboard navigation feature)
  // const editableRefs = useRef<Map<string, React.RefObject<HTMLSpanElement>>>(new Map());
  const orderedPlaceholderNames = useRef<string[]>([]);

  // Task 7.2: Implement placeholder parsing logic
  // Parse report content to extract all placeholders and build map
  const parsedPlaceholders = useMemo(() => {
    if (!report || !report.placeholders) {
      return new Map<string, EditablePlaceholderType>();
    }

    const map = new Map<string, EditablePlaceholderType>();
    Object.entries(report.placeholders).forEach(([name, placeholder]) => {
      map.set(name, {
        name,
        value: placeholder.value,
        isFilled: placeholder.isFilled,
        isManuallyEdited: placeholder.isManuallyEdited || false,
        citation: placeholder.citation,
        lastEditedAt: placeholder.lastEditedAt,
        originalValue: placeholder.originalValue,
      });
    });

    return map;
  }, [report]);

  // Initialize placeholder values state when report changes
  React.useEffect(() => {
    setPlaceholderValues(parsedPlaceholders);
    // Build ordered list of placeholder names for keyboard navigation
    orderedPlaceholderNames.current = Array.from(parsedPlaceholders.keys());
  }, [parsedPlaceholders]);

  // Task 14.1: Check if Word template is configured
  React.useEffect(() => {
    const checkWordTemplate = async () => {
      try {
        const config = await getWordTemplateConfig();
        setHasWordTemplate(config !== null);
      } catch (error) {
        console.error('Failed to check Word template config:', error);
        setHasWordTemplate(false);
      }
    };
    checkWordTemplate();
  }, []);

  // Task 14.2: Check if Word report already exists for this meeting
  React.useEffect(() => {
    const checkExistingWordReport = async () => {
      if (!report) return;
      
      try {
        const wordReport = await getWordReport(report.meetingId);
        if (wordReport) {
          setExistingWordReport({
            filename: wordReport.filename,
            generatedAt: wordReport.generatedAt,
          });
        } else {
          setExistingWordReport(null);
        }
      } catch (error) {
        console.error('Failed to check existing Word report:', error);
        setExistingWordReport(null);
      }
    };
    checkExistingWordReport();
  }, [report]);



  // Task 7.6: Implement API integration for persisting edits
  const persistPlaceholderEdit = useCallback(async (name: string, newValue: string): Promise<void> => {
    if (!report) return;

    try {
      const response = await apiClient.patch(
        `/meetings/${report.meetingId}/report/placeholders/${name}`,
        {
          value: newValue,
          isManuallyEdited: true,
        }
      );

      if (response.data.success) {
        console.log('Placeholder saved successfully:', response.data);
      }
    } catch (error) {
      console.error('Failed to persist placeholder edit:', error);
      throw error;
    }
  }, [report]);

  // Task 9.1: Process save queue - non-blocking async save handler
  const processSaveQueue = useCallback(async (name: string, value: string, previousValue: EditablePlaceholderType | undefined) => {
    try {
      // Task 7.6: Persist to backend
      await persistPlaceholderEdit(name, value);
      
      // Remove from saving set on success
      setSavingPlaceholders(prev => {
        const updated = new Set(prev);
        updated.delete(name);
        return updated;
      });
      
      // Remove from queue
      saveQueue.current.delete(name);
    } catch (error) {
      // Task 7.7: Implement error handling and reversion
      console.error('Failed to save placeholder:', error);
      
      // Revert to previous value
      if (previousValue) {
        setPlaceholderValues(prev => {
          const updated = new Map(prev);
          updated.set(name, previousValue);
          return updated;
        });
      }
      
      // Set error message
      setPlaceholderErrors(prev => {
        const updated = new Map(prev);
        updated.set(name, 'Failed to save. Click to retry.');
        return updated;
      });
      
      // Remove from saving set
      setSavingPlaceholders(prev => {
        const updated = new Set(prev);
        updated.delete(name);
        return updated;
      });
      
      // Remove from queue
      saveQueue.current.delete(name);
    }
  }, [persistPlaceholderEdit]);

  // Task 7.4: Implement global placeholder update logic
  // Task 9.1: Make save operations non-blocking
  const handlePlaceholderEdit = useCallback(async (name: string, newValue: string): Promise<void> => {
    if (!report) return Promise.resolve();

    const previousValue = placeholderValues.get(name);
    
    // Task 7.13: Implement status transition logic
    // Task 7.15: Implement empty value handling
    const isFilled = newValue.trim() !== '';
    const wasNonComputed = previousValue && !previousValue.isFilled;
    
    // Update placeholder values map immediately (optimistic update)
    setPlaceholderValues(prev => {
      const updated = new Map(prev);
      const placeholder = updated.get(name);
      if (placeholder) {
        updated.set(name, {
          ...placeholder,
          value: newValue,
          isFilled,
          isManuallyEdited: true,
          lastEditedAt: Date.now(),
          // Task 7.19: Preserve citation links when editing computed placeholders
          citation: wasNonComputed ? undefined : placeholder.citation,
        });
      }
      return updated;
    });

    // Mark as saving
    setSavingPlaceholders(prev => new Set(prev).add(name));
    setPlaceholderErrors(prev => {
      const updated = new Map(prev);
      updated.delete(name);
      return updated;
    });

    // Task 9.1: Queue the save operation
    const timestamp = Date.now();
    saveQueue.current.set(name, { value: newValue, timestamp });
    
    // Task 9.1: Fire-and-forget async save (non-blocking)
    // This allows the UI to remain responsive while save is in progress
    // We don't await this - it runs in the background
    processSaveQueue(name, newValue, previousValue);
    
    // Return immediately to allow continued UI interaction
    return Promise.resolve();
  }, [report, placeholderValues, processSaveQueue]);

  // Task 7.9: Implement keyboard navigation coordination
  const handleNavigateNext = useCallback(() => {
    if (!editingPlaceholder) return;
    
    const currentIndex = orderedPlaceholderNames.current.indexOf(editingPlaceholder);
    if (currentIndex < orderedPlaceholderNames.current.length - 1) {
      const nextName = orderedPlaceholderNames.current[currentIndex + 1];
      setEditingPlaceholder(nextName);
      setFocusedPlaceholder(nextName);
    } else {
      // At boundary, exit edit mode
      setEditingPlaceholder(null);
      setFocusedPlaceholder(null);
    }
  }, [editingPlaceholder]);

  const handleNavigatePrevious = useCallback(() => {
    if (!editingPlaceholder) return;
    
    const currentIndex = orderedPlaceholderNames.current.indexOf(editingPlaceholder);
    if (currentIndex > 0) {
      const prevName = orderedPlaceholderNames.current[currentIndex - 1];
      setEditingPlaceholder(prevName);
      setFocusedPlaceholder(prevName);
    } else {
      // At boundary, exit edit mode
      setEditingPlaceholder(null);
      setFocusedPlaceholder(null);
    }
  }, [editingPlaceholder]);

  // Task 14.1: Handle Word report generation from template
  const handleGenerateWordReport = useCallback(async () => {
    if (!report) return;
    
    // Clear previous feedback states
    setWordReportError(null);
    setWordReportSuccess(false);
    setIsGeneratingWordReport(true);
    
    try {
      // Generate the Word report using the backend API
      const result = await generateWordReport(report.meetingId);
      
      // Trigger download using the presigned URL
      const filename = result.documentKey.split('/').pop() || `word-report-${report.meetingId}.docx`;
      triggerDownload(result.downloadUrl, filename);
      
      // Update existing report state
      setExistingWordReport({
        filename,
        generatedAt: result.generatedAt,
      });
      
      setWordReportSuccess(true);
      // Auto-clear success message after 3 seconds
      setTimeout(() => setWordReportSuccess(false), 3000);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message 
        || error.message 
        || 'Failed to generate Word report';
      setWordReportError(errorMessage);
    } finally {
      setIsGeneratingWordReport(false);
    }
  }, [report]);

  // Task 14.2: Handle Word report download (for existing reports)
  const handleDownloadWordReport = useCallback(async () => {
    if (!report) return;
    
    setWordReportError(null);
    setIsDownloadingWordReport(true);
    
    try {
      const wordReport = await getWordReport(report.meetingId);
      
      if (wordReport) {
        triggerDownload(wordReport.downloadUrl, wordReport.filename);
      } else {
        setWordReportError('Word report not found. Please generate a new report.');
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.message 
        || error.message 
        || 'Failed to download Word report';
      setWordReportError(errorMessage);
    } finally {
      setIsDownloadingWordReport(false);
    }
  }, [report]);



  // Process markdown content with editable placeholders
  const processedContent = useMemo(() => {
    if (!report) return '';
    
    const { reportContent, agendaPoints } = report;
    let content = reportContent;
    let citationCounter = 0;
    const citations = new Map<number, number>();
    
    console.log('Report data:', { reportContent, placeholders: placeholderValues, agendaPoints });
    
    // Don't replace placeholders here - we'll handle them in rendering
    
    // Process agenda_points section with citations
    if (agendaPoints && agendaPoints.length > 0) {
      const agendaMarkdown = agendaPoints.map((item, index) => {
        const pointTimestamp = item.citation.startTime;
        const decisionTimestamp = item.decisionCitation.startTime;
        
        let pointCitationNum = citations.get(pointTimestamp);
        if (!pointCitationNum) {
          citationCounter++;
          pointCitationNum = citationCounter;
          citations.set(pointTimestamp, pointCitationNum);
        }
        
        let decisionCitationNum = citations.get(decisionTimestamp);
        if (!decisionCitationNum) {
          citationCounter++;
          decisionCitationNum = citationCounter;
          citations.set(decisionTimestamp, decisionCitationNum);
        }
        
        return `### ${index + 1}. ${item.point} [[${pointCitationNum}]](#citation-${pointTimestamp})\n\n**Decision:** ${item.decision} [[${decisionCitationNum}]](#citation-${decisionTimestamp})`;
      }).join('\n\n');
      
      const agendaSectionRegex = /###\s+\d+\.\s+[^\n]+\n\n\*\*Decision:\*\*\s+[^\n]+(\n\n###\s+\d+\.\s+[^\n]+\n\n\*\*Decision:\*\*\s+[^\n]+)*/g;
      content = content.replace(agendaSectionRegex, agendaMarkdown);
    }
    
    return content;
  }, [report, placeholderValues]);

  // Custom component to render placeholders
  const renderPlaceholder = useCallback((name: string, instanceKey: string) => {
    const placeholderData = placeholderValues.get(name);
    if (!placeholderData) return null;

    const isEditing = editingPlaceholder === instanceKey;
    const isSaving = savingPlaceholders.has(name);
    const error = placeholderErrors.get(name);
    const isFocused = focusedPlaceholder === instanceKey;

    if (isEditing) {
      return (
        <PlaceholderEditor
          initialValue={placeholderData.value}
          placeholderName={name}
          onSave={(newValue) => {
            handlePlaceholderEdit(name, newValue);
            setEditingPlaceholder(null);
            setFocusedPlaceholder(null);
          }}
          onCancel={() => {
            setEditingPlaceholder(null);
            setFocusedPlaceholder(null);
          }}
          onNavigateNext={handleNavigateNext}
          onNavigatePrevious={handleNavigatePrevious}
        />
      );
    }

    return (
      <span
        style={{
          // Task 7.11: Implement focus indicators
          outline: isFocused ? '2px solid #0972d3' : 'none',
          outlineOffset: '2px',
          borderRadius: '3px',
        }}
      >
        <EditablePlaceholder
          name={name}
          value={placeholderData.value}
          isFilled={placeholderData.isFilled}
          isManuallyEdited={placeholderData.isManuallyEdited}
          citation={placeholderData.citation}
          onEdit={handlePlaceholderEdit}
          onCitationClick={onCitationClick}
          isEditing={false}
          isSaving={isSaving}
          error={error}
        />
      </span>
    );
  }, [
    placeholderValues,
    editingPlaceholder,
    savingPlaceholders,
    placeholderErrors,
    focusedPlaceholder,
    handlePlaceholderEdit,
    handleNavigateNext,
    handleNavigatePrevious,
    onCitationClick,
  ]);

  // Render content by splitting on placeholders and rendering inline
  const renderContent = useCallback(() => {
    const instanceCounts = new Map<string, number>();
    
    // Split content into segments and placeholders
    const segments: Array<{ type: 'text' | 'placeholder'; content: string }> = [];
    let remaining = processedContent;
    
    placeholderValues.forEach((_placeholder, name) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, (match) => '\\' + match);
      const pattern = `\\{\\{${escapedName}\\}\\}`;
      const parts = remaining.split(new RegExp(pattern));
      
      if (parts.length > 1) {
        // Found this placeholder
        const newSegments: typeof segments = [];
        parts.forEach((part, index) => {
          if (part) {
            newSegments.push({ type: 'text', content: part });
          }
          if (index < parts.length - 1) {
            newSegments.push({ type: 'placeholder', content: name });
          }
        });
        
        // Merge segments
        if (segments.length === 0) {
          segments.push(...newSegments);
        } else {
          // This is complex - for now just use first match
          remaining = parts.join(`{{${name}}}`);
        }
      }
    });
    
    // Simpler approach: process content character by character
    const result: React.ReactNode[] = [];
    // Match both {{placeholder}} and [UNFILLED: placeholder] formats
    const placeholderRegex = /\{\{([^}]+)\}\}|\[UNFILLED:\s*([^\]]+)\]/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    
    while ((match = placeholderRegex.exec(processedContent)) !== null) {
      // match[1] is for {{placeholder}}, match[2] is for [UNFILLED: placeholder]
      const placeholderName = match[1] || match[2];
      
      // Check if this is a known placeholder
      if (!placeholderName || !placeholderValues.has(placeholderName)) {
        continue;
      }
      
      // Track instance
      const instanceIndex = instanceCounts.get(placeholderName) || 0;
      instanceCounts.set(placeholderName, instanceIndex + 1);
      const instanceKey = `${placeholderName}-${instanceIndex}`;
      
      // Add markdown before this placeholder
      const beforeText = processedContent.slice(lastIndex, match.index);
      if (beforeText) {
        result.push(
          <ReactMarkdown
            key={`md-${key++}`}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith('#citation-')) {
                  const timestamp = parseInt(href.replace('#citation-', ''), 10);
                  return (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCitationClick(timestamp);
                      }}
                      style={{ cursor: 'pointer' }}
                      title="Click to view source in transcript"
                    >
                      {children}
                    </a>
                  );
                }
                return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
              },
              p: ({ children }) => <span>{children}</span>,
              strong: ({ children }) => <strong>{children}</strong>,
              em: ({ children }) => <em>{children}</em>,
            }}
          >
            {beforeText}
          </ReactMarkdown>
        );
      }
      
      // Add placeholder
      result.push(
        <span
          key={`ph-${key++}`}
          onClick={() => {
            if (!savingPlaceholders.has(placeholderName)) {
              setEditingPlaceholder(instanceKey);
              setFocusedPlaceholder(instanceKey);
            }
          }}
          style={{ cursor: savingPlaceholders.has(placeholderName) ? 'wait' : 'pointer', display: 'inline' }}
        >
          {renderPlaceholder(placeholderName, instanceKey)}
        </span>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining content
    if (lastIndex < processedContent.length) {
      result.push(
        <ReactMarkdown
          key={`md-${key++}`}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith('#citation-')) {
                const timestamp = parseInt(href.replace('#citation-', ''), 10);
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onCitationClick(timestamp);
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Click to view source in transcript"
                  >
                    {children}
                  </a>
                );
              }
              return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
            },
          }}
        >
          {processedContent.slice(lastIndex)}
        </ReactMarkdown>
      );
    }
    
    return <>{result}</>;
  }, [processedContent, placeholderValues, renderPlaceholder, savingPlaceholders, onCitationClick, setEditingPlaceholder, setFocusedPlaceholder]);

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box variant="p" margin={{ top: 's' }}>
          Loading report...
        </Box>
      </Box>
    );
  }

  if (error || !report) {
    return (
      <SpaceBetween size="l">
        <Alert type="error" header="Failed to load report">
          {error || 'Report not found'}
        </Alert>
        <Button onClick={() => onRegenerate()} loading={isRegenerating} disabled={isRegenerating}>
          Generate Report
        </Button>
      </SpaceBetween>
    );
  }



  return (
    <>
      <SpaceBetween size="l">
        {isRegenerating && (
          <Alert type="info">Regenerating report... This may take a few moments.</Alert>
        )}
        {/* Task 14.1: Display Word report generation error alert */}
        {wordReportError && (
          <Alert 
            type="error" 
            dismissible 
            onDismiss={() => setWordReportError(null)}
            header="Word report generation failed"
          >
            {wordReportError}
          </Alert>
        )}
        {/* Task 14.1: Display Word report generation success feedback */}
        {wordReportSuccess && (
          <Alert 
            type="success" 
            dismissible 
            onDismiss={() => setWordReportSuccess(false)}
          >
            Word report generated and downloaded successfully!
          </Alert>
        )}
        <Box>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <Box variant="h2" margin={{ bottom: 'n' }}>
                Meeting Report
              </Box>
              <Box variant="small" color="text-status-inactive">
                Generated: {new Date(report.generatedAt).toLocaleString()}
              </Box>
            </div>
            {/* Task 14.1 & 14.2: Word report generation and download buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {hasWordTemplate && (
                <>
                  <Button 
                    onClick={handleGenerateWordReport}
                    loading={isGeneratingWordReport}
                    disabled={isGeneratingWordReport || isRegenerating || isDownloadingWordReport}
                    iconName="file"
                    variant="primary"
                  >
                    {existingWordReport ? 'Regenerate' : 'Generate'} Word
                  </Button>
                  {existingWordReport && (
                    <Button 
                      onClick={handleDownloadWordReport}
                      loading={isDownloadingWordReport}
                      disabled={isDownloadingWordReport || isGeneratingWordReport || isRegenerating}
                      iconName="download"
                    >
                      Download
                    </Button>
                  )}
                </>
              )}
              <Button 
                onClick={() => onRegenerate()} 
                loading={isRegenerating} 
                disabled={isRegenerating || isGeneratingWordReport || isDownloadingWordReport}
                iconName="refresh"
              >
                Regenerate
              </Button>
            </div>
          </div>
        </Box>
      <div
        className="report-content-container"
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '24px',
          maxHeight: '600px',
          overflowY: 'auto',
        }}
      >
        <style>
          {`
            .report-content-container a[href^="#citation-"] {
              color: #0972d3;
              cursor: pointer;
              text-decoration: none;
              font-weight: 600;
            }
            
            .report-content-container a[href^="#citation-"]:hover {
              color: #0552a0;
              text-decoration: underline;
            }
          `}
        </style>
        <div>{renderContent()}</div>
      </div>
    </SpaceBetween>
    </>
  );
};
