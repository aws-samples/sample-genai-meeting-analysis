# Authentication Context

This directory contains the authentication context and provider for the Meeting Analysis Platform.

## Overview

The authentication system uses AWS Cognito for user management and AWS Amplify for integration. It provides a React context that manages authentication state throughout the application.

## Components

### AuthContext

The main authentication context that provides:

- **User State**: Current authenticated user information
- **Authentication Methods**: Login, signup, logout, and session management
- **Token Management**: Automatic token refresh and access token retrieval

### Usage

```typescript
import { useAuth } from './contexts/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, login, logout } = useAuth();

  // Use authentication state and methods
}
```

## Features

### 1. User Authentication
- Email-based login with Cognito
- Automatic session management
- Token refresh handling
- Users are managed by application administrators (no self-registration)
- Temporary password handling with forced password change on first login

### 2. Password Management
- Detects `NEW_PASSWORD_REQUIRED` challenge from Cognito
- Prompts users to set a new password when using temporary credentials
- Password validation with strength requirements:
  - Minimum 8 characters
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number
  - At least one special character

### 3. Protected Routes
- Automatic redirect to login for unauthenticated users
- Preserve intended destination after login
- Loading state during authentication check

### 4. Session Management
- Automatic token refresh
- Session persistence across page reloads
- Logout functionality

## Configuration

Set the following environment variables in `.env`:

```
VITE_COGNITO_USER_POOL_ID=your-user-pool-id
VITE_COGNITO_CLIENT_ID=your-client-id
VITE_COGNITO_REGION=us-east-1
```

## API Integration

The authentication context integrates with the API client to automatically add authentication tokens to all API requests. See `src/lib/api-client.ts` for implementation details.

## Testing

Unit tests are provided in `AuthContext.test.tsx` covering:
- Initial authentication state
- Login flow
- New password required challenge
- Password change completion
- Logout flow
- Token management
- Error handling

## User Management

Users are created and managed by application administrators through the AWS Cognito console. There is no self-registration functionality in the application.

### Creating Users with Temporary Passwords

When administrators create users in Cognito, they can set a temporary password. On first login:

1. User enters their email and temporary password
2. System detects `NEW_PASSWORD_REQUIRED` challenge
3. User is prompted to set a new password
4. After setting the new password, user is automatically logged in

This ensures secure onboarding of new users while maintaining administrator control over user creation.
