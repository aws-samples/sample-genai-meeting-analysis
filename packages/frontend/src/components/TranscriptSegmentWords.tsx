import React from 'react';
import type { TranscriptSegment } from '@meeting-platform/shared';

interface TranscriptSegmentWordsProps {
  segment: TranscriptSegment;
  isActiveSegment: boolean;
  activeWordIndex: number | null;
  onWordClick: (wordStartTime: number) => void;
}

export const TranscriptSegmentWords: React.FC<TranscriptSegmentWordsProps> = ({
  segment,
  isActiveSegment,
  activeWordIndex,
  onWordClick,
}) => {
  // Handle empty words array - fallback to segment text
  if (!segment.words || segment.words.length === 0) {
    return (
      <span
        style={{
          fontSize: isActiveSegment ? '16px' : '14px',
          fontWeight: isActiveSegment ? '500' : 'normal',
          color: isActiveSegment ? '#000000' : '#545b64',
          transition: 'all 0.2s ease',
        }}
      >
        {segment.text}
      </span>
    );
  }

  // Render individual words with highlighting
  return (
    <span>
      {segment.words.map((word, index) => {
        const isActiveWord = isActiveSegment && activeWordIndex === index;
        
        return (
          <React.Fragment key={`${word.startTime}-${index}`}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onWordClick(word.startTime);
              }}
              style={{
                display: 'inline-block',
                padding: '2px 4px',
                margin: '0 1px',
                borderRadius: '3px',
                backgroundColor: isActiveWord ? '#ffd700' : 'transparent',
                color: isActiveSegment ? '#000000' : '#545b64',
                fontSize: isActiveSegment ? '16px' : '14px',
                fontWeight: isActiveWord ? '600' : isActiveSegment ? '500' : 'normal',
                cursor: 'pointer',
                transition: 'all 0.1s ease',
                boxShadow: isActiveWord ? '0 1px 3px rgba(255, 215, 0, 0.5)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActiveWord) {
                  e.currentTarget.style.backgroundColor = '#f0f0f0';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActiveWord) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {word.text}
            </span>
            {index < segment.words.length - 1 && ' '}
          </React.Fragment>
        );
      })}
    </span>
  );
};
