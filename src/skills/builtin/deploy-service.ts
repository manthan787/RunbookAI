/**
 * Deploy Service Skill
 *
 * Safe deployment workflow with pre-checks and rollback capability.
 */

import type { SkillDefinition } from '../types';

export const deployServiceSkill: SkillDefinition = {
  id: 'deploy-service',
  name: 'Deploy Service',
  description: 'Deploy a new version of a service with safety checks and rollback capability',
  version: '1.0.0',
  tags: ['deployment', 'release', 'ecs', 'lambda'],
  applicableServices: ['ecs', 'lambda', 'amplify'],
  riskLevel: 'high',

  parameters: [
    {
      name: 'service_type',
      description: 'Type of service to deploy',
      type: 'string',
      required: true,
      enum: ['ecs', 'lambda', 'amplify'],
    },
    {
      name: 'service_name',
      description: 'Name of the service to deploy',
      type: 'string',
      required: true,
    },
    {
      name: 'cluster',
      description: 'ECS cluster name (for ECS deployments)',
      type: 'string',
      required: false,
    },
    {
      name: 'image',
      description: 'New container image or Lambda package (e.g., repo:tag)',
      type: 'string',
      required: false,
    },
    {
      name: 'force_new_deployment',
      description: 'Force new deployment even if no changes',
      type: 'boolean',
      required: false,
      default: false,
    },
    {
      name: 'canary_percent',
      description: 'Percentage for canary deployment (0 = full deployment)',
      type: 'number',
      required: false,
      default: 0,
    },
  ],

  steps: [
    {
      id: 'pre_check_state',
      name: 'Pre-Deployment Check',
      description: 'Capture current state for rollback',
      action: 'aws_query',
      parameters: {
        query: 'Get full details of {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'abort',
    },
    {
      id: 'check_active_incidents',
      name: 'Check for Active Incidents',
      description: 'Ensure no active incidents before deploying',
      action: 'pagerduty_list_incidents',
      parameters: {
        status: 'active',
        limit: 5,
      },
      onError: 'continue',
    },
    {
      id: 'check_alarms',
      name: 'Check CloudWatch Alarms',
      description: 'Ensure no critical alarms',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'ALARM',
      },
      onError: 'continue',
    },
    {
      id: 'search_runbooks',
      name: 'Find Deployment Runbook',
      description: 'Look for service-specific deployment instructions',
      action: 'search_knowledge',
      parameters: {
        query: 'deployment {{service_name}} procedure',
        type_filter: ['runbook'],
      },
      onError: 'continue',
    },
    {
      id: 'analyze_deployment',
      name: 'Analyze Deployment Safety',
      description: 'Determine if deployment is safe to proceed',
      action: 'prompt',
      parameters: {
        instruction: `Analyze deployment readiness:
- Current state: {{steps.pre_check_state.result}}
- Active incidents: {{steps.check_active_incidents.result}}
- Active alarms: {{steps.check_alarms.result}}
- Deployment runbook: {{steps.search_runbooks.result}}

Determine:
1. Is it safe to deploy now?
2. Any blocking issues?
3. Recommended deployment strategy
4. Key metrics to watch during deployment`,
      },
    },
    {
      id: 'execute_deployment',
      name: 'Execute Deployment',
      description: 'Trigger the deployment',
      action: 'aws_mutate',
      requiresApproval: true,
      parameters: {
        operation: '{{service_type}}:UpdateService',
        resource: '{{service_name}}',
        parameters: {
          cluster: '{{cluster}}',
          forceNewDeployment: '{{force_new_deployment}}',
        },
        description: 'Deploy new version of {{service_name}}',
        rollbackCommand: 'Rollback to previous task definition: {{steps.pre_check_state.result.taskDefinition}}',
        estimatedImpact: 'Service will perform rolling update, may take 5-10 minutes',
      },
      onError: 'abort',
    },
    {
      id: 'monitor_deployment',
      name: 'Monitor Deployment Progress',
      description: 'Watch deployment progress and health',
      action: 'aws_query',
      parameters: {
        query: 'Get deployment status for {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'continue',
    },
    {
      id: 'post_deploy_health',
      name: 'Post-Deployment Health Check',
      description: 'Verify service is healthy after deployment',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'all',
      },
      onError: 'continue',
    },
    {
      id: 'check_logs',
      name: 'Check for Errors in Logs',
      description: 'Look for new errors after deployment',
      action: 'cloudwatch_logs',
      parameters: {
        log_group: '/aws/{{service_type}}/{{service_name}}',
        filter_pattern: 'ERROR Exception',
        minutes_back: 5,
      },
      onError: 'continue',
    },
    {
      id: 'summarize',
      name: 'Deployment Summary',
      description: 'Create deployment summary',
      action: 'prompt',
      parameters: {
        instruction: `Summarize the deployment:
- Service: {{service_name}}
- Previous version: {{steps.pre_check_state.result.taskDefinition}}
- New version: {{steps.monitor_deployment.result.taskDefinition}}
- Health status: {{steps.post_deploy_health.result}}
- Recent errors: {{steps.check_logs.result}}

Provide:
1. Deployment status (success/failed/in-progress)
2. Any issues observed
3. Recommended next steps
4. Rollback instructions if needed`,
      },
    },
  ],
};
