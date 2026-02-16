import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Header,
  SpaceBetween,
  Box,
  Button,
  Alert,
  StatusIndicator,
  Spinner,
  Input,
  Modal,
  Flashbar,
  Tabs,
} from '@cloudscape-design/components';
import { Layout } from '../components/Layout';
import { meetingService } from '../services/meeting-service';
import { formatDuration } from '../utils/helpers';
import { TranscriptSegmentWords } from '../components/TranscriptSegmentWords';
import { AnalysisContent } from '../components/AnalysisContent';
import { ReportContent } from '../components/ReportContent';
import { TokenUsageTable } from '../components/TokenUsageTable';
import type { Meeting, TranscriptSegment, MeetingAnalysis, MeetingReport } from '@meeting-platform/shared';

interface TranscriptViewState {
  meeting: Meeting | null;
  transcript: TranscriptSegment[];
  isLoading: boolean;
  error: string | null;
}

interface AnalysisState {
  analysis: MeetingAnalysis | null;
  isLoading: boolean;
  error: string | null;
  isRegenerating: boolean;
}

interface ReportState {
  report: MeetingReport | null;
  isLoading: boolean;
  error: string | null;
  isRegenerating: boolean;
}

interface SpeakerEditState {
  isEditing: boolean;
  speakerLabel: string | null;
  newName: string;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
}

// Speaker color palette (max 10 speakers)
const SPEAKER_COLORS = [
  { bg: '#E3F2FD', border: '#2196F3', text: '#1565C0' },      // Blue
  { bg: '#F3E5F5', border: '#9C27B0', text: '#6A1B9A' },      // Purple
  { bg: '#E8F5E9', border: '#4CAF50', text: '#2E7D32' },      // Green
  { bg: '#FFF3E0', border: '#FF9800', text: '#E65100' },      // Orange
  { bg: '#FCE4EC', border: '#E91E63', text: '#AD1457' },      // Pink
  { bg: '#E0F2F1', border: '#009688', text: '#00695C' },      // Teal
  { bg: '#FFF9C4', border: '#FBC02D', text: '#F57F17' },      // Yellow
  { bg: '#FFEBEE', border: '#F44336', text: '#C62828' },      // Red
  { bg: '#E8EAF6', border: '#3F51B5', text: '#283593' },      // Indigo
  { bg: '#F1F8E9', border: '#8BC34A', text: '#558B2F' },      // Light Green
];

