import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as auth from 'aws-amplify/auth';

// Mock AWS Amplify auth functions
vi.mock('aws-amplify/auth', () => ({
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

// Mock Amplify configuration
vi.mock('aws-amplify', () => ({
  Amplify: {
    configure: vi.fn(),
  },
}));

// Mock Hub
vi.mock('aws-amplify/utils', () => ({
  Hub: {
    listen: vi.fn(() => vi.fn()),
  },
}));

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with loading state', () => {
    vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBe(null);
  });

  it('should set authenticated user when session exists', async () => {
    const mockUser = {
      userId: 'user-123',
      username: 'testuser',
      signInDetails: {
        loginId: 'test@example.com',
      },
    };

    const mockSession = {
      tokens: {
        accessToken: { toString: () => 'mock-token' },
        idToken: { payload: { email: 'test@example.com' } },
      },
    };

    vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser as any);
    vi.mocked(auth.fetchAuthSession).mockResolvedValue(mockSession as any);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({
      userId: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
    });
  });

  it('should call signInWithRedirect on login', async () => {
    vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login();
    });

    expect(auth.signInWithRedirect).toHaveBeenCalled();
  });

  it('should handle logout successfully', async () => {
    const mockUser = {
      userId: 'user-123',
      username: 'testuser',
      signInDetails: {
        loginId: 'test@example.com',
      },
    };

    const mockSession = {
      tokens: {
        accessToken: { toString: () => 'mock-token' },
        idToken: { payload: { email: 'test@example.com' } },
      },
    };

    vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser as any);
    vi.mocked(auth.fetchAuthSession).mockResolvedValue(mockSession as any);
    vi.mocked(auth.signOut).mockResolvedValue(undefined as any);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(auth.signOut).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBe(null);
  });

  it('should get access token', async () => {
    const mockSession = {
      tokens: {
        accessToken: { toString: () => 'mock-access-token' },
      },
    };

    vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
    vi.mocked(auth.fetchAuthSession).mockResolvedValue(mockSession as any);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let token;
    await act(async () => {
      token = await result.current.getAccessToken();
    });

    expect(token).toBe('mock-access-token');
  });

  it('should refresh session', async () => {
    vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
    vi.mocked(auth.fetchAuthSession).mockResolvedValue({} as any);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.refreshSession();
    });

    expect(auth.fetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it('should throw error when useAuth is used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });
});
