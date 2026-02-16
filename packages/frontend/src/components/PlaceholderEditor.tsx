import React, { useState, useEffect, useRef } from 'react';

export interface PlaceholderEditorProps {
  initialValue: string;
  placeholderName: string;
  onSave: (newValue: string) => void;
  onCancel: () => void;
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
}

export const PlaceholderEditor: React.FC<PlaceholderEditorProps> = ({
  initialValue,
  placeholderName,
  onSave,
  onCancel,
  onNavigateNext,
  onNavigatePrevious,
}) => {
  const [currentValue, setCurrentValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isInitialMount = useRef(true);

  // Auto-focus and select text on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // Mark that initial mount is complete after a short delay
    const timer = setTimeout(() => {
      isInitialMount.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSave(currentValue);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onSave(currentValue);
      
      if (event.shiftKey && onNavigatePrevious) {
        onNavigatePrevious();
      } else if (!event.shiftKey && onNavigateNext) {
        onNavigateNext();
      }
    }
  };

  const handleBlur = () => {
    // Ignore blur events during initial mount to prevent immediate save
    if (isInitialMount.current) {
      return;
    }
    onSave(currentValue);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentValue(event.target.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={currentValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder={placeholderName}
      style={{
        display: 'inline',
        fontWeight: 'bold',
        backgroundColor: '#fff9c4',
        padding: '2px 4px',
        borderRadius: '3px',
        border: '2px solid #0972d3',
        outline: 'none',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        minWidth: '100px',
        maxWidth: '300px',
      }}
      aria-label={`Edit ${placeholderName}`}
    />
  );
};
