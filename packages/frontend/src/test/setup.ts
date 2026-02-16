import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock environment variables
vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'test-pool-id');
vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client-id');
vi.stubEnv('VITE_COGNITO_REGION', 'us-east-1');
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
