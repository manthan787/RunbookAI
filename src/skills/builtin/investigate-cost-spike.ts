/**
 * Investigate Cost Spike Skill
 *
 * Investigate why AWS costs increased in a specific period.
 */

import type { SkillDefinition } from '../types';

export const investigateCostSpikeSkill: SkillDefinition = {
  id: 'investigate-cost-spike',
  name: 'Investigate Cost Spike',
  description: 'Investigate why AWS costs increased - identifies which services drove the cost increase',
  version: '1.0.0',
  tags: ['cost', 'investigation', 'finops', 'billing'],
  riskLevel: 'low',

  parameters: [
    {
      name: 'period',
      description: 'The period to investigate (e.g., "January 2026", "last month", "2026-01")',
      type: 'string',
      required: true,
    },
    {
      name: 'compare_to',
      description: 'Period to compare against (e.g., "December 2025", "previous month")',
      type: 'string',
      required: false,
      default: 'previous month',
    },
  ],

  steps: [
    {
      id: 'get_cost_by_service_current',
      name: 'Get Cost Breakdown by Service (Current Period)',
      description: 'Get cost breakdown by service for the spike period',
      action: 'aws_cli',
      parameters: {
        command: 'aws ce get-cost-and-usage --time-period Start={{period_start}},End={{period_end}} --granularity MONTHLY --metrics "BlendedCost" --group-by Type=DIMENSION,Key=SERVICE --region us-east-1',
        reason: 'Get cost breakdown by service to identify which services drove the cost increase',
      },
      onError: 'abort',
    },
    {
      id: 'get_cost_by_service_previous',
      name: 'Get Cost Breakdown by Service (Previous Period)',
      description: 'Get cost breakdown by service for the comparison period',
      action: 'aws_cli',
      parameters: {
        command: 'aws ce get-cost-and-usage --time-period Start={{compare_period_start}},End={{compare_period_end}} --granularity MONTHLY --metrics "BlendedCost" --group-by Type=DIMENSION,Key=SERVICE --region us-east-1',
        reason: 'Get cost breakdown for previous period to compare and identify changes',
      },
      onError: 'continue',
    },
    {
      id: 'analyze_cost_changes',
      name: 'Analyze Cost Changes',
      description: 'Compare the two periods and identify top cost drivers',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the cost data from both periods:

**Current Period ({{period}}):**
{{steps.get_cost_by_service_current.result}}

**Previous Period ({{compare_to}}):**
{{steps.get_cost_by_service_previous.result}}

Calculate:
1. Total cost for each period
2. Cost difference (absolute and percentage)
3. Top 5 services with the largest cost INCREASE
4. For each top service, calculate the dollar amount increase

Format as a table showing: Service | Previous Cost | Current Cost | Increase | % Change`,
      },
    },
    {
      id: 'investigate_top_service',
      name: 'Investigate Top Cost Driver',
      description: 'Query resources for the service with the biggest cost increase',
      action: 'aws_query',
      parameters: {
        query: 'List all resources for the service identified as the top cost driver in {{steps.analyze_cost_changes.result}}',
      },
      onError: 'continue',
    },
    {
      id: 'check_new_resources',
      name: 'Check for New Resources',
      description: 'Look for resources created during the spike period',
      action: 'aws_cli',
      parameters: {
        command: 'aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=Create --start-time {{period_start}} --end-time {{period_end}} --max-items 50 --region us-east-1',
        reason: 'Check for resources created during the spike period that might explain the cost increase',
      },
      onError: 'continue',
    },
    {
      id: 'generate_report',
      name: 'Generate Investigation Report',
      description: 'Create comprehensive cost spike investigation report',
      action: 'prompt',
      parameters: {
        instruction: `Create a cost spike investigation report:

## Cost Spike Investigation: {{period}}

### Summary
- Previous period total: [from analysis]
- Current period total: [from analysis]
- Total increase: [amount and percentage]

### Root Cause Analysis

Based on the data:
{{steps.analyze_cost_changes.result}}

**Primary Cost Driver(s):**
[Identify the specific service(s) responsible for the majority of the increase]

**Contributing Factors:**
{{steps.investigate_top_service.result}}

**New Resources Created:**
{{steps.check_new_resources.result}}

### Findings
[Specific findings about what caused the cost increase]

### Recommendations
1. [Immediate actions to reduce costs]
2. [Preventive measures for the future]
3. [Monitoring suggestions]

### Visualization
Include the cost comparison visualization from the data above.`,
      },
    },
  ],
};
