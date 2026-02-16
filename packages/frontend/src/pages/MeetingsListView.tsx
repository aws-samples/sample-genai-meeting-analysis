import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Box,
  SpaceBetween,
  Button,
  Header,
  StatusIndicator,
  TextFilter,
  Pagination,
  CollectionPreferences,
  Link,
} from '@cloudscape-design/components';
import type { TableProps } from '@cloudscape-design/components';
import { Layout } from '../components/Layout';
import { meetingService } from '../services/meeting-service';
import type { Meeting, MeetingStatus } from '../types';
import { formatDistanceToNow } from '../utils/helpers';

/**
 * MeetingsListView Component
 * Displays a table of all user meetings with filtering, sorting, and navigation
 */
export function MeetingsListView() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filteringText, setFilteringText] = useState('');
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<Meeting>>({
    sortingField: 'createdAt',
  });
  const [sortingDescending, setSortingDescending] = useState(true);

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await meetingService.getMeetings();
      setMeetings(data);
    } catch (err) {
      setError('Failed to load meetings. Please try again.');
      console.error('Error loading meetings:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIndicator = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return <StatusIndicator type="success">Completed</StatusIndicator>;
      case 'transcribing':
        return <StatusIndicator type="in-progress">Transcribing</StatusIndicator>;
      case 'analyzing':
        return <StatusIndicator type="in-progress">Analyzing</StatusIndicator>;
      case 'generating-report':
        return <StatusIndicator type="in-progress">Generating Report</StatusIndicator>;
      case 'generating-word-report':
        return <StatusIndicator type="in-progress">Generating Word Doc</StatusIndicator>;
      case 'uploading':
        return <StatusIndicator type="pending">Uploading</StatusIndicator>;
      case 'failed':
        return <StatusIndicator type="error">Failed</StatusIndicator>;
      default:
        return <StatusIndicator type="info">{status}</StatusIndicator>;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const columnDefinitions: TableProps.ColumnDefinition<Meeting>[] = [
    {
      id: 'fileName',
      header: 'File Name',
      cell: (item) => {
        const fileName = item.fileName || (item as any).audioFileName || 'Unknown';
        const isClickable = item.status === 'completed' || 
                           item.status === 'transcribing' || 
                           item.status === 'analyzing' ||
                           item.status === 'generating-report' ||
                           item.status === 'generating-word-report';
        
        if (isClickable) {
          return (
            <Link
              onFollow={(e) => {
                e.preventDefault();
                handleRowClick(item);
              }}
            >
              {fileName}
            </Link>
          );
        }
        return fileName;
      },
      sortingField: 'fileName',
      width: 300,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item) => getStatusIndicator(item.status),
      sortingField: 'status',
      width: 150,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (item) => formatDuration(item.duration),
      sortingField: 'duration',
      width: 100,
    },
    {
      id: 'tokens',
      header: 'Total Tokens',
      cell: (item) => {
        const analysisTokens = 
          (item.analysisTokenUsage?.inputTokens || 0) + 
          (item.analysisTokenUsage?.outputTokens || 0);
        const reportTokens = 
          (item.reportTokenUsage?.inputTokens || 0) + 
          (item.reportTokenUsage?.outputTokens || 0);
        const totalTokens = analysisTokens + reportTokens;
        
        if (totalTokens === 0) {
          return (
            <Box color="text-status-inactive" fontSize="body-s">
              N/A
            </Box>
          );
        }
        
        return (
          <Box>
            <div>{totalTokens.toLocaleString()}</div>
            <Box variant="small" color="text-body-secondary">
              {analysisTokens > 0 && `Analysis: ${analysisTokens.toLocaleString()}`}
              {analysisTokens > 0 && reportTokens > 0 && ' | '}
              {reportTokens > 0 && `Report: ${reportTokens.toLocaleString()}`}
            </Box>
          </Box>
        );
      },
      width: 180,
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (item) => (
        <Box>
          <div>{formatDate(item.createdAt)}</div>
          <Box variant="small" color="text-body-secondary">
            {formatDistanceToNow(item.createdAt)}
          </Box>
        </Box>
      ),
      sortingField: 'createdAt',
      width: 200,
    },
  ];

  // Filter meetings based on search text
  const filteredMeetings = meetings.filter((meeting) => {
    if (!filteringText) return true;
    const searchText = filteringText.toLowerCase();
    const fileName = meeting.fileName || (meeting as any).audioFileName || '';
    return (
      fileName.toLowerCase().includes(searchText) ||
      meeting.status.toLowerCase().includes(searchText)
    );
  });

  // Sort meetings
  const sortedMeetings = [...filteredMeetings].sort((a, b) => {
    const field = sortingColumn.sortingField as keyof Meeting;
    const aValue = a[field];
    const bValue = b[field];

    if (aValue === undefined || bValue === undefined) return 0;

    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue;
    }

    return sortingDescending ? -comparison : comparison;
  });

  // Paginate meetings
  const paginatedMeetings = sortedMeetings.slice(
    (currentPageIndex - 1) * pageSize,
    currentPageIndex * pageSize
  );

  const handleRowClick = (meeting: Meeting) => {
    if (meeting.status === 'completed') {
      navigate(`/meetings/${meeting.meetingId}`);
    } else if (meeting.status === 'transcribing' || meeting.status === 'analyzing') {
      navigate(`/meetings/${meeting.meetingId}/status`);
    } else if (meeting.status === 'failed') {
      // Stay on list view for failed meetings
      return;
    }
  };

  return (
    <Layout>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          actions={
            <Button variant="primary" onClick={() => navigate('/upload')}>
              Upload New Meeting
            </Button>
          }
        >
          My Meetings
        </Header>

        {error && (
          <Box color="text-status-error" variant="p">
            {error}
          </Box>
        )}

        <Table
          columnDefinitions={columnDefinitions}
          items={paginatedMeetings}
          loading={loading}
          loadingText="Loading meetings..."
          empty={
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="m">
                <b>No meetings</b>
                <Button onClick={() => navigate('/upload')}>Upload your first meeting</Button>
              </SpaceBetween>
            </Box>
          }
          filter={
            <TextFilter
              filteringText={filteringText}
              filteringPlaceholder="Search meetings"
              filteringAriaLabel="Filter meetings"
              onChange={({ detail }) => {
                setFilteringText(detail.filteringText);
                setCurrentPageIndex(1); // Reset to first page on filter
              }}
            />
          }
          header={
            <Header
              counter={`(${filteredMeetings.length})`}
              actions={
                <Button iconName="refresh" onClick={loadMeetings}>
                  Refresh
                </Button>
              }
            >
              Meetings
            </Header>
          }
          pagination={
            <Pagination
              currentPageIndex={currentPageIndex}
              pagesCount={Math.ceil(sortedMeetings.length / pageSize)}
              onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
            />
          }
          preferences={
            <CollectionPreferences
              title="Preferences"
              confirmLabel="Confirm"
              cancelLabel="Cancel"
              preferences={{
                pageSize,
              }}
              pageSizePreference={{
                title: 'Page size',
                options: [
                  { value: 10, label: '10 meetings' },
                  { value: 20, label: '20 meetings' },
                  { value: 50, label: '50 meetings' },
                ],
              }}
              onConfirm={({ detail }) => {
                setPageSize(detail.pageSize || 10);
                setCurrentPageIndex(1);
              }}
            />
          }
          sortingColumn={sortingColumn}
          sortingDescending={sortingDescending}
          onSortingChange={({ detail }) => {
            setSortingColumn(detail.sortingColumn);
            setSortingDescending(detail.isDescending || false);
          }}
          onRowClick={({ detail }) => handleRowClick(detail.item)}
          selectionType={undefined}
        />
      </SpaceBetween>
    </Layout>
  );
}
