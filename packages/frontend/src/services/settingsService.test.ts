import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateReportTemplate,
  getDefaultReportTemplate,
  saveReportTemplate,
  getReportTemplate,
} from './settingsService';
import { apiClient } from '../lib/api-client';

// Mock the API client
vi.mock('../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('validateReportTemplate', () => {
  it('should validate template with valid placeholders', () => {
    const template = '# Report\n{{meeting_date}}\n{{company_name}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject template with single brace placeholders', () => {
    const template = '# Report\n{meeting_date}\n{company_name}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid placeholder syntax');
  });

  it('should reject placeholders with spaces', () => {
    const template = '# Report\n{{meeting date}}\n{{company name}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('contains spaces'))).toBe(true);
  });

  it('should reject placeholders with invalid characters', () => {
    const template = '# Report\n{{meeting-date}}\n{{company@name}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('invalid characters'))).toBe(true);
  });

  it('should reject empty placeholders', () => {
    const template = '# Report\n{{}}\n{{company_name}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Empty placeholder'))).toBe(true);
  });

  it('should accept template with underscores and numbers', () => {
    const template = '# Report\n{{meeting_date_2024}}\n{{company_name_1}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept template with no placeholders', () => {
    const template = '# Report\nThis is a static template with no placeholders.';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle multiple validation errors', () => {
    const template = '# Report\n{{meeting date}}\n{company}\n{{invalid-name}}';
    const result = validateReportTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('getDefaultReportTemplate', () => {
  it('should return a non-empty template', () => {
    const template = getDefaultReportTemplate();
    expect(template).toBeTruthy();
    expect(template.length).toBeGreaterThan(0);
  });

  it('should contain valid placeholders', () => {
    const template = getDefaultReportTemplate();
    const validation = validateReportTemplate(template);
    expect(validation.isValid).toBe(true);
  });

  it('should contain expected placeholders', () => {
    const template = getDefaultReportTemplate();
    expect(template).toContain('{{meeting_date}}');
    expect(template).toContain('{{company_name}}');
    expect(template).toContain('{{agenda_points}}');
  });
});

describe('saveReportTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save valid template successfully', async () => {
    const mockResponse = {
      data: {
        templateId: 'test-id',
        validationErrors: [],
      },
    };
    vi.mocked(apiClient.put).mockResolvedValue(mockResponse);

    const request = {
      templateName: 'Test Template',
      templateContent: '# Report\n{{meeting_date}}',
    };

    const result = await saveReportTemplate(request);
    expect(result.templateId).toBe('test-id');
    expect(result.validationErrors).toEqual([]);
    expect(apiClient.put).toHaveBeenCalledWith('/settings/report-template', request);
  });

  it('should return validation errors for invalid template', async () => {
    const request = {
      templateName: 'Test Template',
      templateContent: '# Report\n{meeting_date}',
    };

    const result = await saveReportTemplate(request);
    expect(result.templateId).toBe('');
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.length).toBeGreaterThan(0);
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('should handle backend validation errors', async () => {
    const mockError = {
      response: {
        status: 400,
        data: {
          validationErrors: ['Backend validation error'],
        },
      },
    };
    vi.mocked(apiClient.put).mockRejectedValue(mockError);

    const request = {
      templateName: 'Test Template',
      templateContent: '# Report\n{{meeting_date}}',
    };

    const result = await saveReportTemplate(request);
    expect(result.templateId).toBe('');
    expect(result.validationErrors).toEqual(['Backend validation error']);
  });

  it('should retry on 5xx errors', async () => {
    const mockError = {
      response: {
        status: 500,
      },
    };
    const mockSuccess = {
      data: {
        templateId: 'test-id',
        validationErrors: [],
      },
    };

    vi.mocked(apiClient.put)
      .mockRejectedValueOnce(mockError)
      .mockResolvedValueOnce(mockSuccess);

    const request = {
      templateName: 'Test Template',
      templateContent: '# Report\n{{meeting_date}}',
    };

    const result = await saveReportTemplate(request);
    expect(result.templateId).toBe('test-id');
    expect(apiClient.put).toHaveBeenCalledTimes(2);
  });
});

describe('getReportTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should retrieve template successfully', async () => {
    const mockTemplate = {
      templateId: 'test-id',
      templateName: 'Test Template',
      templateContent: '# Report\n{{meeting_date}}',
      createdAt: Date.now(),
    };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { template: mockTemplate } });

    const result = await getReportTemplate();
    expect(result).toEqual(mockTemplate);
    expect(apiClient.get).toHaveBeenCalledWith('/settings/report-template');
  });

  it('should return default template when none exists', async () => {
    const mockError = {
      response: {
        status: 404,
      },
    };
    vi.mocked(apiClient.get).mockRejectedValue(mockError);

    const result = await getReportTemplate();
    expect(result.templateId).toBe('default');
    expect(result.templateName).toBe('Default Template');
    expect(result.templateContent).toBeTruthy();
    expect(result.createdAt).toBeDefined();
  });

  it('should throw error for non-404 errors', async () => {
    const mockError = {
      response: {
        status: 500,
      },
    };
    vi.mocked(apiClient.get).mockRejectedValue(mockError);

    await expect(getReportTemplate()).rejects.toThrow();
  });
});
