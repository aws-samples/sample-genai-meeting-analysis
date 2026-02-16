import { describe, it, expect } from 'vitest';
import {
  validateAudioFile,
  formatFileSize,
  SUPPORTED_FORMATS,
  MAX_FILE_SIZE,
} from './helpers';

describe('validateAudioFile', () => {
  it('should accept valid MP3 file', () => {
    const file = new File(['audio content'], 'meeting.mp3', { type: 'audio/mpeg' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should accept valid WAV file', () => {
    const file = new File(['audio content'], 'meeting.wav', { type: 'audio/wav' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should accept valid M4A file', () => {
    const file = new File(['audio content'], 'meeting.m4a', { type: 'audio/m4a' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should accept valid FLAC file', () => {
    const file = new File(['audio content'], 'meeting.flac', { type: 'audio/flac' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty file', () => {
    const file = new File([], 'empty.mp3', { type: 'audio/mpeg' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('File is empty. Please select a valid audio file.');
  });

  it('should reject file exceeding maximum size', () => {
    // Create a mock file object with size property set directly
    const file = new File(['content'], 'large.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE + 1 });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('File size exceeds maximum allowed size');
  });

  it('should reject unsupported file extension', () => {
    const file = new File(['video content'], 'meeting.mp4', { type: 'video/mp4' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported file format');
    expect(result.error).toContain(SUPPORTED_FORMATS.join(', '));
  });

  it('should reject unsupported MIME type', () => {
    const file = new File(['text content'], 'meeting.mp3', { type: 'text/plain' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported file type');
  });

  it('should accept file with no MIME type if extension is valid', () => {
    const file = new File(['audio content'], 'meeting.mp3', { type: '' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should handle file with uppercase extension', () => {
    const file = new File(['audio content'], 'meeting.MP3', { type: 'audio/mpeg' });
    const result = validateAudioFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('formatFileSize', () => {
  it('should format bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(500)).toBe('500 Bytes');
    expect(formatFileSize(1023)).toBe('1023 Bytes');
  });

  it('should format kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10 KB');
  });

  it('should format megabytes correctly', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(5242880)).toBe('5 MB');
    expect(formatFileSize(52428800)).toBe('50 MB');
  });

  it('should format gigabytes correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
    expect(formatFileSize(2147483648)).toBe('2 GB');
  });
});
