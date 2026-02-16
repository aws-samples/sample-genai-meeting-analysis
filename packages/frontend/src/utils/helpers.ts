/**
 * Utility helper functions
 */

/**
 * Supported audio formats
 */
export const SUPPORTED_FORMATS = ['mp3', 'wav', 'm4a', 'flac'];

/**
 * Maximum file size (500 MB)
 */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

/**
 * Supported MIME types for audio files
 */
export const SUPPORTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
  'audio/x-flac',
];

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate audio file format and size
 */
export function validateAudioFile(file: File): ValidationResult {
  // Check file size
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty. Please select a valid audio file.',
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${formatFileSize(MAX_FILE_SIZE)}.`,
    };
  }

  // Check file extension
  const extension = getFileExtension(file.name).replace('.', '');
  if (!SUPPORTED_FORMATS.includes(extension)) {
    return {
      valid: false,
      error: `Unsupported file format. Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`,
    };
  }

  // Check MIME type if available
  if (file.type && !SUPPORTED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`,
    };
  }

  return { valid: true };
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format timestamp to relative time (e.g., "2 hours ago")
 */
export function formatDistanceToNow(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays < 30) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  } else {
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
  }
}

/**
 * Format milliseconds to timestamp (MM:SS.mmm)
 */
export function formatMilliseconds(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Validate file type
 */
export function isValidAudioFile(file: File, acceptedTypes: string[]): boolean {
  return acceptedTypes.includes(file.type);
}

/**
 * Validate file size
 */
export function isValidFileSize(file: File, maxSize: number): boolean {
  return file.size <= maxSize;
}

/**
 * Get file extension
 */
export function getFileExtension(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}
