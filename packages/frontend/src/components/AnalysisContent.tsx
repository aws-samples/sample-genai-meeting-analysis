import React from 'react';
import { Box, SpaceBetween, Alert, Button, Spinner } from '@cloudscape-design/components';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MeetingAnalysis } from '@meeting-platform/shared';

interface AnalysisContentProps {
  analysis: MeetingAnalysis | null;
  isLoading: boolean;
  error: string | null;
  isRegenerating: boolean;
  onRegenerate: () => void;
  showTimestamp?: boolean;
}

export const AnalysisContent: React.FC<AnalysisContentProps> = ({
  analysis,
  isLoading,
  error,
  isRegenerating,
  onRegenerate,
  showTimestamp = true,
}) => {
  if (isLoading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box variant="p" margin={{ top: 's' }}>
          Loading analysis...
        </Box>
      </Box>
    );
  }

  if (error || !analysis) {
    return (
      <SpaceBetween size="l">
        <Alert type="error" header="Failed to load analysis">
          {error || 'Analysis not found'}
        </Alert>
        <Button onClick={onRegenerate} loading={isRegenerating} disabled={isRegenerating}>
          Generate Analysis
        </Button>
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="l">
      {isRegenerating && (
        <Alert type="info">Regenerating analysis... This may take a few moments.</Alert>
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
              Analysis
            </Box>
            {showTimestamp && (
              <Box variant="small" color="text-status-inactive">
                Generated: {new Date(analysis.generatedAt).toLocaleString()}
              </Box>
            )}
          </div>
          <Button onClick={onRegenerate} loading={isRegenerating} disabled={isRegenerating}>
            Regenerate Analysis
          </Button>
        </div>
      </Box>
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '24px',
          maxHeight: '600px',
          overflowY: 'auto',
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <Box variant="h1" margin={{ bottom: 'm' }}>
                {children}
              </Box>
            ),
            h2: ({ children }) => (
              <Box variant="h2" margin={{ top: 'l', bottom: 's' }}>
                {children}
              </Box>
            ),
            h3: ({ children }) => (
              <Box variant="h3" margin={{ top: 'm', bottom: 'xs' }}>
                {children}
              </Box>
            ),
            p: ({ children }) => (
              <Box variant="p" margin={{ bottom: 's' }}>
                {children}
              </Box>
            ),
            ul: ({ children }) => (
              <ul style={{ marginLeft: '20px', marginBottom: '12px' }}>{children}</ul>
            ),
            ol: ({ children }) => (
              <ol style={{ marginLeft: '20px', marginBottom: '12px' }}>{children}</ol>
            ),
            li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
            blockquote: ({ children }) => (
              <div
                style={{
                  borderLeft: '4px solid #0972d3',
                  fontStyle: 'italic',
                  color: '#5f6b7a',
                  paddingLeft: '16px',
                  marginTop: '8px',
                  marginBottom: '8px',
                }}
              >
                {children}
              </div>
            ),
            code: ({ children, ...props }) => {
              const isInline = !String(props.className).includes('language-');
              return isInline ? (
                <code
                  style={{
                    backgroundColor: '#f4f4f4',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '0.9em',
                  }}
                >
                  {children}
                </code>
              ) : (
                <pre
                  style={{
                    backgroundColor: '#f4f4f4',
                    padding: '12px',
                    borderRadius: '4px',
                    overflow: 'auto',
                    marginBottom: '12px',
                  }}
                >
                  <code style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{children}</code>
                </pre>
              );
            },
            table: ({ children }) => (
              <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    border: '1px solid #e0e0e0',
                  }}
                >
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th
                style={{
                  backgroundColor: '#f9f9f9',
                  padding: '8px',
                  border: '1px solid #e0e0e0',
                  textAlign: 'left',
                  fontWeight: 'bold',
                }}
              >
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td
                style={{
                  padding: '8px',
                  border: '1px solid #e0e0e0',
                }}
              >
                {children}
              </td>
            ),
            hr: () => (
              <hr
                style={{
                  border: 'none',
                  borderTop: '1px solid #e0e0e0',
                  margin: '16px 0',
                }}
              />
            ),
          }}
        >
          {analysis.markdown}
        </ReactMarkdown>
      </div>
    </SpaceBetween>
  );
};
