// Shared types for Lambda functions
// These will be populated in subsequent tasks

export interface ApiResponse {
  statusCode: number;
  headers: {
    'Content-Type': string;
  };
  body: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
  retryable?: boolean;
}

export function createSuccessResponse(data: any): ApiResponse {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  };
}

export function createErrorResponse(
  statusCode: number,
  error: ApiError
): ApiResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ error }),
  };
}
