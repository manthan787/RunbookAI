/**
 * Investigate Incident Skill
 *
 * A hypothesis-driven investigation workflow for incidents.
 */

import type { SkillDefinition } from '../types';

export const investigateIncidentSkill: SkillDefinition = {
  id: 'investigate-incident',
  name: 'Investigate Incident',
  description: 'Perform a hypothesis-driven investigation of an incident using the Bits AI methodology',
  version: '1.0.0',
  tags: ['incident', 'investigation', 'debugging'],
  riskLevel: 'low',

  parameters: [
    {
      name: 'incident_id',
      description: 'PagerDuty or OpsGenie incident ID',
      type: 'string',
      required: true,
    },
    {
      name: 'service',
      description: 'Primary service affected (optional, will be detected from incident)',
      type: 'string',
      required: false,
    },
    {
      name: 'time_range_minutes',
      description: 'How far back to look for related events',
      type: 'number',
      required: false,
      default: 60,
    },
  ],

  steps: [
    {
      id: 'fetch_incident',
      name: 'Fetch Incident Details',
      description: 'Get incident details from PagerDuty/OpsGenie',
      action: 'pagerduty_get_incident',
      parameters: {
        incident_id: '{{incident_id}}',
      },
      onError: 'abort',
    },
    {
      id: 'search_runbooks',
      name: 'Search Knowledge Base',
      description: 'Look for relevant runbooks and past incidents',
      action: 'search_knowledge',
      parameters: {
        query: '{{steps.fetch_incident.result.incident.title}}',
        type_filter: ['runbook', 'postmortem', 'known_issue'],
      },
      onError: 'continue',
    },
    {
      id: 'check_alarms',
      name: 'Check CloudWatch Alarms',
      description: 'Get current alarm status',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'ALARM',
      },
      onError: 'continue',
    },
    {
      id: 'check_datadog',
      name: 'Check Datadog Monitors',
      description: 'Get triggered Datadog monitors',
      action: 'datadog',
      parameters: {
        action: 'monitors',
      },
      onError: 'continue',
    },
    {
      id: 'query_infrastructure',
      name: 'Query Infrastructure State',
      description: 'Get current state of affected services',
      action: 'aws_query',
      parameters: {
        query: 'Get status of services related to {{steps.fetch_incident.result.incident.service}}',
        services: ['ecs', 'lambda', 'rds'],
      },
      onError: 'continue',
    },
    {
      id: 'search_logs',
      name: 'Search for Errors in Logs',
      description: 'Look for error patterns in CloudWatch logs',
      action: 'cloudwatch_logs',
      parameters: {
        log_group: '/aws/{{steps.fetch_incident.result.incident.service}}',
        filter_pattern: 'ERROR Exception timeout',
        minutes_back: '{{time_range_minutes}}',
      },
      onError: 'continue',
    },
    {
      id: 'form_hypothesis',
      name: 'Form Hypotheses',
      description: 'Based on gathered evidence, form initial hypotheses about root cause',
      action: 'prompt',
      parameters: {
        instruction: `Based on the evidence gathered:
- Incident: {{steps.fetch_incident.result}}
- Alarms: {{steps.check_alarms.result}}
- Logs: {{steps.search_logs.result}}
- Infrastructure: {{steps.query_infrastructure.result}}

Form 3-5 hypotheses about the root cause. For each hypothesis:
1. State the hypothesis clearly
2. Assign initial confidence (low/medium/high)
3. List what evidence would confirm or refute it
4. Suggest next investigation steps`,
      },
    },
    {
      id: 'summarize',
      name: 'Create Investigation Summary',
      description: 'Summarize findings and recommended actions',
      action: 'prompt',
      parameters: {
        instruction: `Create a concise investigation summary including:
1. Incident overview
2. Key findings
3. Most likely root cause(s)
4. Recommended immediate actions
5. Suggested remediation steps`,
      },
    },
  ],
};
