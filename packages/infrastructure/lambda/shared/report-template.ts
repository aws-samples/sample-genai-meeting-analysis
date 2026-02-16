/**
 * Default report template definition
 * This is the single source of truth for the default meeting report template
 */
export function getDefaultReportTemplate(): string {
  return `# Meeting Report

## Meeting Information
- **Date**: {{meeting_date}}
- **Location**: {{meeting_location}}
- **Participants**: {{participants}}
- **Company**: {{company_name}}

## Agenda and Decisions

{{agenda_points}}

## Summary
{{meeting_summary}}

## Next Steps
{{next_steps}}
`;
}
