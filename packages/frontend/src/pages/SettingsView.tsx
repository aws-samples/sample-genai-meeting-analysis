import { useState, useEffect } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  FormField,
  Textarea,
  Select,
  Button,
  Alert,
  Spinner,
  Box,
  ColumnLayout,
  Input,
} from '@cloudscape-design/components';
import { Layout, WordTemplateSettings } from '../components';
import {
  getUserSettings,
  updateUserSettings,
  getDefaultPromptTemplate,
  getDefaultReportTemplate,
  getReportTemplate,
  saveReportTemplate,
  validateReportTemplate,
  AVAILABLE_MODELS,
  type UserSettings,
} from '../services/settingsService';
import { ReportTemplate } from '@meeting-platform/shared';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [modelId, setModelId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Report template state
  const [reportTemplate, setReportTemplate] = useState<ReportTemplate | null>(null);
  const [reportTemplateContent, setReportTemplateContent] = useState('');
  const [reportTemplateName, setReportTemplateName] = useState('');
  const [reportTemplateLoading, setReportTemplateLoading] = useState(true);
  const [reportTemplateSaving, setReportTemplateSaving] = useState(false);
  const [reportTemplateError, setReportTemplateError] = useState<string | null>(null);
  const [reportTemplateSuccess, setReportTemplateSuccess] = useState(false);
  const [reportTemplateHasChanges, setReportTemplateHasChanges] = useState(false);
  const [reportTemplateValidationErrors, setReportTemplateValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    
    const load = async () => {
      if (!cancelled) {
        await loadSettings();
        await loadReportTemplate();
      }
    };
    
    load();
    
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUserSettings();
      setSettings(data);
      setPromptTemplate(data.promptTemplate);
      setModelId(data.modelId);
      setTemplateName(data.templateName);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const loadReportTemplate = async () => {
    try {
      setReportTemplateLoading(true);
      setReportTemplateError(null);
      console.log('Loading report template...');
      const template = await getReportTemplate();
      console.log('Report template loaded:', template);
      setReportTemplate(template);
      setReportTemplateContent(template.templateContent);
      setReportTemplateName(template.templateName);
      setReportTemplateHasChanges(false);
      setReportTemplateValidationErrors([]);
    } catch (err: any) {
      console.error('Failed to load report template:', err);
      setReportTemplateError(err.message || 'Failed to load report template');
    } finally {
      setReportTemplateLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      // Validate prompt template contains {{transcript}}
      if (!promptTemplate.includes('{{transcript}}')) {
        setError('Prompt template must contain {{transcript}} placeholder');
        return;
      }

      await updateUserSettings({
        promptTemplate,
        modelId,
        templateName: templateName || 'Custom Template',
      });

      setSuccess(true);
      setHasChanges(false);
      
      // Reload settings to get updated timestamp
      await loadSettings();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const defaultPrompt = getDefaultPromptTemplate();
    setPromptTemplate(defaultPrompt);
    setModelId('amazon.nova-pro-v1:0');
    setTemplateName('Default Template');
    setHasChanges(true);
  };

  const handleReportTemplateChange = (value: string) => {
    setReportTemplateContent(value);
    setReportTemplateHasChanges(true);
    
    // Validate on change
    const validation = validateReportTemplate(value);
    setReportTemplateValidationErrors(validation.errors);
  };

  const handleSaveReportTemplate = async () => {
    try {
      setReportTemplateSaving(true);
      setReportTemplateError(null);
      setReportTemplateSuccess(false);
      setReportTemplateValidationErrors([]);

      const response = await saveReportTemplate({
        templateName: reportTemplateName || 'Custom Report Template',
        templateContent: reportTemplateContent,
      });

      if (response.validationErrors && response.validationErrors.length > 0) {
        setReportTemplateValidationErrors(response.validationErrors);
        setReportTemplateError('Template validation failed. Please fix the errors below.');
        return;
      }

      setReportTemplateSuccess(true);
      setReportTemplateHasChanges(false);
      
      // Reload template to get updated timestamp
      await loadReportTemplate();

      // Clear success message after 3 seconds
      setTimeout(() => setReportTemplateSuccess(false), 3000);
    } catch (err: any) {
      setReportTemplateError(err.message || 'Failed to save report template');
    } finally {
      setReportTemplateSaving(false);
    }
  };

  const handleResetReportTemplate = () => {
    const defaultTemplate = getDefaultReportTemplate();
    setReportTemplateContent(defaultTemplate);
    setReportTemplateName('Default Template');
    setReportTemplateHasChanges(true);
    setReportTemplateValidationErrors([]);
  };

  if (loading) {
    return (
      <Layout>
        <Box textAlign="center" padding={{ vertical: 'xxl' }}>
          <Spinner size="large" />
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Configure your analysis preferences. These settings will be used for all future meeting analyses."
        >
          Settings
        </Header>

        {error && (
          <Alert
            type="error"
            dismissible
            onDismiss={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {success && (
          <Alert
            type="success"
            dismissible
            onDismiss={() => setSuccess(false)}
          >
            Settings saved successfully!
          </Alert>
        )}

        <Container
          header={
            <Header
              variant="h2"
              description="Choose the AI model to use for generating meeting analyses."
            >
              AI Model Selection
            </Header>
          }
        >
          <FormField label="AI Model">
            <Select
              selectedOption={
                AVAILABLE_MODELS.find((m) => m.id === modelId)
                  ? {
                      label: AVAILABLE_MODELS.find((m) => m.id === modelId)!.name,
                      value: modelId,
                      description: AVAILABLE_MODELS.find((m) => m.id === modelId)!.description,
                    }
                  : null
              }
              onChange={({ detail }) => {
                setModelId(detail.selectedOption.value!);
                setHasChanges(true);
              }}
              options={AVAILABLE_MODELS.map((model) => ({
                label: model.name,
                value: model.id,
                description: model.description,
              }))}
              placeholder="Select an AI model"
            />
          </FormField>
        </Container>

        <Container
          header={
            <Header
              variant="h2"
              description="Customize the template used to generate structured meeting reports. Use {{placeholder_name}} format for placeholders that will be filled from the transcript."
            >
              Report Template
            </Header>
          }
        >
          {reportTemplateLoading ? (
            <Box textAlign="center" padding={{ vertical: 'l' }}>
              <Spinner size="large" />
            </Box>
          ) : (
          <SpaceBetween size="l">
            {reportTemplateError && (
              <Alert
                type="error"
                dismissible
                onDismiss={() => setReportTemplateError(null)}
              >
                {reportTemplateError}
              </Alert>
            )}

            {reportTemplateSuccess && (
              <Alert
                type="success"
                dismissible
                onDismiss={() => setReportTemplateSuccess(false)}
              >
                Report template saved successfully!
              </Alert>
            )}

            {reportTemplateValidationErrors.length > 0 && (
              <Alert type="error" header="Validation Errors">
                <SpaceBetween size="xs">
                  {reportTemplateValidationErrors.map((error, index) => (
                    <Box key={index} variant="p">
                      • {error}
                    </Box>
                  ))}
                </SpaceBetween>
              </Alert>
            )}

            <FormField label="Template Name">
              <Input
                value={reportTemplateName}
                onChange={({ detail }) => {
                  setReportTemplateName(detail.value);
                  setReportTemplateHasChanges(true);
                }}
                placeholder="e.g., Board Meeting Report"
              />
            </FormField>

            <FormField
              label="Report Template"
              description="Use {{placeholder_name}} for values to extract from transcript. Use {{agenda_points}} for agenda items and decisions."
            >
              <Textarea
                value={reportTemplateContent}
                onChange={({ detail }) => handleReportTemplateChange(detail.value)}
                rows={20}
                placeholder="Enter your custom report template..."
              />
            </FormField>

            <ColumnLayout columns={2}>
              <Box float="left">
                {reportTemplate?.updatedAt && (
                  <Box variant="small" color="text-body-secondary">
                    Last updated: {new Date(reportTemplate.updatedAt).toLocaleString()}
                  </Box>
                )}
              </Box>
              <Box float="right">
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    onClick={handleResetReportTemplate}
                    disabled={reportTemplateSaving}
                  >
                    Reset to Default
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveReportTemplate}
                    disabled={
                      reportTemplateSaving || 
                      !reportTemplateHasChanges || 
                      reportTemplateValidationErrors.length > 0
                    }
                    loading={reportTemplateSaving}
                  >
                    Save Template
                  </Button>
                </SpaceBetween>
              </Box>
            </ColumnLayout>
          </SpaceBetween>
          )}
        </Container>

        {/* Word Template Settings - right after Report Template */}
        <WordTemplateSettings />

        <Container
          header={
            <Header
              variant="h2"
              description="Customize the prompt used to generate meeting analyses. Use {{transcript}} as a placeholder for the meeting transcript."
            >
              Analysis Prompt Template
            </Header>
          }
        >
          <SpaceBetween size="l">
            <FormField label="Template Name">
              <Input
                value={templateName}
                onChange={({ detail }) => {
                  setTemplateName(detail.value);
                  setHasChanges(true);
                }}
                placeholder="e.g., Board Meeting Analysis"
              />
            </FormField>

            <FormField
              label="Prompt Template"
              description="Must include {{transcript}} placeholder"
            >
              <Textarea
                value={promptTemplate}
                onChange={({ detail }) => {
                  setPromptTemplate(detail.value);
                  setHasChanges(true);
                }}
                rows={16}
                placeholder="Enter your custom prompt template..."
              />
            </FormField>

            <ColumnLayout columns={2}>
              <Box float="left">
                {settings?.updatedAt && (
                  <Box variant="small" color="text-body-secondary">
                    Last updated: {new Date(settings.updatedAt).toLocaleString()}
                  </Box>
                )}
              </Box>
              <Box float="right">
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    onClick={handleReset}
                    disabled={saving}
                  >
                    Reset to Default
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                    loading={saving}
                  >
                    Save Settings
                  </Button>
                </SpaceBetween>
              </Box>
            </ColumnLayout>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </Layout>
  );
};
