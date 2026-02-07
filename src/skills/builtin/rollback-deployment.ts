/**
 * Rollback Deployment Skill
 *
 * Safely rollback a service to a previous version.
 */

import type { SkillDefinition } from '../types';

export const rollbackDeploymentSkill: SkillDefinition = {
  id: 'rollback-deployment',
  name: 'Rollback Deployment',
  description: 'Rollback a service to a previous version quickly and safely',
  version: '1.0.0',
  tags: ['rollback', 'deployment', 'recovery'],
  applicableServices: ['ecs', 'lambda', 'amplify'],
  riskLevel: 'high',

  parameters: [
    {
      name: 'service_type',
      description: 'Type of service to rollback',
      type: 'string',
      required: true,
      enum: ['ecs', 'lambda', 'amplify'],
    },
    {
      name: 'service_name',
      description: 'Name of the service to rollback',
      type: 'string',
      required: true,
    },
    {
      name: 'cluster',
      description: 'ECS cluster name (for ECS services)',
      type: 'string',
      required: false,
    },
    {
      name: 'target_version',
      description: 'Specific version to rollback to (optional, defaults to previous)',
      type: 'string',
      required: false,
    },
    {
      name: 'reason',
      description: 'Reason for rollback',
      type: 'string',
      required: true,
    },
  ],

  steps: [
    {
      id: 'get_current_state',
      name: 'Get Current State',
      description: 'Document current state before rollback',
      action: 'aws_query',
      parameters: {
        query: 'Get current version and state of {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'abort',
    },
    {
      id: 'check_severity',
      name: 'Assess Situation',
      description: 'Determine urgency and impact',
      action: 'prompt',
      parameters: {
        instruction: `Assess the rollback situation:
- Service: {{service_name}}
- Current state: {{steps.get_current_state.result}}
- Reason: {{reason}}

Determine:
1. Severity level (P1/P2/P3)
2. Customer impact
3. Is immediate rollback necessary?
4. Any risks with rollback?`,
      },
    },
    {
      id: 'search_rollback_runbook',
      name: 'Find Rollback Procedure',
      description: 'Look for service-specific rollback instructions',
      action: 'search_knowledge',
      parameters: {
        query: 'rollback {{service_name}} procedure',
        type_filter: ['runbook'],
      },
      onError: 'continue',
    },
    {
      id: 'execute_rollback',
      name: 'Execute Rollback',
      description: 'Perform the rollback',
      action: 'aws_mutate',
      requiresApproval: true,
      parameters: {
        operation: '{{service_type}}:UpdateService',
        resource: '{{service_name}}',
        parameters: {
          cluster: '{{cluster}}',
          forceNewDeployment: true,
          taskDefinition: '{{target_version}}',
        },
        description: 'ROLLBACK: {{service_name}} - {{reason}}',
        rollbackCommand: 'Deploy forward to newer version',
        estimatedImpact: 'Service will rollback to previous version, may take 5-10 minutes',
      },
      onError: 'abort',
    },
    {
      id: 'verify_rollback',
      name: 'Verify Rollback',
      description: 'Confirm rollback completed successfully',
      action: 'aws_query',
      parameters: {
        query: 'Get current status of {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'continue',
    },
    {
      id: 'health_check',
      name: 'Health Check',
      description: 'Verify service is healthy after rollback',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'ALARM',
      },
      onError: 'continue',
    },
    {
      id: 'check_logs',
      name: 'Check for New Errors',
      description: 'Verify no new errors after rollback',
      action: 'cloudwatch_logs',
      parameters: {
        log_group: '/aws/{{service_type}}/{{service_name}}',
        filter_pattern: 'ERROR Exception',
        minutes_back: 5,
      },
      onError: 'continue',
    },
    {
      id: 'notify_stakeholders',
      name: 'Create Notification',
      description: 'Prepare notification for stakeholders',
      action: 'prompt',
      parameters: {
        instruction: `Create a rollback notification:

## Rollback Notification

**Service:** {{service_name}}
**Time:** [current time]
**Reason:** {{reason}}

**Previous Version:** {{steps.get_current_state.result.version}}
**Rolled Back To:** {{steps.verify_rollback.result.version}}

**Status:** {{steps.health_check.result}}

**Next Steps:**
- Investigate root cause of issue
- Prepare fix for forward deployment
- Schedule post-mortem if needed`,
      },
    },
    {
      id: 'summarize',
      name: 'Rollback Summary',
      description: 'Final summary of rollback operation',
      action: 'prompt',
      parameters: {
        instruction: `Summarize the rollback:
- Was rollback successful?
- Current service state
- Any remaining issues
- Recommended follow-up actions
- Timeline for fix and re-deployment`,
      },
    },
  ],
};
