/**
 * Learning loop pipeline
 *
 * Converts investigation output into:
 * - Postmortem draft
 * - Knowledge suggestions
 * - Runbook updates (applied or proposed)
 */

import { existsSync } from 'fs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import type { InvestigationResult } from '../agent/investigation-orchestrator';
import { extractJSON } from '../agent/llm-parser';

export interface LearningEvent {
  timestamp: string;
  phase?: string;
  type: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface LearningLoopInput {
  result: InvestigationResult;
  incidentId?: string;
  query: string;
  events: LearningEvent[];
  complete: (prompt: string) => Promise<string>;
  baseDir?: string;
  applyRunbookUpdates?: boolean;
}

export interface LearningLoopOutput {
  artifactDir: string;
  investigationPath: string;
  postmortemPath: string;
  suggestionsPath: string;
  appliedRunbookUpdates: string[];
  proposedRunbookUpdates: string[];
  proposedKnowledgeDocs: string[];
}

interface LocalRunbook {
  path: string;
  title: string;
  services: string[];
  content: string;
}

const PostmortemSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['sev1', 'sev2', 'sev3']).default('sev2'),
  summary: z.string().min(1),
  impact: z.string().min(1),
  detection: z.string().min(1),
  rootCause: z.string().min(1),
  contributingFactors: z.array(z.string()).default([]),
  timeline: z
    .array(
      z.object({
        timestamp: z.string().min(1),
        event: z.string().min(1),
        evidence: z.string().optional(),
      })
    )
    .min(3),
  whatWentWell: z.array(z.string()).default([]),
  whatDidntGoWell: z.array(z.string()).default([]),
  actionItems: z
    .array(
      z.object({
        title: z.string().min(1),
        ownerRole: z.string().min(1),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
        dueInDays: z.number().int().min(1).max(180).default(14),
        category: z.enum(['prevention', 'detection', 'response', 'recovery']),
        details: z.string().min(1),
      })
    )
    .min(1),
  confidenceNotes: z.string().default(''),
});

const KnowledgeSuggestionSchema = z.object({
  type: z.enum(['update_runbook', 'new_runbook', 'new_known_issue']),
  title: z.string().min(1),
  targetRunbookTitle: z.string().optional(),
  services: z.array(z.string()).default([]),
  reasoning: z.string().min(1),
  contentMarkdown: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.75),
});

const LearningDraftSchema = z.object({
  postmortem: PostmortemSchema,
  knowledgeSuggestions: z.array(KnowledgeSuggestionSchema).max(8).default([]),
});

type LearningDraft = z.infer<typeof LearningDraftSchema>;
type KnowledgeSuggestion = z.infer<typeof KnowledgeSuggestionSchema>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(abs);
      }
    }
  }

  return files;
}

function extractHeadingTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) {
    return undefined;
  }
  return match[1].trim();
}

async function loadLocalRunbooks(baseDir: string): Promise<LocalRunbook[]> {
  const runbooksDir = join(baseDir, 'runbooks');
  const files = await listMarkdownFiles(runbooksDir);
  const runbooks: LocalRunbook[] = [];

  for (const path of files) {
    const raw = await readFile(path, 'utf-8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    const services = Array.isArray(data.services)
      ? data.services.map((service) => String(service).trim()).filter(Boolean)
      : [];

    const title =
      (typeof data.title === 'string' && data.title.trim()) ||
      extractHeadingTitle(parsed.content) ||
      basename(path, '.md');

    runbooks.push({
      path,
      title,
      services,
      content: raw,
    });
  }

  return runbooks;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars - 3) + '...';
}

