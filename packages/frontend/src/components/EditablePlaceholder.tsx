import React, { useState } from 'react';
import type { Citation } from '@meeting-platform/shared';

export interface EditablePlaceholderProps {
  name: string;
  value: string;
  isFilled: boolean;
  isManuallyEdited: boolean;
  citation?: Citation;
  onEdit: (name: string, newValue: string) => Promise<void>;
  onCitationClick?: (timestamp: number) => void;
  isEditing: boolean;
  isSaving: boolean;
  error?: string;
}

export const EditablePlaceholder: React.FC<EditablePlaceholderProps> = ({
  name,
  value,
  isFilled,
  isManuallyEdited,
  citation,
  onEdit: _onEdit, // Will be used by PlaceholderEditor component in future task
  onCitationClick,
  isEditing,
  isSaving,
  error,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Determine display text
  const displayText = isFilled ? value : `{{${name}}}`;

  // Determine styling based on placeholder state
  const getBackgroundColor = () => {
    if (isFilled) {
      return '#fff9c4'; // Yellow for computed/filled placeholders
    }
    return '#ff5252'; // Bright red for unfilled placeholders
  };

  // Determine tooltip message
  const getTooltipMessage = () => {
    if (isManuallyEdited && !isFilled) {
      return 'Manually cleared placeholder (click to edit)';
    }
    if (isManuallyEdited) {
      return 'Manually edited value (click to edit)';
    }
    if (isFilled) {
      return 'Automatically extracted value (click to edit)';
    }
    return 'Click to fill this placeholder';
  };

  const handleClick = () => {
    if (!isSaving && !isEditing) {
      // Trigger edit mode - this will be handled by parent component
      // The onEdit callback will be used when PlaceholderEditor saves a value
      // For now, clicking just prepares for edit mode activation
    }
  };

  const handleMouseEnter = () => {
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <span
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          display: 'inline',
          fontWeight: 'bold',
          backgroundColor: getBackgroundColor(),
          padding: '2px 4px',
          borderRadius: '3px',
          cursor: isSaving ? 'wait' : 'pointer',
          transition: 'all 0.2s ease',
          opacity: isSaving ? 0.6 : 1,
          position: 'relative',
        }}
        title={getTooltipMessage()}
      >
        {displayText}
        {isManuallyEdited && (
          <span
            style={{
              marginLeft: '4px',
              fontSize: '0.8em',
              color: '#666',
            }}
            title="Manually edited"
          >
            ✏️
          </span>
        )}
      </span>
      
      {/* Citation link */}
      {citation && isFilled && onCitationClick && (
        <span style={{ marginLeft: '4px' }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCitationClick(citation.startTime);
            }}
            style={{
              color: '#0972d3',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9em',
            }}
            title="Click to view source in transcript"
          >
            [cite]
          </a>
        </span>
      )}

      {/* Loading indicator */}
      {isSaving && (
        <span
          style={{
            marginLeft: '4px',
            fontSize: '0.8em',
            color: '#666',
          }}
        >
          ⏳
        </span>
      )}

      {/* Error message */}
      {error && (
        <span
          style={{
            marginLeft: '4px',
            fontSize: '0.8em',
            color: '#d13212',
            fontWeight: 'normal',
          }}
          title={error}
        >
          ⚠️
        </span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '6px 10px',
            backgroundColor: '#232f3e',
            color: '#ffffff',
            fontSize: '12px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            zIndex: 1000,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
          }}
        >
          {getTooltipMessage()}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #232f3e',
            }}
          />
        </span>
      )}
    </span>
  );
};
