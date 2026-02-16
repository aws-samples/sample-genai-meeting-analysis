/**
 * Application constants and configuration
 */

// Runtime config injected by CDK deployment (window.APP_CONFIG)
// Falls back to environment variables for local development
declare global {
  interface Window {
    APP_CONFIG?: {
      userPoolId: string;
      userPoolClientId: string;
      identityPoolId: string;
      apiUrl: string;
      region: string;
    };
  }
}

const runtimeConfig = window.APP_CONFIG;

export const API_CONFIG = {
  BASE_URL: runtimeConfig?.apiUrl || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  TIMEOUT: 30000,
  POLLING_INTERVAL: 5000, // 5 seconds for status polling
};

export const COGNITO_CONFIG = {
  USER_POOL_ID: runtimeConfig?.userPoolId || import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  CLIENT_ID: runtimeConfig?.userPoolClientId || import.meta.env.VITE_COGNITO_CLIENT_ID || '',
  REGION: runtimeConfig?.region || import.meta.env.VITE_COGNITO_REGION || 'us-east-1',
};

export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 500 * 1024 * 1024, // 500 MB
  ACCEPTED_FORMATS: [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a',
    'audio/x-m4a',
    'audio/flac',
  ],
  ACCEPTED_EXTENSIONS: ['.mp3', '.wav', '.m4a', '.flac'],
};

export const ROUTES = {
  DASHBOARD: '/dashboard',
  UPLOAD: '/upload',
  MEETING_DETAILS: '/meetings/:meetingId',
  SETTINGS: '/settings',
} as const;
