// Shared utility functions for Lambda functions
// These will be populated in subsequent tasks

export function getUserIdFromEvent(event: any): string {
  const claims = event.requestContext?.authorizer?.claims;
  if (!claims || !claims.sub) {
    throw new Error('User ID not found in request context');
  }
  return claims.sub;
}

export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

export function logWithContext(
  correlationId: string,
  level: string,
  message: string,
  data?: any
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      correlationId,
      level,
      message,
      ...data,
    })
  );
}