function buildPrompt(input: {
  incidentId?: string;
  query: string;
  result: InvestigationResult;
  events: LearningEvent[];
  runbooks: LocalRunbook[];
}): string {
  const timeline = input.events
    .slice(0, 40)
    .map((event) => `- [${event.timestamp}] ${event.type}: ${event.summary}`)
    .join('\n');

  const runbookContext =
    input.runbooks.length === 0
      ? 'No local runbooks found.'
      : input.runbooks
          .slice(0, 8)
          .map((runbook) => {
            return [
              `Title: ${runbook.title}`,
              `Services: ${runbook.services.join(', ') || 'unknown'}`,
              `Excerpt: ${truncate(runbook.content.replace(/\s+/g, ' '), 350)}`,
            ].join('\n');
          })
          .join('\n\n');

  const remediationSteps =
    input.result.remediationPlan?.steps?.map((step) => ({
      action: step.action,
      description: step.description,
      riskLevel: step.riskLevel,
      matchingSkill: step.matchingSkill,
      matchingRunbook: step.matchingRunbook,
      status: step.status,
    })) || [];

  return `You are a senior incident commander producing high-quality learning artifacts.

Generate a strict JSON object with this exact top-level shape:
{
  "postmortem": {
    "title": string,
    "severity": "sev1" | "sev2" | "sev3",
    "summary": string,
    "impact": string,
    "detection": string,
    "rootCause": string,
    "contributingFactors": string[],
    "timeline": [{"timestamp": string, "event": string, "evidence"?: string}],
    "whatWentWell": string[],
    "whatDidntGoWell": string[],
    "actionItems": [{
      "title": string,
      "ownerRole": string,
      "priority": "P0" | "P1" | "P2" | "P3",
      "dueInDays": number,
      "category": "prevention" | "detection" | "response" | "recovery",
      "details": string
    }],
    "confidenceNotes": string
  },
  "knowledgeSuggestions": [{
    "type": "update_runbook" | "new_runbook" | "new_known_issue",
    "title": string,
    "targetRunbookTitle"?: string,
    "services": string[],
    "reasoning": string,
    "contentMarkdown": string,
    "confidence": number
  }]
}

Rules:
- Use evidence in the provided timeline and investigation output, do not invent systems.
- Make action items concrete, owner-role specific, and testable.
- Prefer "update_runbook" when an existing runbook likely applies.
- Use concise but complete postmortem language.
- Return JSON only, no markdown fences.

Incident ID: ${input.incidentId || 'unknown'}
Query: ${input.query}
Investigation ID: ${input.result.id}
Root Cause: ${input.result.rootCause || 'unknown'}
Confidence: ${input.result.confidence || 'unknown'}
Affected Services: ${(input.result.affectedServices || []).join(', ') || 'unknown'}

Summary:
${input.result.summary}

Remediation Steps:
${JSON.stringify(remediationSteps, null, 2)}

Timeline Signals:
${timeline || '- none captured'}

Existing Runbook Context:
${runbookContext}`;
}

function buildFallbackDraft(input: LearningLoopInput): LearningDraft {
  const timeline = input.events.slice(0, 12).map((event) => ({
    timestamp: event.timestamp,
    event: event.summary,
    evidence: event.type,
  }));

  while (timeline.length < 3) {
    timeline.push({
      timestamp: new Date().toISOString(),
      event: 'Additional evidence not captured in structured timeline.',
      evidence: 'fallback',
    });
  }

  return {
    postmortem: {
      title: `Incident ${input.incidentId || input.result.id} postmortem`,
      severity: 'sev2',
      summary: input.result.summary || 'Investigation summary unavailable.',
      impact: `Impacted services: ${(input.result.affectedServices || []).join(', ') || 'unknown'}.`,
      detection: 'Detected through incident investigation signals and telemetry queries.',
      rootCause: input.result.rootCause || 'Root cause undetermined during investigation.',
      contributingFactors: [],
      timeline,
      whatWentWell: ['Hypothesis-driven investigation was executed with structured phases.'],
      whatDidntGoWell: [
        'Learning draft generated from fallback template due to parser/model error.',
      ],
      actionItems: [
        {
          title: 'Validate and finalize postmortem with service owners',
          ownerRole: 'service-owner',
          priority: 'P1',
          dueInDays: 7,
          category: 'response',
          details: 'Review evidence, confirm root cause wording, and approve follow-up actions.',
        },
      ],
      confidenceNotes: 'Fallback draft generated because model output could not be parsed.',
    },
    knowledgeSuggestions: [],
  };
}

function parseDraft(text: string, input: LearningLoopInput): LearningDraft {
  try {
    const json = extractJSON(text);
    const parsed = JSON.parse(json);
    return LearningDraftSchema.parse(parsed);
  } catch {
    return buildFallbackDraft(input);
  }
}

