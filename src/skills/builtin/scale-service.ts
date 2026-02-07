/**
 * Scale Service Skill
 *
 * Safely scale a service up or down with proper checks.
 */

import type { SkillDefinition } from '../types';

export const scaleServiceSkill: SkillDefinition = {
  id: 'scale-service',
  name: 'Scale Service',
  description: 'Safely scale an ECS service or Lambda function with pre/post checks',
  version: '1.0.0',
  tags: ['scaling', 'capacity', 'ecs', 'lambda'],
  applicableServices: ['ecs', 'lambda', 'eks'],
  riskLevel: 'medium',

  parameters: [
    {
      name: 'service_type',
      description: 'Type of service to scale',
      type: 'string',
      required: true,
      enum: ['ecs', 'lambda', 'eks'],
    },
    {
      name: 'service_name',
      description: 'Name of the service to scale',
      type: 'string',
      required: true,
    },
    {
      name: 'cluster',
      description: 'ECS/EKS cluster name (required for ecs/eks)',
      type: 'string',
      required: false,
    },
    {
      name: 'target_count',
      description: 'Target number of instances/tasks',
      type: 'number',
      required: true,
    },
    {
      name: 'reason',
      description: 'Reason for scaling',
      type: 'string',
      required: false,
      default: 'Manual scaling request',
    },
  ],

  steps: [
    {
      id: 'check_current_state',
      name: 'Check Current State',
      description: 'Get current service configuration and status',
      action: 'aws_query',
      parameters: {
        query: 'Get details for {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'abort',
    },
    {
      id: 'check_alarms',
      name: 'Check for Active Alarms',
      description: 'Ensure no critical alarms before scaling',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'ALARM',
      },
      onError: 'continue',
    },
    {
      id: 'analyze_scaling',
      name: 'Analyze Scaling Impact',
      description: 'Determine if scaling is safe',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the scaling request:
- Current state: {{steps.check_current_state.result}}
- Active alarms: {{steps.check_alarms.result}}
- Target count: {{target_count}}
- Reason: {{reason}}

Determine:
1. Is this scaling safe to proceed?
2. What is the expected impact?
3. Any risks or concerns?
4. Recommended approach (gradual vs immediate)`,
      },
    },
    {
      id: 'execute_scaling',
      name: 'Execute Scaling',
      description: 'Apply the scaling change',
      action: 'aws_mutate',
      requiresApproval: true,
      parameters: {
        operation: '{{service_type}}:UpdateService',
        resource: '{{service_name}}',
        parameters: {
          cluster: '{{cluster}}',
          desiredCount: '{{target_count}}',
        },
        description: 'Scale {{service_name}} to {{target_count}} instances. Reason: {{reason}}',
        rollbackCommand: 'Scale back to {{steps.check_current_state.result.desiredCount}} instances',
      },
      onError: 'abort',
    },
    {
      id: 'verify_scaling',
      name: 'Verify Scaling',
      description: 'Check that scaling completed successfully',
      action: 'aws_query',
      parameters: {
        query: 'Get current status of {{service_type}} service {{service_name}}',
        services: ['{{service_type}}'],
      },
      onError: 'continue',
    },
    {
      id: 'check_health',
      name: 'Check Service Health',
      description: 'Verify service is healthy after scaling',
      action: 'cloudwatch_alarms',
      parameters: {
        state: 'all',
      },
      onError: 'continue',
    },
    {
      id: 'summarize',
      name: 'Summarize Results',
      description: 'Create scaling summary',
      action: 'prompt',
      parameters: {
        instruction: `Summarize the scaling operation:
- Service: {{service_name}}
- Previous state: {{steps.check_current_state.result}}
- New state: {{steps.verify_scaling.result}}
- Health check: {{steps.check_health.result}}

Include any recommendations for monitoring.`,
      },
    },
  ],
};
