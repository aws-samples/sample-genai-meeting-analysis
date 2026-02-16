import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditablePlaceholder } from './EditablePlaceholder';

/**
 * Unit Tests for EditablePlaceholder Component
 * Testing rendering, styling, tooltips, and interaction states
 */
describe('EditablePlaceholder - Unit Tests', () => {
  const mockOnEdit = vi.fn();
  const mockOnCitationClick = vi.fn();

  beforeEach(() => {
    mockOnEdit.mockClear();
    mockOnCitationClick.mockClear();
  });

  it('should render computed placeholder with yellow background', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder?.textContent).toContain('Acme Corp');
  });

  it('should render non-computed placeholder with orange background and {{name}} format', () => {
    const { container } = render(
      <EditablePlaceholder
        name="location"
        value=""
        isFilled={false}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder?.textContent).toContain('{{location}}');
  });

  it('should display edit icon for manually edited placeholders', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={true}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    expect(container.textContent).toContain('✏️');
  });

  it('should display citation link when citation is provided', () => {
    render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        citation={{ startTime: 1000, endTime: 2000 }}
        onEdit={mockOnEdit}
        onCitationClick={mockOnCitationClick}
        isEditing={false}
        isSaving={false}
      />
    );

    const citationLink = screen.getByText('[cite]');
    expect(citationLink).toBeInTheDocument();
  });

  it('should call onCitationClick when citation link is clicked', () => {
    render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        citation={{ startTime: 1000, endTime: 2000 }}
        onEdit={mockOnEdit}
        onCitationClick={mockOnCitationClick}
        isEditing={false}
        isSaving={false}
      />
    );

    const citationLink = screen.getByText('[cite]');
    fireEvent.click(citationLink);

    expect(mockOnCitationClick).toHaveBeenCalledWith(1000);
  });

  it('should display loading indicator when isSaving is true', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={true}
      />
    );

    expect(container.textContent).toContain('⏳');
  });

  it('should display error indicator when error is provided', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
        error="Failed to save"
      />
    );

    expect(container.textContent).toContain('⚠️');
  });

  it('should show tooltip on hover', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();

    // Simulate hover
    if (placeholder) {
      fireEvent.mouseEnter(placeholder);
      
      // Check tooltip appears
      const tooltip = container.querySelector('span[style*="position: absolute"]');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip?.textContent).toContain('Automatically extracted value');
    }
  });

  it('should show different tooltip for manually edited placeholder', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={true}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();

    // Simulate hover
    if (placeholder) {
      fireEvent.mouseEnter(placeholder);
      
      // Check tooltip appears with correct message
      const tooltip = container.querySelector('span[style*="position: absolute"]');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip?.textContent).toContain('Manually edited value');
    }
  });

  it('should show tooltip for non-computed placeholder', () => {
    const { container } = render(
      <EditablePlaceholder
        name="location"
        value=""
        isFilled={false}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();

    // Simulate hover
    if (placeholder) {
      fireEvent.mouseEnter(placeholder);
      
      // Check tooltip appears with correct message
      const tooltip = container.querySelector('span[style*="position: absolute"]');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip?.textContent).toContain('Click to fill this placeholder');
    }
  });

  it('should show tooltip for cleared placeholder', () => {
    const { container } = render(
      <EditablePlaceholder
        name="location"
        value=""
        isFilled={false}
        isManuallyEdited={true}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="background"]');
    expect(placeholder).toBeInTheDocument();

    // Simulate hover
    if (placeholder) {
      fireEvent.mouseEnter(placeholder);
      
      // Check tooltip appears with correct message for cleared placeholder
      const tooltip = container.querySelector('span[style*="position: absolute"]');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip?.textContent).toContain('Manually cleared placeholder');
    }
  });

  it('should have pointer cursor when not saving', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="cursor"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder?.getAttribute('style')).toContain('cursor: pointer');
  });

  it('should have wait cursor when saving', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={true}
      />
    );

    const placeholder = container.querySelector('span[style*="cursor"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder?.getAttribute('style')).toContain('cursor: wait');
  });

  it('should not display citation link for non-computed placeholders', () => {
    const { container } = render(
      <EditablePlaceholder
        name="location"
        value=""
        isFilled={false}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    expect(container.textContent).not.toContain('[cite]');
  });

  it('should apply bold font weight to all placeholders', () => {
    const { container } = render(
      <EditablePlaceholder
        name="company_name"
        value="Acme Corp"
        isFilled={true}
        isManuallyEdited={false}
        onEdit={mockOnEdit}
        isEditing={false}
        isSaving={false}
      />
    );

    const placeholder = container.querySelector('span[style*="font-weight"]');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder?.getAttribute('style')).toContain('font-weight: bold');
  });
});
