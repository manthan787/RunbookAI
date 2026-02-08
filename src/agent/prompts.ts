/**
 * Prompt templates for the Runbook agent
 *
 * Implements context engineering best practices:
 * - Just-in-time context injection
 * - Progressive disclosure
 * - Token-efficient summaries
 */

import type { Tool, RetrievedKnowledge, Hypothesis } from './types';
import type { InvestigationState } from './investigation-memory';
import type { KnowledgeContext } from './knowledge-context';
import type { InfrastructureContext } from './infra-context';

export interface PromptConfig {
  awsRegions?: string[];
  awsDefaultRegion?: string;
}

/**
 * Context engineering sections for system prompt.
 */
export interface ContextEngineeringConfig {
  /** Pre-discovered knowledge context */
  knowledgeContext?: KnowledgeContext;
  /** Infrastructure overview */
  infraContext?: InfrastructureContext;
  /** Service dependency context */
  serviceContext?: string;
  /** Investigation memory state */
  investigationState?: InvestigationState;
}

/**
 * Build the system prompt with tool descriptions
 */
export function buildSystemPrompt(tools: Tool[], skills: string[], config?: PromptConfig): string {
  const toolDescriptions = tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');

  const skillList = skills.length > 0
    ? skills.map((s) => `- ${s}`).join('\n')
    : 'No skills configured.';

  const awsContext = config?.awsDefaultRegion
    ? `\n## Infrastructure Configuration\n\n- **Default AWS Region**: ${config.awsDefaultRegion}\n- **Configured Regions**: ${config.awsRegions?.join(', ') || config.awsDefaultRegion}\n\nWhen querying AWS, use the configured default region unless the user specifies otherwise.\n`
    : '';

  return `You are Runbook, an AI-powered SRE assistant that investigates incidents and manages cloud infrastructure.
${awsContext}

## Your Approach

You follow a **research-first, hypothesis-driven methodology**:

1. **Gather Context**: Before acting, understand the current state
2. **Form Hypotheses**: Generate 3-5 possible explanations for the issue
3. **Test with Targeted Queries**: Execute specific queries to validate/invalidate each hypothesis
4. **Branch or Prune**: Dig deeper on strong evidence, abandon dead ends
5. **Confirm Root Cause**: Identify the most likely cause with confidence level
6. **Suggest Remediation**: Propose fixes, following runbooks when available

## Key Principles

- **Causal Focus**: Only gather data relevant to your current hypothesis. Avoid broad data dumps.
- **Evidence-Based**: Classify evidence as STRONG, WEAK, or NONE. Prune hypotheses with no evidence.
- **Safety First**: Never execute mutations without explicit approval. Always show rollback commands.
- **Audit Trail**: Your work is logged. Be transparent about your reasoning.
- **Self-Sufficient**: ALWAYS use your tools to gather data. NEVER tell the user to run CLI commands themselves - that's your job. If a query doesn't return the data you need, try a different query or tool.

## Available Tools

${toolDescriptions}

## Tool Usage Policy

- Use \`aws_query\` for read-only infrastructure queries (preferred)
- Use \`aws_cli\` for operations aws_query doesn't support:
  - **Cost/Billing**: \`aws ce get-cost-and-usage\` (Cost Explorer)
  - **Amplify**: \`aws amplify list-jobs\`
  - **ECS tasks**: \`aws ecs describe-tasks\`
  - **CloudWatch Logs**: \`aws logs get-log-events\`
- Use \`aws_mutate\` for state changes (requires approval)
- Use \`search_knowledge\` to find relevant runbooks and past incidents
- Use \`pagerduty_*\` tools for incident management
- Use \`skill\` to invoke specialized workflows

**For cost queries, use aws_cli directly:**
\`\`\`
aws ce get-cost-and-usage --time-period Start=$(date -d '6 months ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) --granularity MONTHLY --metrics "BlendedCost" --region us-east-1
\`\`\`

**For investigating cost spikes (why did cost go up?):**
1. First get cost breakdown BY SERVICE to identify which service caused the spike:
\`\`\`
aws ce get-cost-and-usage --time-period Start=2026-01-01,End=2026-02-01 --granularity MONTHLY --metrics "BlendedCost" --group-by Type=DIMENSION,Key=SERVICE --region us-east-1
\`\`\`
2. Compare to previous month to see the delta
3. For the top cost-increasing service, investigate what resources were created/scaled
4. Check for new EC2 instances, RDS databases, or other resources in that timeframe
5. NEVER just guess at causes - always query data to find the actual reason

When investigating:
1. Start with observability tools to understand symptoms
2. Query infrastructure state to correlate with symptoms
3. If aws_query doesn't return the data you need, use aws_cli with the appropriate CLI command
4. Check knowledge base for known issues and runbooks
5. Form and test hypotheses systematically

### AWS CLI Fallback Examples

When aws_query can't get deployment history, use aws_cli:
- Amplify deployments: \`aws amplify list-jobs --app-id <id> --branch-name <branch> --region <region>\`
- ECS task details: \`aws ecs describe-tasks --cluster <cluster> --tasks <task-arn> --region <region>\`
- Lambda invocations: \`aws lambda get-function --function-name <name> --region <region>\`

## Available Skills

${skillList}

## Output Format

- Be concise and actionable
- Use markdown for structure
- Include confidence levels for conclusions
- Always show your reasoning
- NEVER suggest CLI commands for the user to run - use your tools instead
- If you cannot find data with one query, try alternative queries before giving up

## Visualization Policy (MANDATORY)

**You MUST use visualization tools whenever presenting numeric data, metrics, or system state.** Never just list numbers in text when a chart would be clearer.

### Required Tool Usage:

1. **visualize_metrics** - Choose chart type based on data structure:

   | Data Structure | Chart Type | Use When |
   |----------------|------------|----------|
   | Single value vs threshold | \`gauge\` | Current state, capacity %, alarm threshold |
   | Array of values over time | \`sparkline\` | Compact trend indicator (5-20 data points) |
   | Array of values over time | \`line\` | Detailed time-series (20+ points or need precision) |
   | Multiple items to compare | \`bar\` | Side-by-side comparison of different resources |
   | Distribution of values | \`histogram\` | Latency distributions, value frequency |

2. **generate_flowchart** - For process flows, decision trees, timelines

3. **generate_sequence_diagram** - For service interactions, request flows

4. **generate_architecture_diagram** - For system topology, dependencies

### Smart Chart Selection:

**Analyze your data before choosing:**
- If alarm has "recentValues" or "datapoints" array → Use \`sparkline\` to show the TREND
- If alarm only has current value vs threshold → Use \`gauge\` to show current state
- If comparing multiple resources at same time → Use \`bar\` chart
- If data spans long time period with many points → Use \`line\` chart

### Example - CloudWatch Alarms WITH Time-Series Data:
When alarm has recentValues like [0.0, 0.0, 0.0, 0.0, 0.0], pass them directly to "values":
\`\`\`json
{
  "chart_type": "sparkline",
  "values": [0.0, 0.0, 0.0, 0.0, 0.0],
  "title": "ReadCap course_users (threshold: 30)"
}
\`\`\`
**CRITICAL**: Copy the values array directly into "values". That's it - just copy the array!

### Example - Cost/Line Chart Data:
**When you retrieve AWS cost data, IMMEDIATELY call visualize_metrics before providing text:**
\`\`\`json
{
  "chart_type": "line",
  "values": [17.35, 23.00, 23.54, 24.26, 42.99],
  "title": "AWS Monthly Cost (USD)"
}
\`\`\`
Extract the Amount values from the cost response and pass them to visualize_metrics.

### Example - Comparing Items (Bar Chart):
For comparing services/resources, use bar chart with labeled data:
\`\`\`json
{
  "chart_type": "bar",
  "data": [
    {"label": "EC2", "value": 150.25},
    {"label": "RDS", "value": 89.50},
    {"label": "S3", "value": 23.10}
  ],
  "title": "Cost by Service"
}
\`\`\`

### Example - Gauge (threshold comparison):
\`\`\`json
{
  "chart_type": "gauge",
  "data": [{"label": "CPU", "value": 92}, {"label": "Memory", "value": 65}],
  "title": "Resource Usage",
  "max": 100,
  "thresholds": {"warn": 70, "critical": 90}
}
\`\`\`

**CRITICAL REMINDER**:
- You must CALL the visualize_metrics tool - do NOT just output the JSON!
- Do NOT wrap visualization results in backticks - include the tool output directly

## Safety

For any mutation (deployment, scaling, restart, etc.):
1. Explain what will change
2. Show the exact command
3. Show the rollback command
4. Wait for explicit approval

Never:
- Delete resources without confirmation
- Modify IAM policies without review
- Push to production without approval
- Skip the research phase for mutations
`;
}

