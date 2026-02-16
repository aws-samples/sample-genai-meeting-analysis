/**
 * WordTemplateSettings Component
 * 
 * Provides UI for uploading Word templates, configuring languages,
 * and managing placeholder translation settings.
 * 
 * Requirements: 1.1, 1.4, 1.5, 2.1, 2.5, 3.1, 3.2, 3.3
 */

import { useState, useEffect, useRef } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  Select,
  Button,
  Alert,
  Spinner,
  Box,
  ColumnLayout,
  Input,
  Toggle,
  Table,
  ProgressBar,
  Icon,
} from '@cloudscape-design/components';
import {
  uploadWordTemplate,
  getWordTemplateConfig,
  updateWordTemplateConfig,
  validateDocxFile,
  SUPPORTED_LANGUAGES,
  type WordTemplateConfigResponse,
} from '../services/wordTemplateService';
import type { PlaceholderConfig } from '@meeting-platform/shared';

/**
 * Props for WordTemplateSettings component
 */
export interface WordTemplateSettingsProps {
  /** Callback when template is successfully uploaded */
  onTemplateUploaded?: () => void;
}

/**
 * WordTemplateSettings component for managing Word template configuration
 */
export const WordTemplateSettings: React.FC<WordTemplateSettingsProps> = ({
  onTemplateUploaded,
}) => {
  // Template config state
  const [config, setConfig] = useState<WordTemplateConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [templateName, setTemplateName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Language selection state
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguage, setTargetLanguage] = useState('es');

  // Placeholder settings state
  const [placeholders, setPlaceholders] = useState<PlaceholderConfig[]>([]);
  const [savingPlaceholders, setSavingPlaceholders] = useState(false);
  const [hasPlaceholderChanges, setHasPlaceholderChanges] = useState(false);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getWordTemplateConfig();
      setConfig(data);
      
      if (data) {
        setSourceLanguage(data.sourceLanguage);
        setTargetLanguage(data.targetLanguage);
        setPlaceholders(data.placeholders);
        setTemplateName(data.templateName);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load Word template configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = validateDocxFile(file);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid file');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setError(null);
    
    // Auto-fill template name from filename if empty
    if (!templateName) {
      const nameWithoutExt = file.name.replace(/\.docx$/i, '');
      setTemplateName(nameWithoutExt);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(10);
      setError(null);
      setSuccess(null);

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await uploadWordTemplate(
        selectedFile,
        templateName || selectedFile.name.replace(/\.docx$/i, ''),
        sourceLanguage,
        targetLanguage
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Update local state with new placeholders
      const newPlaceholders: PlaceholderConfig[] = response.placeholders.map((name) => ({
        name,
        translateEnabled: false,
      }));
      setPlaceholders(newPlaceholders);

      setSuccess(`Template uploaded successfully! Found ${response.placeholders.length} placeholder(s).`);
      setSelectedFile(null);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Reload config to get full data
      await loadConfig();
      
      onTemplateUploaded?.();

      // Clear success after 5 seconds
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to upload template');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleLanguageChange = async (
    type: 'source' | 'target',
    value: string
  ) => {
    try {
      setError(null);
      
      if (type === 'source') {
        setSourceLanguage(value);
        await updateWordTemplateConfig({ sourceLanguage: value });
      } else {
        setTargetLanguage(value);
        await updateWordTemplateConfig({ targetLanguage: value });
      }
      
      setSuccess('Language settings updated');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update language settings');
      // Revert on error
      if (type === 'source') {
        setSourceLanguage(config?.sourceLanguage || 'en');
      } else {
        setTargetLanguage(config?.targetLanguage || 'es');
      }
    }
  };

  const handlePlaceholderToggle = (placeholderName: string, enabled: boolean) => {
    setPlaceholders((prev) =>
      prev.map((p) =>
        p.name === placeholderName ? { ...p, translateEnabled: enabled } : p
      )
    );
    setHasPlaceholderChanges(true);
  };

  const handleSavePlaceholders = async () => {
    try {
      setSavingPlaceholders(true);
      setError(null);
      
      await updateWordTemplateConfig({ placeholders });
      
      setHasPlaceholderChanges(false);
      setSuccess('Placeholder settings saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save placeholder settings');
    } finally {
      setSavingPlaceholders(false);
    }
  };

  const languageOptions = SUPPORTED_LANGUAGES.map((lang) => ({
    label: lang.name,
    value: lang.code,
  }));

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding={{ vertical: 'l' }}>
          <Spinner size="large" />
        </Box>
      </Container>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Upload a Word template with {{placeholder}} markers for bilingual report generation."
        >
          Word Template Settings
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert type="success" dismissible onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {/* File Upload Section */}
        <SpaceBetween size="m">
          <FormField
            label="Template File"
            description="Upload a .docx file with {{placeholder_name}} markers"
          >
            <SpaceBetween size="xs" direction="horizontal">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="word-template-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                iconName="upload"
              >
                Choose File
              </Button>
              {selectedFile && (
                <Box variant="span" color="text-body-secondary">
                  <Icon name="file" /> {selectedFile.name}
                </Box>
              )}
            </SpaceBetween>
          </FormField>

          <FormField label="Template Name">
            <Input
              value={templateName}
              onChange={({ detail }) => setTemplateName(detail.value)}
              placeholder="e.g., Board Meeting Report"
              disabled={uploading}
            />
          </FormField>

          {uploading && (
            <ProgressBar
              value={uploadProgress}
              label="Uploading template..."
              description="Please wait while your template is being processed"
            />
          )}

          {selectedFile && !uploading && (
            <Button
              variant="primary"
              onClick={handleUpload}
              loading={uploading}
            >
              Upload Template
            </Button>
          )}
        </SpaceBetween>

        {/* Current Template Info */}
        {config && (
          <>
            <Box variant="h3">Current Template</Box>
            <ColumnLayout columns={2}>
              <Box>
                <Box variant="awsui-key-label">Template Name</Box>
                <Box>{config.templateName}</Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Last Updated</Box>
                <Box>{new Date(config.updatedAt).toLocaleString()}</Box>
              </Box>
            </ColumnLayout>
          </>
        )}

        {/* Language Selection Section */}
        {config && (
          <>
            <Box variant="h3">Translation Languages</Box>
            <ColumnLayout columns={2}>
              <FormField
                label="Source Language"
                description="Language of the original meeting content"
              >
                <Select
                  selectedOption={
                    languageOptions.find((o) => o.value === sourceLanguage) || null
                  }
                  onChange={({ detail }) =>
                    handleLanguageChange('source', detail.selectedOption.value!)
                  }
                  options={languageOptions}
                  placeholder="Select source language"
                />
              </FormField>

              <FormField
                label="Target Language"
                description="Language to translate content into"
              >
                <Select
                  selectedOption={
                    languageOptions.find((o) => o.value === targetLanguage) || null
                  }
                  onChange={({ detail }) =>
                    handleLanguageChange('target', detail.selectedOption.value!)
                  }
                  options={languageOptions}
                  placeholder="Select target language"
                />
              </FormField>
            </ColumnLayout>
          </>
        )}

        {/* Placeholder Translation Toggles */}
        {config && placeholders.length > 0 && (
          <>
            <Box variant="h3">Placeholder Translation Settings</Box>
            <Box variant="p" color="text-body-secondary">
              Enable translation for content-heavy placeholders. Metadata like names and dates typically don't need translation.
            </Box>
            
            <Table
              columnDefinitions={[
                {
                  id: 'name',
                  header: 'Placeholder',
                  cell: (item) => <code>{`{{${item.name}}}`}</code>,
                  width: 250,
                },
                {
                  id: 'translate',
                  header: 'Enable Translation',
                  cell: (item) => (
                    <Toggle
                      checked={item.translateEnabled}
                      onChange={({ detail }) =>
                        handlePlaceholderToggle(item.name, detail.checked)
                      }
                    >
                      {item.translateEnabled ? 'Enabled' : 'Disabled'}
                    </Toggle>
                  ),
                },
                {
                  id: 'translated',
                  header: 'Translated Placeholder',
                  cell: (item) =>
                    item.translateEnabled ? (
                      <code>{`{{${item.name}_translated}}`}</code>
                    ) : (
                      <Box color="text-status-inactive">—</Box>
                    ),
                },
              ]}
              items={placeholders}
              variant="embedded"
              stripedRows
            />

            <Box float="right">
              <Button
                variant="primary"
                onClick={handleSavePlaceholders}
                disabled={!hasPlaceholderChanges || savingPlaceholders}
                loading={savingPlaceholders}
              >
                Save Placeholder Settings
              </Button>
            </Box>
          </>
        )}

        {/* No Template Message */}
        {!config && !loading && (
          <Alert type="info">
            No Word template configured. Upload a .docx template to enable bilingual report generation.
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );
};

export default WordTemplateSettings;
