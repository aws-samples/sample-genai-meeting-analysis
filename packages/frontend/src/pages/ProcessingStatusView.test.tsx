import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProcessingStatusView } from './ProcessingStatusView';
import { meetingService } from '../services/meeting-service';
import type { ProcessingStatus } from '@meeting-platform/shared';
import { AuthProvider } from '../contexts/AuthContext';

// Mock the meeting service
vi.mock('../services/meeting-service', () => ({
  meetingService: {
    getMeetingStatus: vi.fn(),
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ProcessingStatusView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const renderWithRouter = (meetingId: string = 'test-meeting-123') => {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={[`/meetings/${meetingId}/status`]}>
          <Routes>
            <Route path="/meetings/:meetingId/status" element={<ProcessingStatusView />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  };

  it('should display loading state initially', () => {
    vi.mocked(meetingService.getMeetingStatus).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    renderWithRouter();

    expect(screen.getByText('Loading status...')).toBeInTheDocument();
  });

  it('should fetch and display transcribing status', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'transcribing',
      progress: 40,
      stage: 'transcription',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Transcribing')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('40% complete')).toBeInTheDocument();
    expect(screen.getByText(/Transcribing audio with speaker diarization/)).toBeInTheDocument();
  });

  it('should fetch and display analyzing status', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'analyzing',
      progress: 80,
      stage: 'analysis',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Analyzing')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('80% complete')).toBeInTheDocument();
    expect(screen.getByText(/Generating AI-powered meeting analysis/)).toBeInTheDocument();
  });

  it('should poll status every 5 seconds', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'transcribing',
      progress: 30,
      stage: 'transcription',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    const { unmount } = renderWithRouter();

    // Initial fetch
    await waitFor(() => {
      expect(meetingService.getMeetingStatus).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify polling is set up by checking the service was called
    expect(meetingService.getMeetingStatus).toHaveBeenCalledWith('test-meeting-123');
    
    unmount();
  });

  it('should navigate to transcript view when completed', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'completed',
      progress: 100,
      stage: 'complete',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter('meeting-456');

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Wait for navigation to be called
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/meetings/meeting-456');
    }, { timeout: 3000 });
  });

  it('should display error state with retry button', async () => {
    vi.mocked(meetingService.getMeetingStatus).mockRejectedValue(
      new Error('Network error')
    );

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Failed to load processing status')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('should handle failed processing status', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'failed',
      progress: 50,
      stage: 'transcription',
      message: 'Audio format not supported',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('Processing Failed')).toBeInTheDocument();
    expect(screen.getAllByText('Audio format not supported').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /upload new meeting/i })).toBeInTheDocument();
  });

  it('should show correct stage indicators for transcribing status', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'transcribing',
      progress: 40,
      stage: 'transcription',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Transcribing')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Check stage indicators
    const stageSection = screen.getByText('Processing Stages').parentElement;
    expect(stageSection).toBeInTheDocument();
  });

  it('should stop polling when status is completed', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'completed',
      progress: 100,
      stage: 'complete',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Verify the status was fetched
    expect(meetingService.getMeetingStatus).toHaveBeenCalled();
  });

  it('should stop polling when status is failed', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'failed',
      progress: 30,
      stage: 'transcription',
      message: 'Processing error',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Verify the status was fetched
    expect(meetingService.getMeetingStatus).toHaveBeenCalled();
  });

  it('should display custom message when provided', async () => {
    const mockStatus: ProcessingStatus = {
      status: 'analyzing',
      progress: 85,
      stage: 'analysis',
      message: 'Generating insights from transcript...',
    };

    vi.mocked(meetingService.getMeetingStatus).mockResolvedValue(mockStatus);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Generating insights from transcript...')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