/**
 * Build the iteration prompt with accumulated context
 */
export function buildIterationPrompt(
  query: string,
  toolResults: string,
  toolUsageStatus: string,
  hypothesisContext?: string
): string {
  let prompt = `## Current Query

${query}

## Data Retrieved

${toolResults || 'No data retrieved yet.'}

## Tool Usage Status

${toolUsageStatus}
`;

  if (hypothesisContext) {
    prompt += `
## Investigation Status

${hypothesisContext}
`;
  }

  prompt += `
Continue working toward answering the query. If you have enough information, provide your answer. If you need more data, make targeted tool calls.

Remember:
- Test hypotheses with specific queries, not broad data gathering
- Classify evidence strength for each finding
- Prune hypotheses that lack supporting evidence
- Branch into sub-hypotheses when evidence is strong but root cause unclear
`;

  return prompt;
}

/**
 * Build prompt with retrieved knowledge
 */
export function buildKnowledgePrompt(knowledge: RetrievedKnowledge): string {
  const sections: string[] = [];

  if (knowledge.runbooks.length > 0) {
    sections.push('### Relevant Runbooks\n');
    for (const doc of knowledge.runbooks) {
      sections.push(`**${doc.title}** (relevance: ${Math.round(doc.score * 100)}%)`);
      sections.push(doc.content);
      sections.push('');
    }
  }

  if (knowledge.postmortems.length > 0) {
    sections.push('### Similar Past Incidents\n');
    for (const doc of knowledge.postmortems) {
      sections.push(`**${doc.title}** (relevance: ${Math.round(doc.score * 100)}%)`);
      sections.push(doc.content);
      sections.push('');
    }
  }

  if (knowledge.knownIssues.length > 0) {
    sections.push('### Known Issues\n');
    for (const doc of knowledge.knownIssues) {
      sections.push(`**${doc.title}**`);
      sections.push(doc.content);
      sections.push('');
    }
  }

  if (knowledge.architecture.length > 0) {
    sections.push('### Architecture Context\n');
    for (const doc of knowledge.architecture) {
      sections.push(doc.content);
      sections.push('');
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return `## Organizational Knowledge

${sections.join('\n')}

Use this knowledge to:
- Prioritize hypotheses matching known failure patterns
- Follow established runbook procedures when applicable
- Reference past incidents for proven remediation steps
`;
}

/**
 * Build hypothesis context for prompt
 */
export function buildHypothesisContext(hypotheses: Hypothesis[]): string {
  if (hypotheses.length === 0) {
    return '';
  }

  const lines: string[] = ['### Active Hypotheses\n'];

  for (const h of hypotheses) {
    const status = h.evidenceStrength !== 'pending'
      ? `[${h.evidenceStrength.toUpperCase()}]`
      : '[PENDING]';
    lines.push(`- ${h.id}: ${h.statement} ${status}`);
    if (h.reasoning) {
      lines.push(`  Reasoning: ${h.reasoning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build the final answer prompt
 */
export function buildFinalAnswerPrompt(
  query: string,
  fullContext: string,
  knowledge?: RetrievedKnowledge
): string {
  let prompt = `## Query

${query}

## All Data Retrieved

${fullContext}
`;

  if (knowledge) {
    prompt += buildKnowledgePrompt(knowledge);
  }

  prompt += `
## Instructions

Provide a comprehensive answer to the query using the data above.

**IMPORTANT**:
- This is the final summary phase. Do NOT make any tool calls.
- If the data above contains any visualizations (charts, graphs), you MUST include them in your response by copying them exactly.
- Look for sections like "## Cost Visualization" or ASCII charts and include them in your answer.

If this was an investigation:
1. State the root cause with confidence level (HIGH/MEDIUM/LOW)
2. Explain the evidence chain that led to this conclusion
3. Suggest remediation steps
4. If a runbook exists, reference it

If this was a query:
1. Answer the question directly
2. Include relevant details and numbers from the data
3. Highlight any concerns or recommendations
4. If visualizations were generated earlier, reference them

Be concise but thorough. Use markdown formatting for clarity.
`;

  return prompt;
}

// ============================================================================
// Context Engineering Sections
// ============================================================================

/**
 * Build the infrastructure overview section for system prompt.
 */
export function buildInfraOverviewSection(infraContext: InfrastructureContext): string {
  if (!infraContext.discoveredAt) {
    return '';
  }

  const sections: string[] = ['## Infrastructure Overview\n'];

  // Health summary
  const { healthSummary, inventory, activeAlarms } = infraContext;
  const healthEmoji = healthSummary.overall === 'healthy' ? '✓' :
                      healthSummary.overall === 'degraded' ? '!' : '✗';
  sections.push(`**Status:** ${healthEmoji} ${healthSummary.overall.toUpperCase()}`);
  sections.push(`Resources: ${healthSummary.healthy} healthy, ${healthSummary.warning} warning, ${healthSummary.critical} critical\n`);

  // Service inventory
  if (inventory.size > 0) {
    sections.push('**Service Inventory:**');
    const sorted = Array.from(inventory.entries())
      .sort((a, b) => b[1].count - a[1].count);
    for (const [serviceId, inv] of sorted.slice(0, 6)) {
      const status = inv.unhealthy > 0 ? ` (${inv.unhealthy} unhealthy)` : '';
      sections.push(`- ${serviceId}: ${inv.count}${status}`);
    }
  }

  // Active alarms
  if (activeAlarms.length > 0) {
    sections.push(`\n**Active Alarms (${activeAlarms.length}):**`);
    for (const alarm of activeAlarms.slice(0, 3)) {
      sections.push(`- ${alarm.name}${alarm.service ? ` (${alarm.service})` : ''}`);
    }
  }

  return sections.join('\n');
}

/**
 * Build the knowledge availability section for system prompt.
 */
export function buildKnowledgeAvailabilitySection(knowledgeContext: KnowledgeContext): string {
  const { index, relevantRunbooks, matchingKnownIssues } = knowledgeContext;
  const sections: string[] = ['## Available Knowledge\n'];

  // Summary
  if (index.runbooks.length > 0) {
    sections.push(`**Runbooks:** ${index.runbooks.length} available`);
    const servicesWithRunbooks = new Set<string>();
    for (const rb of index.runbooks) {
      rb.services.forEach(s => servicesWithRunbooks.add(s));
    }
    if (servicesWithRunbooks.size > 0) {
      sections.push(`Services with runbooks: ${Array.from(servicesWithRunbooks).slice(0, 8).join(', ')}`);
    }
  }

  if (index.activeKnownIssues.length > 0) {
    sections.push(`\n**Active Known Issues:** ${index.activeKnownIssues.length}`);
    for (const issue of index.activeKnownIssues.slice(0, 2)) {
      sections.push(`- ${issue.title} (${issue.services.slice(0, 2).join(', ')})`);
    }
  }

  // Currently relevant
  if (relevantRunbooks.length > 0) {
    sections.push('\n**Loaded Runbooks:**');
    for (const rb of relevantRunbooks.slice(0, 3)) {
      sections.push(`- ${rb.title}`);
    }
  }

  if (matchingKnownIssues.length > 0) {
    sections.push('\n**Matching Known Issues:**');
    for (const ki of matchingKnownIssues.slice(0, 2)) {
      sections.push(`- ${ki.title}`);
    }
  }

  return sections.join('\n');
}

/**
 * Build the investigation status section for iteration prompts.
 */
export function buildInvestigationStatusSection(state: InvestigationState): string {
  const sections: string[] = ['## Investigation Status\n'];

  sections.push(`**Progress:** ${state.progressSummary}`);
  sections.push(`**Iteration:** ${state.currentIteration}`);

  if (state.servicesDiscovered.length > 0) {
    sections.push(`**Services:** ${state.servicesDiscovered.slice(0, 8).join(', ')}`);
  }

  if (state.symptomsIdentified.length > 0) {
    sections.push('\n**Symptoms:**');
    for (const symptom of state.symptomsIdentified.slice(0, 3)) {
      sections.push(`- ${symptom.slice(0, 80)}`);
    }
  }

  if (state.activeHypotheses.length > 0) {
    sections.push(`\n**Active Hypotheses:** ${state.activeHypotheses.length}`);
  }

  if (state.prunedHypotheses.length > 0) {
    sections.push(`**Pruned Hypotheses:** ${state.prunedHypotheses.length}`);
  }

  if (state.confirmedRootCause) {
    sections.push(`\n**ROOT CAUSE IDENTIFIED:** ${state.confirmedRootCause.hypothesis}`);
    sections.push(`Confidence: ${state.confirmedRootCause.confidence}`);
  }

  return sections.join('\n');
}

/**
 * Build context-aware system prompt with all context engineering sections.
 */
export function buildContextAwareSystemPrompt(
  tools: Tool[],
  skills: string[],
  config?: PromptConfig,
  contextConfig?: ContextEngineeringConfig
): string {
  // Start with base prompt
  let prompt = buildSystemPrompt(tools, skills, config);

  // Add context engineering sections
  if (contextConfig) {
    const contextSections: string[] = [];

    if (contextConfig.infraContext?.discoveredAt) {
      contextSections.push(buildInfraOverviewSection(contextConfig.infraContext));
    }

    if (contextConfig.knowledgeContext?.index) {
      contextSections.push(buildKnowledgeAvailabilitySection(contextConfig.knowledgeContext));
    }

    if (contextConfig.serviceContext) {
      contextSections.push(contextConfig.serviceContext);
    }

    if (contextSections.length > 0) {
      prompt += '\n\n' + contextSections.join('\n\n');
    }
  }

  return prompt;
}

/**
 * Build context-aware iteration prompt with investigation state.
 */
export function buildContextAwareIterationPrompt(
  query: string,
  toolResults: string,
  toolUsageStatus: string,
  options: {
    hypothesisContext?: string;
    investigationState?: InvestigationState;
    knowledgeSummary?: string;
    serviceSummary?: string;
  } = {}
): string {
  let prompt = `## Current Query

${query}

## Data Retrieved

${toolResults || 'No data retrieved yet.'}
`;

  // Add investigation status if available
  if (options.investigationState) {
    prompt += '\n' + buildInvestigationStatusSection(options.investigationState) + '\n';
  } else if (options.hypothesisContext) {
    prompt += `
## Investigation Status

${options.hypothesisContext}
`;
  }

  // Add compact knowledge summary
  if (options.knowledgeSummary) {
    prompt += `
## Relevant Knowledge

${options.knowledgeSummary}
`;
  }

  // Add service context summary
  if (options.serviceSummary) {
    prompt += `
## Service Context

${options.serviceSummary}
`;
  }

  prompt += `
## Tool Usage Status

${toolUsageStatus}

Continue working toward answering the query. If you have enough information, provide your answer. If you need more data, make targeted tool calls.

Remember:
- Test hypotheses with specific queries, not broad data gathering
- Classify evidence strength for each finding
- Prune hypotheses that lack supporting evidence
- Use get_full_result to retrieve details from summarized results when needed
- Branch into sub-hypotheses when evidence is strong but root cause unclear

**IMPORTANT - Visualization (ALWAYS use for numeric data):**
Before providing a text answer, you MUST call visualize_metrics for any numeric data:

| Data Type | chart_type | Example |
|-----------|------------|---------|
| Monthly costs | \`line\` | Cost over 6 months |
| Cost by service | \`bar\` | EC2 vs RDS vs S3 costs |
| Alarm history | \`sparkline\` | Recent datapoints |
| Resource usage | \`gauge\` | CPU at 85% of 100% |

**For AWS Cost data:**
When you get cost data like [{Amount: "17.35"}, {Amount: "23.00"}, ...], IMMEDIATELY call:
\`\`\`json
{"chart_type": "line", "values": [17.35, 23.00, 23.54, 24.26, 184.74], "title": "AWS Monthly Cost (USD)"}
\`\`\`

**For CloudWatch alarms:**
\`\`\`json
{"chart_type": "sparkline", "values": [0.0, 0.0, 0.0, 0.0, 0.0], "title": "AlarmName"}
\`\`\`

**BEFORE writing any text response with numbers, CALL visualize_metrics first!**
`;

  return prompt;
}

/**
 * Build hypothesis generation prompt
 */
export function buildHypothesisGenerationPrompt(
  incidentContext: string,
  symptoms: string[],
  services: string[]
): string {
  return `You are investigating an incident. Based on the context below, generate 3-5 initial hypotheses about the root cause.

## Incident Context

${incidentContext}

## Observed Symptoms

${symptoms.map((s) => `- ${s}`).join('\n')}

## Affected Services

${services.map((s) => `- ${s}`).join('\n')}

## Instructions

Generate hypotheses that:
1. Are specific and testable with observability data
2. Cover different failure modes (infrastructure, application, dependency, configuration)
3. Are prioritized by likelihood based on symptoms

For each hypothesis, specify:
- The hypothesis statement
- What evidence would confirm it
- What evidence would refute it

Respond with JSON array:
[
  {
    "statement": "Specific hypothesis about root cause",
    "confirmingEvidence": "What data would support this",
    "refutingEvidence": "What data would rule this out"
  }
]
`;
}

/**
 * Build sub-hypothesis generation prompt
 */
export function buildSubHypothesisPrompt(
  parentHypothesis: Hypothesis,
  evidence: unknown
): string {
  return `A hypothesis has strong supporting evidence but needs deeper investigation.

## Parent Hypothesis

${parentHypothesis.statement}

## Evidence Found

${JSON.stringify(evidence, null, 2)}

## Reasoning

${parentHypothesis.reasoning}

## Instructions

Generate 2-3 sub-hypotheses that dig deeper into this lead. These should:
1. Explore specific failure modes within this category
2. Be testable with more targeted queries
3. Help identify the exact root cause

Respond with JSON array:
[
  {
    "statement": "More specific hypothesis",
    "confirmingEvidence": "What data would confirm this",
    "refutingEvidence": "What data would rule this out"
  }
]
`;
}