// Add keyframes for pulse animation
const pulseAnimation = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }
`;

// Helper function to get speaker color
const getSpeakerColor = (speakerLabel: string, allSpeakers: string[]) => {
  const speakerIndex = allSpeakers.indexOf(speakerLabel);
  return SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length];
};

export const TranscriptView: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [state, setState] = useState<TranscriptViewState>({
    meeting: null,
    transcript: [],
    isLoading: true,
    error: null,
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState<{
    segmentIndex: number;
    wordIndex: number;
  } | null>(null);

  const [speakerEdit, setSpeakerEdit] = useState<SpeakerEditState>({
    isEditing: false,
    speakerLabel: null,
    newName: '',
    isSaving: false,
    saveError: null,
    saveSuccess: false,
  });

  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    analysis: null,
    isLoading: false,
    error: null,
    isRegenerating: false,
  });

  const [reportState, setReportState] = useState<ReportState>({
    report: null,
    isLoading: false,
    error: null,
    isRegenerating: false,
  });

  const [activeTabId, setActiveTabId] = useState<string>('report');
  
  // Resizable panels state
  const [leftPanelWidth, setLeftPanelWidth] = useState(40); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch meeting and transcript data
  useEffect(() => {
    const fetchData = async () => {
      if (!meetingId) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Meeting ID is required',
        }));
        return;
      }

      try {
        const [meeting, transcript] = await Promise.all([
          meetingService.getMeeting(meetingId),
          meetingService.getTranscript(meetingId),
        ]);

        console.log('Fetched meeting:', meeting);
        console.log('Fetched transcript segments:', transcript);
        console.log('Transcript segments count:', transcript.length);
        console.log('Is transcript an array?', Array.isArray(transcript));

        // Ensure transcript is always an array
        const validTranscript = Array.isArray(transcript) ? transcript : [];
        if (!Array.isArray(transcript)) {
          console.error('Transcript is not an array:', transcript);
        }

        setState({
          meeting,
          transcript: validTranscript,
          isLoading: false,
          error: null,
        });
      } catch (error: any) {
        console.error('Failed to fetch meeting data:', error);
        
        let errorMessage = 'Failed to load meeting data';
        if (error.response?.data?.error?.message) {
          errorMessage = error.response.data.error.message;
        } else if (error.message) {
          errorMessage = error.message;
        }

        setState({
          meeting: null,
          transcript: [],
          isLoading: false,
          error: errorMessage,
        });
      }
    };

    fetchData();
  }, [meetingId]);

  // Fetch analysis data
  const fetchAnalysis = useCallback(async () => {
    if (!meetingId) return;

    setAnalysisState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      const analysis = await meetingService.getAnalysis(meetingId);
      setAnalysisState({
        analysis,
        isLoading: false,
        error: null,
        isRegenerating: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch analysis:', error);

      let errorMessage = 'Failed to load analysis';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setAnalysisState({
        analysis: null,
        isLoading: false,
        error: errorMessage,
        isRegenerating: false,
      });
    }
  }, [meetingId]);

  // Load analysis when component mounts
  useEffect(() => {
    if (!analysisState.analysis && !analysisState.isLoading && meetingId) {
      fetchAnalysis();
    }
  }, [meetingId, analysisState.analysis, analysisState.isLoading, fetchAnalysis]);

  // Handle regenerate analysis
  const handleRegenerateAnalysis = async () => {
    if (!meetingId) return;

    setAnalysisState((prev) => ({
      ...prev,
      isRegenerating: true,
      error: null,
    }));

    try {
      await meetingService.generateAnalysis(meetingId);
      await fetchAnalysis();
    } catch (error: any) {
      console.error('Failed to regenerate analysis:', error);

      let errorMessage = 'Failed to regenerate analysis';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setAnalysisState((prev) => ({
        ...prev,
        isRegenerating: false,
        error: errorMessage,
      }));
    }
  };

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!meetingId) return;

    setReportState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      const report = await meetingService.getReport(meetingId);
      setReportState({
        report,
        isLoading: false,
        error: null,
        isRegenerating: false,
      });
    } catch (error: any) {
      console.error('Failed to fetch report:', error);

      let errorMessage = 'Failed to load report';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setReportState({
        report: null,
        isLoading: false,
        error: errorMessage,
        isRegenerating: false,
      });
    }
  }, [meetingId]);

  // Load report when Report tab is selected
  useEffect(() => {
    if (activeTabId === 'report' && !reportState.report && !reportState.isLoading && meetingId) {
      fetchReport();
    }
  }, [activeTabId, meetingId, reportState.report, reportState.isLoading, fetchReport]);

  // Handle regenerate report
  const handleRegenerateReport = async () => {
    if (!meetingId) return;

    setReportState((prev) => ({
      ...prev,
      isRegenerating: true,
      error: null,
    }));

    try {
      // Always overwrite all edits when regenerating
      await meetingService.generateReport(meetingId, undefined, true);
      await fetchReport();
    } catch (error: any) {
      console.error('Failed to regenerate report:', error);

      let errorMessage = 'Failed to regenerate report';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setReportState((prev) => ({
        ...prev,
        isRegenerating: false,
        error: errorMessage,
      }));
    }
  };

  // Citation navigation handler
  const handleCitationClick = useCallback((timestamp: number) => {
    // Find the transcript segment that contains this timestamp
    const segmentIndex = state.transcript.findIndex(
      (segment) => timestamp >= segment.startTime && timestamp <= segment.endTime
    );
    
    if (segmentIndex !== -1) {
      // Scroll to the segment
      setActiveSegmentIndex(segmentIndex);
      
      // Seek audio to the timestamp
      if (audioRef.current) {
        audioRef.current.currentTime = timestamp / 1000;
      }
      
      // Highlight the segment temporarily (will be handled by activeSegmentIndex state)
      // The segment will be highlighted as long as it's the active segment
    }
  }, [state.transcript]);

  // Audio event handlers
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current && Array.isArray(state.transcript)) {
      const currentTimeMs = audioRef.current.currentTime * 1000;
      setCurrentTime(currentTimeMs);

      // Find active segment
      const activeIndex = state.transcript.findIndex(
        (segment) => currentTimeMs >= segment.startTime && currentTimeMs <= segment.endTime
      );
      
      if (activeIndex !== -1) {
        if (activeIndex !== activeSegmentIndex) {
          setActiveSegmentIndex(activeIndex);
        }

        // Find active word within segment
        const segment = state.transcript[activeIndex];
        if (segment.words && segment.words.length > 0) {
          // Find word that contains current time
          const activeWordIdx = segment.words.findIndex(
            (word) => currentTimeMs >= word.startTime && currentTimeMs <= word.endTime
          );
          
          if (activeWordIdx !== -1) {
            // Current time is within a word's time range
            const newActiveWordIndex = {
              segmentIndex: activeIndex,
              wordIndex: activeWordIdx,
            };
            
            // Only update if word index changed
            if (
              !activeWordIndex ||
              activeWordIndex.segmentIndex !== newActiveWordIndex.segmentIndex ||
              activeWordIndex.wordIndex !== newActiveWordIndex.wordIndex
            ) {
              setActiveWordIndex(newActiveWordIndex);
            }
          } else {
            // Time is between words - highlight the most recent word
            const lastSpokenWordIdx = segment.words.findIndex(
              (word) => currentTimeMs < word.startTime
            ) - 1;
            
            if (lastSpokenWordIdx >= 0) {
              const newActiveWordIndex = {
                segmentIndex: activeIndex,
                wordIndex: lastSpokenWordIdx,
              };
              
              // Only update if word index changed
              if (
                !activeWordIndex ||
                activeWordIndex.segmentIndex !== newActiveWordIndex.segmentIndex ||
                activeWordIndex.wordIndex !== newActiveWordIndex.wordIndex
              ) {
                setActiveWordIndex(newActiveWordIndex);
              }
            }
          }
        }
      } else {
        // No active segment - clear word highlighting
        if (activeWordIndex !== null) {
          setActiveWordIndex(null);
        }
      }
    }
  }, [state.transcript, activeSegmentIndex, activeWordIndex]);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration * 1000);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    setActiveWordIndex(null);
  }, []);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentIndex !== null && transcriptContainerRef.current) {
      const segmentElement = segmentRefs.current.get(activeSegmentIndex);
      if (segmentElement) {
        segmentElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [activeSegmentIndex]);

  // Handle panel resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

      // Clamp between 20% and 80%
      const clampedWidth = Math.max(20, Math.min(80, newLeftWidth));
      setLeftPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Click-to-seek functionality
  const handleSegmentClick = useCallback((segment: TranscriptSegment) => {
    if (audioRef.current) {
      audioRef.current.currentTime = segment.startTime / 1000;
      if (!isPlaying) {
        audioRef.current.play();
      }
    }
  }, [isPlaying]);

  // Word click handler
  const handleWordClick = useCallback((wordStartTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = wordStartTime / 1000;
      if (!isPlaying) {
        audioRef.current.play();
      }
    }
  }, [isPlaying]);

  // Audio controls
  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const newTime = parseFloat(event.target.value);
      audioRef.current.currentTime = newTime / 1000;
      setCurrentTime(newTime);
    }
  };

  const handleSkip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
    }
  };

  // Speaker editing handlers
  const handleSpeakerClick = useCallback((speakerLabel: string, currentName?: string) => {
    setSpeakerEdit({
      isEditing: true,
      speakerLabel,
      newName: currentName || speakerLabel,
      isSaving: false,
      saveError: null,
      saveSuccess: false,
    });
  }, []);

  const handleSpeakerNameChange = useCallback((value: string) => {
    setSpeakerEdit((prev) => ({
      ...prev,
      newName: value,
    }));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setSpeakerEdit({
      isEditing: false,
      speakerLabel: null,
      newName: '',
      isSaving: false,
      saveError: null,
      saveSuccess: false,
    });
  }, []);

  const handleSaveSpeakerName = useCallback(async () => {
    if (!meetingId || !speakerEdit.speakerLabel || !speakerEdit.newName.trim()) {
      return;
    }

    setSpeakerEdit((prev) => ({
      ...prev,
      isSaving: true,
      saveError: null,
      saveSuccess: false,
    }));

    try {
      // Call API to update speaker names
      const updatedTranscript = await meetingService.updateSpeakers(meetingId, {
        speakerMappings: {
          [speakerEdit.speakerLabel]: speakerEdit.newName.trim(),
        },
      });

      console.log('Updated transcript from API:', updatedTranscript);
      console.log('Is updated transcript an array?', Array.isArray(updatedTranscript));

      // Ensure transcript is always an array
      const validTranscript = Array.isArray(updatedTranscript) ? updatedTranscript : [];
      if (!Array.isArray(updatedTranscript)) {
        console.error('Updated transcript is not an array:', updatedTranscript);
      }

      // Update local state with new transcript
      setState((prev) => ({
        ...prev,
        transcript: validTranscript,
      }));

      // Show success state
      setSpeakerEdit({
        isEditing: false,
        speakerLabel: null,
        newName: '',
        isSaving: false,
        saveError: null,
        saveSuccess: true,
      });

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSpeakerEdit((prev) => ({
          ...prev,
          saveSuccess: false,
        }));
      }, 3000);
    } catch (error: any) {
      console.error('Failed to update speaker name:', error);
      
      let errorMessage = 'Failed to update speaker name';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setSpeakerEdit((prev) => ({
        ...prev,
        isSaving: false,
        saveError: errorMessage,
      }));
    }
  }, [meetingId, speakerEdit.speakerLabel, speakerEdit.newName]);

  // Get unique speakers for color assignment - MUST be before any conditional returns
  const uniqueSpeakers = React.useMemo(() => {
    if (!Array.isArray(state.transcript)) return [];
    const speakers = new Set<string>();
    state.transcript.forEach((segment) => {
      speakers.add(segment.speakerLabel);
    });
    return Array.from(speakers).sort();
  }, [state.transcript]);

  if (state.isLoading) {
    return (
      <Layout>
        <Container
        header={<Header variant="h1">Meeting Transcript</Header>}
      >
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" margin={{ top: 's' }}>
            Loading meeting data...
          </Box>
        </Box>
      </Container>
      </Layout>
    );
  }

  if (state.error || !state.meeting) {
    return (
      <Layout>
        <Container
        header={<Header variant="h1">Meeting Transcript</Header>}
      >
        <Alert
          type="error"
          header="Failed to load meeting"
        >
          {state.error || 'Meeting not found'}
        </Alert>
      </Container>
      </Layout>
    );
  }

  const { meeting, transcript } = state;

  return (
    <Layout>
      <style>{pulseAnimation}</style>
      <Container
        header={
          <Header
            variant="h1"
            description={`Uploaded: ${new Date(meeting.createdAt).toLocaleString()}`}
          >
            {meeting.fileName}
          </Header>
        }
      >
        <SpaceBetween size="l">
        {/* Audio Player Section */}
        <Box>
          <SpaceBetween size="m">
            <Box variant="h2">Audio Player</Box>
            
            {meeting.audioUrl ? (
              <>
                <audio
                  ref={audioRef}
                  src={meeting.audioUrl}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  preload="metadata"
                />

                {/* Custom Audio Controls */}
                <div
                  style={{
                    backgroundColor: '#f9f9f9',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0',
                    padding: '16px',
                  }}
                >
                  <SpaceBetween size="m">
                    {/* Time Display */}
                    <Box textAlign="center">
                      <Box variant="p" fontSize="body-m" fontWeight="bold">
                        {formatDuration(currentTime / 1000)} / {formatDuration(duration / 1000)}
                      </Box>
                    </Box>

                    {/* Seek Bar */}
                    <input
                      type="range"
                      min="0"
                      max={duration}
                      value={currentTime}
                      onChange={handleSeek}
                      style={{
                        width: '100%',
                        height: '8px',
                        borderRadius: '4px',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    />

                    {/* Control Buttons */}
                    <Box textAlign="center">
                      <SpaceBetween direction="horizontal" size="s">
                        <Button
                          iconName="angle-left"
                          onClick={() => handleSkip(-10)}
                          ariaLabel="Skip backward 10 seconds"
                        >
                          -10s
                        </Button>
                        <Button
                          variant="primary"
                          iconName={isPlaying ? 'status-stopped' : 'caret-right-filled'}
                          onClick={handlePlayPause}
                          ariaLabel={isPlaying ? 'Pause' : 'Play'}
                        >
                          {isPlaying ? 'Pause' : 'Play'}
                        </Button>
                        <Button
                          iconName="angle-right"
                          onClick={() => handleSkip(10)}
                          ariaLabel="Skip forward 10 seconds"
                        >
                          +10s
                        </Button>
                      </SpaceBetween>
                    </Box>
                  </SpaceBetween>
                </div>
              </>
            ) : (
              <Alert type="warning">
                Audio file is not available for playback.
              </Alert>
            )}
          </SpaceBetween>
        </Box>

        {/* Two-column layout: Transcript on left, Analysis/Report tabs on right */}
        <div
          ref={containerRef}
          style={{
            display: 'flex',
            width: '100%',
            gap: '0',
          }}
        >
          {/* Left Column: Transcript */}
          <div style={{ width: `${leftPanelWidth}%`, paddingRight: '8px' }}>
            <Box variant="h2" margin={{ bottom: 's' }}>
              Transcript
            </Box>
            {!Array.isArray(transcript) ? (
              <Alert type="warning">
                Transcript data is in an unexpected format. Please check the console for details.
              </Alert>
            ) : transcript.length === 0 ? (
              <Alert type="info">
                No transcript segments available.
              </Alert>
            ) : (
              <div
                ref={transcriptContainerRef}
                style={{
                  maxHeight: '600px',
                  overflowY: 'auto',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '16px',
                }}
              >
                <SpaceBetween size="m">
                  {Array.isArray(transcript) && transcript.map((segment, index) => {
                    const isActive = index === activeSegmentIndex;
                    const speakerColor = getSpeakerColor(segment.speakerLabel, uniqueSpeakers);
                    
                    return (
                      <div
                        key={`${segment.startTime}-${index}`}
                        ref={(el) => {
                          if (el) {
                            segmentRefs.current.set(index, el);
                          }
                        }}
                        onClick={() => handleSegmentClick(segment)}
                        style={{
                          padding: '12px',
                          paddingLeft: '16px',
                          borderRadius: '6px',
                          backgroundColor: isActive ? speakerColor.bg : '#ffffff',
                          borderLeftWidth: '4px',
                          borderLeftStyle: 'solid',
                          borderLeftColor: speakerColor.border,
                          borderTopWidth: isActive ? '2px' : '1px',
                          borderTopStyle: 'solid',
                          borderTopColor: isActive ? speakerColor.border : '#e0e0e0',
                          borderRightWidth: isActive ? '2px' : '1px',
                          borderRightStyle: 'solid',
                          borderRightColor: isActive ? speakerColor.border : '#e0e0e0',
                          borderBottomWidth: isActive ? '2px' : '1px',
                          borderBottomStyle: 'solid',
                          borderBottomColor: isActive ? speakerColor.border : '#e0e0e0',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: isActive ? `0 2px 8px ${speakerColor.border}40` : 'none',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = speakerColor.bg;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = '#ffffff';
                          }
                        }}
                      >
                        <SpaceBetween size="xs">
                          {/* Speaker and Language Info */}
                          <Box>
                            <SpaceBetween direction="horizontal" size="xs">
                              {isActive && (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    color: '#0972d3',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '8px',
                                      height: '8px',
                                      borderRadius: '50%',
                                      backgroundColor: '#0972d3',
                                      animation: 'pulse 1.5s ease-in-out infinite',
                                    }}
                                  />
                                  Speaking
                                </span>
                              )}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSpeakerClick(segment.speakerLabel, segment.speakerName);
                                }}
                                style={{
                                  fontWeight: 'bold',
                                  color: speakerColor.text,
                                  cursor: 'pointer',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.7)' : 'transparent',
                                  border: `1px solid ${isActive ? speakerColor.border : 'transparent'}`,
                                  transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                                  e.currentTarget.style.borderColor = speakerColor.border;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = isActive ? 'rgba(255, 255, 255, 0.7)' : 'transparent';
                                  e.currentTarget.style.borderColor = isActive ? speakerColor.border : 'transparent';
                                }}
                                title="Click to edit speaker name"
                              >
                                {segment.speakerName || segment.speakerLabel}
                              </span>
                              <Box variant="span" color="text-status-inactive" fontSize="body-s">
                                [{segment.languageCode}]
                              </Box>
                              <Box variant="span" color="text-status-inactive" fontSize="body-s">
                                {formatDuration(segment.startTime / 1000)}
                              </Box>
                            </SpaceBetween>
                          </Box>

                          {/* Transcript Text */}
                          <Box variant="p" margin={{ top: 'xxs' }}>
                            <TranscriptSegmentWords
                              segment={segment}
                              isActiveSegment={isActive}
                              activeWordIndex={
                                activeWordIndex?.segmentIndex === index
                                  ? activeWordIndex.wordIndex
                                  : null
                              }
                              onWordClick={handleWordClick}
                            />
                          </Box>
                        </SpaceBetween>
                      </div>
                    );
                  })}
                </SpaceBetween>
              </div>
            )}
          </div>

          {/* Resizer */}
          <div
            onMouseDown={() => setIsResizing(true)}
            style={{
              width: '8px',
              cursor: 'col-resize',
              backgroundColor: isResizing ? '#0972d3' : '#e0e0e0',
              transition: isResizing ? 'none' : 'background-color 0.2s',
              flexShrink: 0,
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              if (!isResizing) {
                e.currentTarget.style.backgroundColor = '#aab7b8';
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizing) {
                e.currentTarget.style.backgroundColor = '#e0e0e0';
              }
            }}
          >
            {/* Visual indicator */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '3px',
                height: '40px',
                backgroundColor: isResizing ? '#ffffff' : '#7d8998',
                borderRadius: '2px',
                pointerEvents: 'none',
              }}
            />
          </div>

          {/* Right Column: Report, Analysis, and Token Usage Tabs */}
          <div style={{ width: `${100 - leftPanelWidth}%`, paddingLeft: '8px' }}>
            <Tabs
              activeTabId={activeTabId}
              onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
              tabs={[
                {
                  id: 'report',
                  label: 'Report',
                  content: (
                    <ReportContent
                      report={reportState.report}
                      isLoading={reportState.isLoading}
                      error={reportState.error}
                      isRegenerating={reportState.isRegenerating}
                      onRegenerate={handleRegenerateReport}
                      onCitationClick={handleCitationClick}
                    />
                  ),
                },
                {
                  id: 'analysis',
                  label: 'Analysis',
                  content: (
                    <AnalysisContent
                      analysis={analysisState.analysis}
                      isLoading={analysisState.isLoading}
                      error={analysisState.error}
                      isRegenerating={analysisState.isRegenerating}
                      onRegenerate={handleRegenerateAnalysis}
                      showTimestamp={true}
                    />
                  ),
                },
                {
                  id: 'tokens',
                  label: 'Token Usage',
                  content: (
                    <Box padding={{ vertical: 'm' }}>
                      <SpaceBetween size="m">
                        <Box variant="h2">AI Model Token Usage</Box>
                        <TokenUsageTable
                          analysisTokenUsage={meeting.analysisTokenUsage}
                          reportTokenUsage={meeting.reportTokenUsage}
                        />
                      </SpaceBetween>
                    </Box>
                  ),
                },
              ]}
            />
          </div>
        </div>

        {/* Status Info */}
        <Box>
          <SpaceBetween size="xs">
            <Box variant="small" color="text-status-inactive">
              <SpaceBetween direction="horizontal" size="s">
                <span>Status:</span>
                {meeting.status === 'completed' ? (
                  <StatusIndicator type="success">Completed</StatusIndicator>
                ) : (
                  <StatusIndicator type="in-progress">{meeting.status}</StatusIndicator>
                )}
              </SpaceBetween>
            </Box>
            <Box variant="small" color="text-status-inactive">
              Total segments: {Array.isArray(transcript) ? transcript.length : 0}
            </Box>
          </SpaceBetween>
        </Box>
      </SpaceBetween>
    </Container>

      {/* Speaker Edit Modal */}
      <Modal
        visible={speakerEdit.isEditing}
        onDismiss={handleCancelEdit}
        header="Edit Speaker Name"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={handleCancelEdit}
                disabled={speakerEdit.isSaving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveSpeakerName}
                loading={speakerEdit.isSaving}
                disabled={!speakerEdit.newName.trim()}
              >
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="p" margin={{ bottom: 'xs' }}>
              Update the name for <strong>{speakerEdit.speakerLabel}</strong>. This will update all instances throughout the transcript.
            </Box>
          </Box>

          <Input
            value={speakerEdit.newName}
            onChange={({ detail }) => handleSpeakerNameChange(detail.value)}
            placeholder="Enter speaker name"
            disabled={speakerEdit.isSaving}
            autoFocus
            onKeyDown={(e) => {
              if (e.detail.key === 'Enter' && speakerEdit.newName.trim()) {
                handleSaveSpeakerName();
              }
            }}
          />

          {speakerEdit.saveError && (
            <Alert type="error" dismissible onDismiss={() => setSpeakerEdit((prev) => ({ ...prev, saveError: null }))}>
              {speakerEdit.saveError}
            </Alert>
          )}
        </SpaceBetween>
      </Modal>

      {/* Success Notification */}
      {speakerEdit.saveSuccess && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 1000 }}>
          <Flashbar
            items={[
              {
                type: 'success',
                content: 'Speaker name updated successfully',
                dismissible: true,
                onDismiss: () => setSpeakerEdit((prev) => ({ ...prev, saveSuccess: false })),
              },
            ]}
          />
        </div>
      )}
    </Layout>
  );
};
