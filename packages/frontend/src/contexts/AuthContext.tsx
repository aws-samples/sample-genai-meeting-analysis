import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import {
  signOut,
  getCurrentUser,
  fetchAuthSession,
  signInWithRedirect,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

// Configure Amplify only if credentials are provided
// Use runtime config (from CDK deployment) or fall back to env vars (local dev)
const runtimeConfig = (window as any).APP_CONFIG;
const userPoolId = runtimeConfig?.userPoolId || import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = runtimeConfig?.userPoolClientId || import.meta.env.VITE_COGNITO_CLIENT_ID;
const cognitoDomain = runtimeConfig?.cognitoDomain || import.meta.env.VITE_COGNITO_DOMAIN;

if (userPoolId && clientId && cognitoDomain) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: clientId,
        loginWith: {
          oauth: {
            domain: cognitoDomain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [window.location.origin + '/dashboard/'],
            redirectSignOut: [window.location.origin + '/'],
            responseType: 'code',
          },
        },
      },
    },
  });
}

interface AuthUser {
  userId: string;
  email: string;
  username: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();

    // Listen for auth events (e.g. redirect back from Hosted UI)
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        checkAuthStatus();
      }
      if (payload.event === 'signInWithRedirect_failure') {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const checkAuthStatus = async () => {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();

      if (currentUser && session.tokens) {
        const idToken = session.tokens.idToken;
        const email = idToken?.payload?.email as string || currentUser.signInDetails?.loginId || '';

        setUser({
          userId: currentUser.userId,
          email,
          username: currentUser.username,
        });
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    await signInWithRedirect();
  };

  const logout = async () => {
    try {
      await signOut({ global: true });
      setUser(null);
    } catch (error: any) {
      console.error('Logout error:', error);
      throw new Error(error.message || 'Failed to logout');
    }
  };

  const refreshSession = async () => {
    try {
      await fetchAuthSession({ forceRefresh: true });
    } catch (error: any) {
      console.error('Session refresh error:', error);
      throw new Error(error.message || 'Failed to refresh session');
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    refreshSession,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
