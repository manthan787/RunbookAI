/**
 * Prompt templates for the Runbook agent
 */

import type { Tool, RetrievedKnowledge, Hypothesis } from './types';

/**
 * Build the system prompt with tool descriptions
 */
export function buildSystemPrompt(tools: Tool[], skills: string[]): string {
  const toolDescriptions = tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');

  const skillList = skills.length > 0
    ? skills.map((s) => `- ${s}`).join('\n')
    : 'No skills configured.';

  return `You are Runbook, an AI-powered SRE assistant that investigates incidents and manages cloud infrastructure.

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

## Available Tools

${toolDescriptions}

## Tool Usage Policy

- Use \`aws_query\` for read-only infrastructure queries
- Use \`aws_mutate\` for state changes (requires approval)
- Use \`search_knowledge\` to find relevant runbooks and past incidents
- Use \`pagerduty_*\` tools for incident management
- Use \`skill\` to invoke specialized workflows

When investigating:
1. Start with observability tools to understand symptoms
2. Query infrastructure state to correlate with symptoms
3. Check knowledge base for known issues and runbooks
4. Form and test hypotheses systematically

## Available Skills

${skillList}

## Output Format

- Be concise and actionable
- Use markdown for structure
- Include confidence levels for conclusions
- Always show your reasoning
- When suggesting commands, show them in code blocks with rollback instructions

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

If this was an investigation:
1. State the root cause with confidence level (HIGH/MEDIUM/LOW)
2. Explain the evidence chain that led to this conclusion
3. Suggest remediation steps
4. If a runbook exists, reference it

If this was a query:
1. Answer the question directly
2. Include relevant details from the data
3. Highlight any concerns or recommendations

Be concise but thorough. Use markdown formatting for clarity.
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
