import React from 'react';
import {
  Box,
  Table,
  SpaceBetween,
  StatusIndicator,
} from '@cloudscape-design/components';
import type { TokenUsage } from '@meeting-platform/shared';

interface TokenUsageTableProps {
  analysisTokenUsage?: TokenUsage;
  reportTokenUsage?: TokenUsage;
}

export const TokenUsageTable: React.FC<TokenUsageTableProps> = ({
  analysisTokenUsage,
  reportTokenUsage,
}) => {
  // Calculate totals
  const totalInputTokens = 
    (analysisTokenUsage?.inputTokens || 0) + 
    (reportTokenUsage?.inputTokens || 0);
  
  const totalOutputTokens = 
    (analysisTokenUsage?.outputTokens || 0) + 
    (reportTokenUsage?.outputTokens || 0);
  
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Prepare table items
  const items = [];
  
  if (analysisTokenUsage) {
    items.push({
      stage: 'Analysis',
      modelId: analysisTokenUsage.modelId,
      inputTokens: analysisTokenUsage.inputTokens,
      outputTokens: analysisTokenUsage.outputTokens,
      total: analysisTokenUsage.inputTokens + analysisTokenUsage.outputTokens,
    });
  }
  
  if (reportTokenUsage) {
    items.push({
      stage: 'Report',
      modelId: reportTokenUsage.modelId,
      inputTokens: reportTokenUsage.inputTokens,
      outputTokens: reportTokenUsage.outputTokens,
      total: reportTokenUsage.inputTokens + reportTokenUsage.outputTokens,
    });
  }

  // If no token usage data available
  if (items.length === 0) {
    return (
      <Box textAlign="center" padding="l" color="text-status-inactive">
        <StatusIndicator type="info">
          Token usage data not available
        </StatusIndicator>
      </Box>
    );
  }

  return (
    <SpaceBetween size="m">
      <Table
        columnDefinitions={[
          {
            id: 'stage',
            header: 'Processing Stage',
            cell: (item) => item.stage,
            width: 150,
          },
          {
            id: 'modelId',
            header: 'Model',
            cell: (item) => (
              <span style={{ fontSize: '14px', fontFamily: 'monospace' }}>
                {item.modelId}
              </span>
            ),
          },
          {
            id: 'inputTokens',
            header: 'Input Tokens',
            cell: (item) => item.inputTokens.toLocaleString(),
            width: 120,
          },
          {
            id: 'outputTokens',
            header: 'Output Tokens',
            cell: (item) => item.outputTokens.toLocaleString(),
            width: 120,
          },
          {
            id: 'total',
            header: 'Total',
            cell: (item) => (
              <Box fontWeight="bold">
                {item.total.toLocaleString()}
              </Box>
            ),
            width: 120,
          },
        ]}
        items={items}
        variant="embedded"
        empty={
          <Box textAlign="center" color="inherit">
            <b>No token usage data</b>
          </Box>
        }
      />

      {/* Totals Summary */}
      <div
        style={{
          padding: '16px',
          backgroundColor: '#f9f9f9',
          borderRadius: '8px',
          border: '1px solid #e0e0e0',
        }}
      >
        <SpaceBetween size="xs">
          <Box variant="h3" margin={{ bottom: 'xs' }}>
            Total Token Usage
          </Box>
          <SpaceBetween direction="horizontal" size="l">
            <Box>
              <Box variant="small" color="text-label">
                Total Input Tokens
              </Box>
              <Box variant="h2" fontWeight="bold" color="text-status-info">
                {totalInputTokens.toLocaleString()}
              </Box>
            </Box>
            <Box>
              <Box variant="small" color="text-label">
                Total Output Tokens
              </Box>
              <Box variant="h2" fontWeight="bold" color="text-status-info">
                {totalOutputTokens.toLocaleString()}
              </Box>
            </Box>
            <Box>
              <Box variant="small" color="text-label">
                Grand Total
              </Box>
              <Box variant="h2" fontWeight="bold" color="text-status-success">
                {totalTokens.toLocaleString()}
              </Box>
            </Box>
          </SpaceBetween>
        </SpaceBetween>
      </div>
    </SpaceBetween>
  );
};
