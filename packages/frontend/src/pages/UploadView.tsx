import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  Button,
  Alert,
  ProgressBar,
  Box,
} from '@cloudscape-design/components';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { meetingService } from '../services/meeting-service';
import { validateAudioFile, formatFileSize, SUPPORTED_FORMATS, MAX_FILE_SIZE } from '../utils/helpers';

interface UploadState {
  status: 'idle' | 'uploading' | 'starting-transcription' | 'complete' | 'error';
  progress: number;
  error?: string;
  meetingId?: string;
}

export const UploadView: React.FC = () => {
  const navigate = useNavigate();
  const { user, getAccessToken } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
  });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    // Validate file
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      setUploadState({
        status: 'error',
        progress: 0,
        error: validation.error,
      });
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadState({
      status: 'idle',
      progress: 0,
    });
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploadState({
        status: 'uploading',
        progress: 0,
      });

      // Debug: Check authentication
      const token = await getAccessToken();
      console.log('Auth check:', {
        isAuthenticated: !!user,
        hasToken: !!token,
        userId: user?.userId,
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
      });

      if (!token) {
        throw new Error('Not authenticated. Please log in and try again.');
      }

      // Step 1: Create meeting and get upload URL
      const createResponse = await meetingService.createMeeting({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        contentType: selectedFile.type,
      });

      // Step 2: Upload file to S3
      await meetingService.uploadAudioFile(
        createResponse.uploadUrl,
        selectedFile,
        (progress) => {
          setUploadState((prev) => ({
            ...prev,
            progress,
          }));
        }
      );

      // Step 3: Start transcription
      setUploadState({
        status: 'starting-transcription',
        progress: 100,
        meetingId: createResponse.meetingId,
      });

      await meetingService.startTranscription(createResponse.meetingId);

      // Step 4: Navigate to processing status view
      setUploadState({
        status: 'complete',
        progress: 100,
        meetingId: createResponse.meetingId,
      });

      // Navigate to status page after a brief delay
      setTimeout(() => {
        navigate(`/meetings/${createResponse.meetingId}/status`);
      }, 500);
    } catch (error: any) {
      console.error('Upload failed:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Upload failed. Please try again.';
      
      if (error.response?.status === 401) {
        errorMessage = 'Authentication failed. Please log out and log in again.';
      } else if (error.response?.status === 403) {
        errorMessage = 'Access denied. You do not have permission to upload files.';
      } else if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setUploadState({
        status: 'error',
        progress: 0,
        error: errorMessage,
      });
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setUploadState({
      status: 'idle',
      progress: 0,
    });
  };

  const isUploading = uploadState.status === 'uploading' || uploadState.status === 'starting-transcription';
  const canUpload = selectedFile && uploadState.status === 'idle';

  return (
    <Layout>
      <Container
      header={
        <Header
          variant="h1"
          description="Upload an audio recording of your meeting for transcription and analysis"
          info={user ? `Logged in as: ${user.email}` : undefined}
        >
          Upload Meeting Recording
        </Header>
      }
    >
      <SpaceBetween size="l">
        {!user && (
          <Alert type="warning">
            You must be logged in to upload files. Please log in first.
          </Alert>
        )}
        
        {uploadState.status === 'error' && (
          <Alert type="error" dismissible onDismiss={handleReset}>
            {uploadState.error}
          </Alert>
        )}

        <FormField
          label="Audio File"
          description={`Supported formats: ${SUPPORTED_FORMATS.join(', ')}. Maximum size: ${formatFileSize(MAX_FILE_SIZE)}`}
        >
          <SpaceBetween size="xs" direction="horizontal">
            <Button onClick={handleChooseFile} disabled={isUploading}>
              Choose File
            </Button>
            {selectedFile && <span style={{ lineHeight: '32px' }}>{selectedFile.name}</span>}
          </SpaceBetween>
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_FORMATS.map((fmt) => `.${fmt}`).join(',')}
            onChange={handleFileSelect}
            disabled={isUploading}
            style={{ display: 'none' }}
          />
        </FormField>

        {selectedFile && (
          <Box>
            <SpaceBetween size="xs">
              <div>
                <strong>Selected file:</strong> {selectedFile.name}
              </div>
              <div>
                <strong>Size:</strong> {formatFileSize(selectedFile.size)}
              </div>
              <div>
                <strong>Type:</strong> {selectedFile.type || 'Unknown'}
              </div>
            </SpaceBetween>
          </Box>
        )}

        {isUploading && (
          <FormField label={uploadState.status === 'uploading' ? 'Upload Progress' : 'Starting Transcription'}>
            <ProgressBar
              value={uploadState.progress}
              label={uploadState.status === 'uploading' ? 'Uploading...' : 'Starting transcription...'}
            />
          </FormField>
        )}

        <SpaceBetween size="xs" direction="horizontal">
          <Button variant="primary" onClick={handleUpload} disabled={!canUpload || isUploading} loading={isUploading}>
            {isUploading ? 'Uploading...' : 'Upload and Process'}
          </Button>
          {selectedFile && !isUploading && (
            <Button onClick={handleReset} disabled={isUploading}>
              Clear
            </Button>
          )}
        </SpaceBetween>
      </SpaceBetween>
    </Container>
    </Layout>
  );
};
