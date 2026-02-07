/**
 * Troubleshoot Service Skill
 *
 * General troubleshooting workflow for service issues.
 */

import type { SkillDefinition } from '../types';

export const troubleshootServiceSkill: SkillDefinition = {
  id: 'troubleshoot-service',
  name: 'Troubleshoot Service',
  description: 'Diagnose and troubleshoot issues with a service',
  version: '1.0.0',
  tags: ['troubleshooting', 'debugging', 'diagnostics'],
  riskLevel: 'low',

  parameters: [
    {
      name: 'service_name',
      description: 'Name of the service to troubleshoot',
      type: 'string',
      required: true,
    },
    {
      name: 'symptom',
      description: 'Description of the problem or symptom',
      type: 'string',
      required: true,
    },
    {
      name: 'service_type',
      description: 'Type of service (ecs, lambda, ec2, etc.)',
      type: 'string',
      required: false,
    },
    {
      name: 'time_range_minutes',
      description: 'How far back to look for issues',
      type: 'number',
      required: false,
      default: 30,
    },
  ],

  steps: [
    {
      id: 'search_known_issues',
      name: 'Search Known Issues',
      description: 'Check if this is a known issue with documented solution',
      action: 'search_knowledge',
      parameters: {
        query: '{{symptom}} {{service_name}}',
        type_filter: ['known_issue', 'runbook', 'postmortem'],
      },
      onError: 'continue',
    },
    {
      id: 'get_service_state',
      name: 'Get Service State',
      description: 'Check current service status and configuration',
      action: 'aws_query',
      parameters: {
        query: 'Get status and details of {{service_name}}',
        services: ['ecs', 'lambda', 'ec2', 'rds'],
      },
      onError: 'continue',
    },
    {
      id: 'check_alarms',
      name: 'Check CloudWatch Alarms',
      description: 'Look for related alarms',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'all',
      },
      onError: 'continue',
    },
    {
      id: 'search_error_logs',
      name: 'Search Error Logs',
      description: 'Look for errors in CloudWatch logs',
      action: 'cloudwatch_logs',
      parameters: {
        log_group: '/aws/{{service_type}}/{{service_name}}',
        filter_pattern: 'ERROR Exception timeout failed',
        minutes_back: '{{time_range_minutes}}',
      },
      onError: 'continue',
    },
    {
      id: 'check_datadog_logs',
      name: 'Check Datadog Logs',
      description: 'Search Datadog for related logs',
      action: 'datadog',
      parameters: {
        action: 'logs',
        query: 'service:{{service_name}} status:error',
        from_minutes: '{{time_range_minutes}}',
        limit: 20,
      },
      onError: 'continue',
    },
    {
      id: 'check_traces',
      name: 'Check APM Traces',
      description: 'Look for slow or failed traces',
      action: 'datadog',
      parameters: {
        action: 'traces',
        service: '{{service_name}}',
        query: 'status:error OR @duration:>1000000000',
        from_minutes: '{{time_range_minutes}}',
        limit: 10,
      },
      onError: 'continue',
    },
    {
      id: 'check_recent_changes',
      name: 'Check Recent Changes',
      description: 'Look for recent deployments or changes',
      action: 'datadog',
      parameters: {
        action: 'events',
        from_minutes: '{{time_range_minutes}}',
      },
      onError: 'continue',
    },
    {
      id: 'analyze_findings',
      name: 'Analyze Findings',
      description: 'Correlate all findings and identify root cause',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the troubleshooting data:

Symptom: {{symptom}}
Service: {{service_name}}

Evidence collected:
- Known issues: {{steps.search_known_issues.result}}
- Service state: {{steps.get_service_state.result}}
- Alarms: {{steps.check_alarms.result}}
- Error logs: {{steps.search_error_logs.result}}
- Datadog logs: {{steps.check_datadog_logs.result}}
- APM traces: {{steps.check_traces.result}}
- Recent changes: {{steps.check_recent_changes.result}}

Provide:
1. Most likely root cause
2. Contributing factors
3. Timeline of events
4. Immediate actions to resolve
5. Long-term fixes to prevent recurrence`,
      },
    },
    {
      id: 'generate_report',
      name: 'Generate Troubleshooting Report',
      description: 'Create a summary report',
      action: 'prompt',
      parameters: {
        instruction: `Create a troubleshooting report with:

## Summary
Brief description of the issue and resolution

## Timeline
Key events leading to and during the issue

## Root Cause
What caused the problem

## Resolution
Steps taken or recommended to fix

## Prevention
How to prevent this in the future

## Metrics to Monitor
Key metrics to watch going forward`,
      },
    },
  ],
};
