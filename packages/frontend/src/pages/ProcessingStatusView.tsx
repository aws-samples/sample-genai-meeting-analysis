import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Header,
  SpaceBetween,
  ProgressBar,
  Alert,
  Button,
  Box,
  StatusIndicator,
} from '@cloudscape-design/components';
import { Layout } from '../components/Layout';
import { meetingService } from '../services/meeting-service';
import type { ProcessingStatus, MeetingStatus } from '@meeting-platform/shared';

const POLL_INTERVAL = 5000; // 5 seconds

interface StatusState {
  data: ProcessingStatus | null;
  isLoading: boolean;
  error: string | null;
  isPolling: boolean;
}

export const ProcessingStatusView: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const [statusState, setStatusState] = useState<StatusState>({
    data: null,
    isLoading: true,
    error: null,
    isPolling: false,
  });

  const fetchStatus = useCallback(async () => {
    if (!meetingId) {
      setStatusState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Meeting ID is required',
      }));
      return;
    }

    try {
      const status = await meetingService.getMeetingStatus(meetingId);
      
      setStatusState((prev) => ({
        ...prev,
        data: status,
        isLoading: false,
        error: null,
        isPolling: true,
      }));

      // Navigate to transcript view when completed
      if (status.status === 'completed') {
        setTimeout(() => {
          navigate(`/meetings/${meetingId}`);
        }, 1000);
      }
    } catch (error: any) {
      console.error('Failed to fetch status:', error);
      
      let errorMessage = 'Failed to fetch processing status';
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setStatusState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
        isPolling: false,
      }));
    }
  }, [meetingId, navigate]);

  const handleRetry = () => {
    setStatusState({
      data: null,
      isLoading: true,
      error: null,
      isPolling: false,
    });
    fetchStatus();
  };

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling setup
  useEffect(() => {
    // Don't poll if in terminal state
    if (statusState.data?.status === 'completed' || statusState.data?.status === 'failed') {
      return;
    }

    // Set up polling interval
    const intervalId = setInterval(() => {
      fetchStatus();
    }, POLL_INTERVAL);

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchStatus, statusState.data?.status]);

  const getStatusIndicator = (status: MeetingStatus) => {
    switch (status) {
      case 'uploading':
        return <StatusIndicator type="in-progress">Uploading</StatusIndicator>;
      case 'transcribing':
        return <StatusIndicator type="in-progress">Transcribing</StatusIndicator>;
      case 'analyzing':
        return <StatusIndicator type="in-progress">Analyzing</StatusIndicator>;
      case 'generating-report':
        return <StatusIndicator type="in-progress">Generating Report</StatusIndicator>;
      case 'generating-word-report':
        return <StatusIndicator type="in-progress">Generating Word Document</StatusIndicator>;
      case 'completed':
        return <StatusIndicator type="success">Completed</StatusIndicator>;
      case 'failed':
        return <StatusIndicator type="error">Failed</StatusIndicator>;
      default:
        return <StatusIndicator type="pending">Unknown</StatusIndicator>;
    }
  };

  const getStageDescription = (status: MeetingStatus) => {
    switch (status) {
      case 'uploading':
        return 'Uploading audio file to storage...';
      case 'transcribing':
        return 'Transcribing audio with speaker diarization and language detection...';
      case 'analyzing':
        return 'Generating AI-powered meeting analysis...';
      case 'generating-report':
        return 'Generating structured meeting report from transcript...';
      case 'generating-word-report':
        return 'Translating and generating Word document...';
      case 'completed':
        return 'Processing complete! Redirecting to transcript view...';
      case 'failed':
        return 'Processing failed. Please try uploading again.';
      default:
        return 'Processing...';
    }
  };

  if (statusState.isLoading && !statusState.data) {
    return (
      <Layout>
        <Container
        header={
          <Header variant="h1">
            Processing Meeting
          </Header>
        }
      >
        <Box textAlign="center" padding="xxl">
          <StatusIndicator type="loading">Loading status...</StatusIndicator>
        </Box>
      </Container>
      </Layout>
    );
  }

  if (statusState.error && !statusState.data) {
    return (
      <Layout>
        <Container
        header={
          <Header variant="h1">
            Processing Meeting
          </Header>
        }
      >
        <SpaceBetween size="l">
          <Alert
            type="error"
            header="Failed to load processing status"
          >
            {statusState.error}
          </Alert>
          <Button onClick={handleRetry}>
            Retry
          </Button>
        </SpaceBetween>
      </Container>
      </Layout>
    );
  }

  const { data } = statusState;

  return (
    <Layout>
      <Container
      header={
        <Header
          variant="h1"
          description="Your meeting is being processed. This may take a few minutes."
        >
          Processing Meeting
        </Header>
      }
    >
      <SpaceBetween size="l">
        {data && (
          <>
            <Box>
              <SpaceBetween size="m">
                <div>
                  <Box variant="h3" margin={{ bottom: 'xs' }}>
                    Current Status
                  </Box>
                  {getStatusIndicator(data.status)}
                </div>

                <div>
                  <Box variant="p" color="text-body-secondary">
                    {getStageDescription(data.status)}
                  </Box>
                </div>
              </SpaceBetween>
            </Box>

            <ProgressBar
              value={data.progress}
              label="Processing progress"
              description={`${data.progress}% complete`}
              status={data.status === 'failed' ? 'error' : 'in-progress'}
            />

            <Box>
              <SpaceBetween size="s">
                <Box variant="h4">Processing Stages</Box>
                <SpaceBetween size="xs">
                  <Box>
                    {data.status === 'uploading' || data.progress > 10 ? (
                      <StatusIndicator type={data.status === 'uploading' ? 'in-progress' : 'success'}>
                        Upload
                      </StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Upload</StatusIndicator>
                    )}
                  </Box>
                  <Box>
                    {data.status === 'transcribing' || data.progress > 30 ? (
                      <StatusIndicator type={data.status === 'transcribing' ? 'in-progress' : 'success'}>
                        Transcription
                      </StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Transcription</StatusIndicator>
                    )}
                  </Box>
                  <Box>
                    {data.status === 'analyzing' || data.progress > 50 ? (
                      <StatusIndicator type={data.status === 'analyzing' ? 'in-progress' : 'success'}>
                        Analysis
                      </StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Analysis</StatusIndicator>
                    )}
                  </Box>
                  <Box>
                    {data.status === 'generating-report' || data.status === 'generating-word-report' || data.status === 'completed' ? (
                      <StatusIndicator type={data.status === 'generating-report' ? 'in-progress' : 'success'}>
                        Report Generation
                      </StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Report Generation</StatusIndicator>
                    )}
                  </Box>
                  <Box>
                    {data.status === 'generating-word-report' || data.status === 'completed' ? (
                      <StatusIndicator type={data.status === 'generating-word-report' ? 'in-progress' : 'success'}>
                        Word Document
                      </StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">Word Document</StatusIndicator>
                    )}
                  </Box>
                </SpaceBetween>
              </SpaceBetween>
            </Box>

            {data.message && (
              <Alert type="info">
                {data.message}
              </Alert>
            )}

            {data.status === 'failed' && (
              <Alert
                type="error"
                header="Processing Failed"
                action={
                  <Button onClick={() => navigate('/upload')}>
                    Upload New Meeting
                  </Button>
                }
              >
                {data.message || 'An error occurred during processing. Please try uploading the file again.'}
              </Alert>
            )}

            {statusState.isPolling && data.status !== 'completed' && data.status !== 'failed' && (
              <Box color="text-body-secondary" fontSize="body-s">
                Status updates automatically every 5 seconds...
              </Box>
            )}
          </>
        )}
      </SpaceBetween>
    </Container>
    </Layout>
  );
};
