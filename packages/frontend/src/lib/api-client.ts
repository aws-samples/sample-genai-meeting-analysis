import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';
import { API_CONFIG } from '../config/constants';

/**
 * API Client configuration and setup
 */

/**
 * Create axios instance with default configuration
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor to add authentication token from Cognito
 */
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      // Get current session from Cognito
      const session = await fetchAuthSession();
      
      // Use idToken instead of accessToken for Cognito User Pool authorizer
      // The idToken contains user claims (sub, email, etc.) that the authorizer validates
      const token = session.tokens?.idToken?.toString();
      
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      // User is not authenticated, request will proceed without token
      console.debug('No auth token available');
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor to handle errors and token refresh
 */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 Unauthorized - token expired or invalid
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Attempt to refresh token with Cognito
        const session = await fetchAuthSession({ forceRefresh: true });
        
        // Use idToken for Cognito User Pool authorizer
        const newToken = session.tokens?.idToken?.toString();
        
        if (newToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        } else {
          // No token available, redirect to root (will trigger Hosted UI login)
          window.location.href = '/';
        }
      } catch (refreshError) {
        // Refresh failed, redirect to root (will trigger Hosted UI login)
        window.location.href = '/';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