function renderPostmortemMarkdown(input: {
  incidentId?: string;
  result: InvestigationResult;
  draft: LearningDraft['postmortem'];
}): string {
  const actionItems = input.draft.actionItems.map((item) => item.title);
  const frontmatter = stringifyYaml({
    type: 'postmortem',
    title: input.draft.title,
    incidentId: input.incidentId || input.result.id,
    incidentDate: toDateOnly(new Date().toISOString()),
    services: input.result.affectedServices || [],
    rootCause: input.draft.rootCause,
    severity: input.draft.severity,
    duration: 'TBD',
    actionItems,
  }).trim();

  const timeline = input.draft.timeline
    .map((entry) => {
      const evidence = entry.evidence ? ` (${entry.evidence})` : '';
      return `- ${entry.timestamp}: ${entry.event}${evidence}`;
    })
    .join('\n');

  const actionItemsBody = input.draft.actionItems
    .map((item) => {
      return [
        `### ${item.title}`,
        `- Owner Role: ${item.ownerRole}`,
        `- Priority: ${item.priority}`,
        `- Category: ${item.category}`,
        `- Due: ${item.dueInDays} days`,
        `- Details: ${item.details}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '---',
    frontmatter,
    '---',
    '',
    `# ${input.draft.title}`,
    '',
    '## Summary',
    input.draft.summary,
    '',
    '## Impact',
    input.draft.impact,
    '',
    '## Detection',
    input.draft.detection,
    '',
    '## Root Cause',
    input.draft.rootCause,
    '',
    '## Contributing Factors',
    ...(input.draft.contributingFactors.length > 0
      ? input.draft.contributingFactors.map((factor) => `- ${factor}`)
      : ['- None identified.']),
    '',
    '## Timeline',
    timeline,
    '',
    '## What Went Well',
    ...(input.draft.whatWentWell.length > 0
      ? input.draft.whatWentWell.map((item) => `- ${item}`)
      : ['- None recorded.']),
    '',
    '## What Did Not Go Well',
    ...(input.draft.whatDidntGoWell.length > 0
      ? input.draft.whatDidntGoWell.map((item) => `- ${item}`)
      : ['- None recorded.']),
    '',
    '## Action Items',
    actionItemsBody,
    '',
    '## Confidence Notes',
    input.draft.confidenceNotes || 'No additional confidence notes provided.',
    '',
  ].join('\n');
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scoreRunbookMatch(suggestion: KnowledgeSuggestion, runbook: LocalRunbook): number {
  let score = 0;
  const target = suggestion.targetRunbookTitle?.toLowerCase();
  const title = runbook.title.toLowerCase();

  if (target) {
    if (title === target) {
      score += 100;
    } else if (title.includes(target) || target.includes(title)) {
      score += 50;
    }
  }

  const suggestionServices = new Set(suggestion.services.map((service) => service.toLowerCase()));
  for (const service of runbook.services) {
    if (suggestionServices.has(service.toLowerCase())) {
      score += 20;
    }
  }

  const suggestionTokens = new Set(tokenize(suggestion.title));
  for (const token of tokenize(runbook.title)) {
    if (suggestionTokens.has(token)) {
      score += 5;
    }
  }

  return score;
}

function findBestRunbookForUpdate(
  suggestion: KnowledgeSuggestion,
  runbooks: LocalRunbook[]
): LocalRunbook | null {
  if (runbooks.length === 0) {
    return null;
  }

  let best: LocalRunbook | null = null;
  let bestScore = -1;

  for (const runbook of runbooks) {
    const score = scoreRunbookMatch(suggestion, runbook);
    if (score > bestScore) {
      best = runbook;
      bestScore = score;
    }
  }

  if (!best || bestScore <= 0) {
    return null;
  }

  return best;
}

function renderRunbookLearningSection(input: {
  suggestion: KnowledgeSuggestion;
  incidentLabel: string;
}): string {
  return [
    `## Incident Learnings (${input.incidentLabel})`,
    '',
    `### ${input.suggestion.title}`,
    '',
    `Rationale: ${input.suggestion.reasoning}`,
    '',
    input.suggestion.contentMarkdown.trim(),
    '',
  ].join('\n');
}

async function applySuggestion(
  suggestion: KnowledgeSuggestion,
  context: {
    runbooks: LocalRunbook[];
    artifactDir: string;
    baseDir: string;
    applyRunbookUpdates: boolean;
    incidentLabel: string;
  }
): Promise<{ applied: string[]; proposed: string[] }> {
  const applied: string[] = [];
  const proposed: string[] = [];
  const proposalsDir = join(context.artifactDir, 'proposals');
  const runbookUpdatesDir = join(context.artifactDir, 'runbook-updates');
  await mkdir(proposalsDir, { recursive: true });
  await mkdir(runbookUpdatesDir, { recursive: true });

  if (suggestion.type === 'update_runbook') {
    const runbook = findBestRunbookForUpdate(suggestion, context.runbooks);
    const section = renderRunbookLearningSection({
      suggestion,
      incidentLabel: context.incidentLabel,
    });

    if (runbook && context.applyRunbookUpdates) {
      if (!runbook.content.includes(section)) {
        const merged = runbook.content.trimEnd() + '\n\n' + section;
        runbook.content = merged + '\n';
        await writeFile(runbook.path, runbook.content, 'utf-8');
      }
      applied.push(runbook.path);
      return { applied, proposed };
    }

    const targetPath = runbook ? runbook.path : 'no-local-runbook-match';
    const targetTitle = runbook ? runbook.title : 'unknown';
    const proposalPath = join(
      runbookUpdatesDir,
      `${slugify(`${suggestion.title}-${context.incidentLabel}`) || 'runbook-update'}.md`
    );
    const proposalContent = [
      '# Runbook Update Proposal',
      '',
      `- Incident: ${context.incidentLabel}`,
      `- Suggested Target Title: ${targetTitle}`,
      `- Suggested Target Path: ${targetPath}`,
      `- Confidence: ${suggestion.confidence}`,
      '',
      section,
    ].join('\n');
    await writeFile(proposalPath, proposalContent, 'utf-8');
    proposed.push(proposalPath);
    return { applied, proposed };
  }

  if (suggestion.type === 'new_runbook') {
    const filename = `${slugify(suggestion.title) || 'new-runbook'}.md`;
    const destination = context.applyRunbookUpdates
      ? join(context.baseDir, 'runbooks', filename)
      : join(proposalsDir, filename);
    const frontmatter = stringifyYaml({
      type: 'runbook',
      title: suggestion.title,
      services: suggestion.services,
      tags: ['generated', 'incident-learning'],
    }).trim();

    const content = ['---', frontmatter, '---', '', suggestion.contentMarkdown.trim(), ''].join(
      '\n'
    );
    await mkdir(join(context.baseDir, 'runbooks'), { recursive: true });
    await writeFile(destination, content, 'utf-8');
    if (context.applyRunbookUpdates) {
      applied.push(destination);
    } else {
      proposed.push(destination);
    }
    return { applied, proposed };
  }

  const knownIssuePath = join(
    proposalsDir,
    `${slugify(suggestion.title) || 'known-issue'}-known-issue.md`
  );
  const knownIssueFrontmatter = stringifyYaml({
    type: 'known_issue',
    title: suggestion.title,
    services: suggestion.services,
    severity: 'sev2',
    discoveredAt: toDateOnly(new Date().toISOString()),
  }).trim();
  const knownIssueContent = [
    '---',
    knownIssueFrontmatter,
    '---',
    '',
    suggestion.contentMarkdown.trim(),
    '',
  ].join('\n');
  await writeFile(knownIssuePath, knownIssueContent, 'utf-8');
  proposed.push(knownIssuePath);
  return { applied, proposed };
}

async function writeInvestigationArtifact(
  input: LearningLoopInput,
  artifactDir: string
): Promise<string> {
  const outputPath = join(artifactDir, 'investigation-result.json');
  const payload = {
    query: input.query,
    incidentId: input.incidentId,
    generatedAt: new Date().toISOString(),
    result: input.result,
    events: input.events,
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  return outputPath;
}

export async function runLearningLoop(input: LearningLoopInput): Promise<LearningLoopOutput> {
  const baseDir = input.baseDir || '.runbook';
  const artifactDir = join(baseDir, 'learning', input.result.id);
  await mkdir(artifactDir, { recursive: true });

  const runbooks = await loadLocalRunbooks(baseDir);
  const prompt = buildPrompt({
    incidentId: input.incidentId,
    query: input.query,
    result: input.result,
    events: input.events,
    runbooks,
  });

  let draft: LearningDraft;
  try {
    const llmResponse = await input.complete(prompt);
    draft = parseDraft(llmResponse, input);
  } catch {
    draft = buildFallbackDraft(input);
  }

  const postmortemMarkdown = renderPostmortemMarkdown({
    incidentId: input.incidentId,
    result: input.result,
    draft: draft.postmortem,
  });
  const postmortemPath = join(
    artifactDir,
    `${slugify(`postmortem-${input.incidentId || input.result.id}`) || 'postmortem'}.md`
  );
  await writeFile(postmortemPath, postmortemMarkdown, 'utf-8');

  const appliedRunbookUpdates: string[] = [];
  const proposedRunbookUpdates: string[] = [];
  const proposedKnowledgeDocs: string[] = [];
  const incidentLabel = input.incidentId || input.result.id;

  for (const suggestion of draft.knowledgeSuggestions) {
    const appliedOrProposed = await applySuggestion(suggestion, {
      runbooks,
      artifactDir,
      baseDir,
      applyRunbookUpdates: input.applyRunbookUpdates || false,
      incidentLabel,
    });
    appliedRunbookUpdates.push(...appliedOrProposed.applied);
    proposedRunbookUpdates.push(...appliedOrProposed.proposed);
    if (suggestion.type !== 'update_runbook') {
      proposedKnowledgeDocs.push(...appliedOrProposed.proposed);
    }
  }

  const suggestionsPath = join(artifactDir, 'knowledge-suggestions.json');
  await writeFile(suggestionsPath, JSON.stringify(draft.knowledgeSuggestions, null, 2), 'utf-8');

  const investigationPath = await writeInvestigationArtifact(input, artifactDir);

  return {
    artifactDir,
    investigationPath,
    postmortemPath,
    suggestionsPath,
    appliedRunbookUpdates: Array.from(new Set(appliedRunbookUpdates)),
    proposedRunbookUpdates: Array.from(new Set(proposedRunbookUpdates)),
    proposedKnowledgeDocs: Array.from(new Set(proposedKnowledgeDocs)),
  };
}
