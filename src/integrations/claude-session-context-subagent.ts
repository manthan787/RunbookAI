import type { RetrievedChunk } from '../knowledge/types';
import type { Config } from '../utils/config';
import {
  createClaudeSessionStorageFromConfig,
  type ClaudeSessionEventRecord,
  type ClaudeSessionStorage,
} from './claude-session-store';

const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'that',
  'this',
  'into',
  'about',
  'your',
  'have',
  'been',
  'are',
  'for',
  'not',
  'was',
  'were',
  'can',
  'could',
  'would',
  'should',
  'will',
  'what',
  'when',
  'where',
  'how',
  'why',
  'incident',
  'investigate',
  'investigation',
  'session',
  'claude',
  'runbook',
]);

interface SessionEvidence {
  sessionId: string;
  events: ClaudeSessionEventRecord[];
  prompt: string | null;
  rootCause: string | null;
  services: string[];
  tools: string[];
  errors: string[];
  lastObservedAt: string;
}

export interface ClaudeSessionContextResult {
  contextBlock: string;
  knowledgeChunk: RetrievedChunk;
  selectedSessionIds: string[];
  selectedEventCount: number;
  inspectedSessionCount: number;
}

export interface ClaudeSessionContextSubagentOptions {
  projectDir?: string;
  maxSessionsToInspect?: number;
  maxSessionsToInclude?: number;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => item.toLowerCase());
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function buildSessionEvidence(
  sessionId: string,
  events: ClaudeSessionEventRecord[]
): SessionEvidence {
  let prompt: string | null = null;
  let rootCause: string | null = null;
  let lastObservedAt = '';
  const services = new Set<string>();
  const tools = new Set<string>();
  const errors = new Set<string>();

  for (const event of events) {
    if (!lastObservedAt || event.observedAt > lastObservedAt) {
      lastObservedAt = event.observedAt;
    }

    if (!prompt) {
      prompt = asString(event.payload.prompt);
    }

    if (!rootCause) {
      rootCause = asString(event.payload.root_cause) || asString(event.payload.rootCause);
    }

    const singleService = asString(event.payload.service);
    if (singleService) {
      services.add(singleService.toLowerCase());
    }
    for (const service of asStringArray(event.payload.services)) {
      services.add(service);
    }

    const toolName =
      asString(event.payload.tool_name) ||
      asString(event.payload.toolName) ||
      asString(event.payload.tool);
    if (toolName) {
      tools.add(toolName);
    }

    const error = asString(event.payload.error);
    if (error) {
      errors.add(error);
    }
  }

  return {
    sessionId,
    events,
    prompt,
    rootCause,
    services: Array.from(services),
    tools: Array.from(tools),
    errors: Array.from(errors),
    lastObservedAt,
  };
}

function scoreSessionEvidence(
  query: string,
  incidentId: string | undefined,
  evidence: SessionEvidence
): number {
  const queryTokens = new Set(tokenize([query, incidentId || ''].join(' ')));
  const textForSession = [
    evidence.sessionId,
    evidence.prompt || '',
    evidence.rootCause || '',
    evidence.services.join(' '),
    evidence.tools.join(' '),
    evidence.errors.join(' '),
  ].join(' ');
  const sessionTokens = tokenize(textForSession);

  let overlap = 0;
  for (const token of sessionTokens) {
    if (queryTokens.has(token)) {
      overlap++;
    }
  }

  let score = overlap;
  if (incidentId && evidence.sessionId.includes(incidentId)) {
    score += 5;
  }
  if (evidence.rootCause) {
    score += 1;
  }
  if (evidence.services.length > 0) {
    score += 1;
  }
  return score;
}

function summarizeSessionEvidence(evidence: SessionEvidence): string {
  const parts: string[] = [];
  if (evidence.prompt) {
    parts.push(`prompt="${evidence.prompt.replace(/\s+/g, ' ').slice(0, 120)}"`);
  }
  if (evidence.rootCause) {
    parts.push(`rootCause="${evidence.rootCause.replace(/\s+/g, ' ').slice(0, 100)}"`);
  }
  if (evidence.services.length > 0) {
    parts.push(`services=${evidence.services.slice(0, 4).join(', ')}`);
  }
  if (evidence.tools.length > 0) {
    parts.push(`tools=${evidence.tools.slice(0, 5).join(', ')}`);
  }
  if (evidence.errors.length > 0) {
    parts.push(`errors=${evidence.errors.length}`);
  }
  if (parts.length === 0) {
    parts.push('minimal metadata captured');
  }
  return parts.join(' | ');
}

function buildContextBlock(
  query: string,
  selectedEvidence: SessionEvidence[],
  totalInspectedSessions: number
): string {
  const lines: string[] = [];
  lines.push('## Claude Session Context (Auto-Discovered)');
  lines.push(
    `The session-context subagent scanned ${totalInspectedSessions} recent Claude session log(s) relevant to: ${query}`
  );
  lines.push('Use this as supplemental evidence and verify against live telemetry.');
  lines.push('');
  selectedEvidence.forEach((evidence, index) => {
    lines.push(
      `${index + 1}. Session ${evidence.sessionId} (${evidence.events.length} events, last ${evidence.lastObservedAt || 'unknown'}): ${summarizeSessionEvidence(evidence)}`
    );
  });
  return lines.join('\n');
}

function buildKnowledgeChunk(selectedEvidence: SessionEvidence[]): RetrievedChunk {
  const content = selectedEvidence
    .map((evidence) => {
      const lines = [`Session ${evidence.sessionId}:`];
      lines.push(`- ${summarizeSessionEvidence(evidence)}`);
      return lines.join('\n');
    })
    .join('\n\n');

  const services = Array.from(
    new Set(selectedEvidence.flatMap((evidence) => evidence.services).map((service) => service))
  );

  return {
    id: `claude-session-context-${Date.now()}`,
    documentId: 'claude-session-context',
    title: 'Recent Claude Session Learnings',
    content,
    type: 'known_issue',
    services,
    score: 0.99,
    sourceUrl: '.runbook/hooks/claude',
  };
}

export class ClaudeSessionContextSubagent {
  private readonly storage: ClaudeSessionStorage;
  private readonly maxSessionsToInspect: number;
  private readonly maxSessionsToInclude: number;

  constructor(config: Config, options: ClaudeSessionContextSubagentOptions = {}) {
    this.storage = createClaudeSessionStorageFromConfig(config, {
      projectDir: options.projectDir || process.cwd(),
    });
    this.maxSessionsToInspect = options.maxSessionsToInspect || 6;
    this.maxSessionsToInclude = options.maxSessionsToInclude || 2;
  }

  async collectRelevantContext(input: {
    query: string;
    incidentId?: string;
  }): Promise<ClaudeSessionContextResult | null> {
    const sessionIds = await this.storage.listRecentSessionIds(this.maxSessionsToInspect);
    if (sessionIds.length === 0) {
      return null;
    }

    const sessionEvents = await Promise.all(
      sessionIds.map(async (sessionId) => ({
        sessionId,
        events: await this.storage.getSessionEvents(sessionId),
      }))
    );

    const scored = sessionEvents
      .filter((item) => item.events.length > 0)
      .map((item) => {
        const evidence = buildSessionEvidence(item.sessionId, item.events);
        return {
          evidence,
          score: scoreSessionEvidence(input.query, input.incidentId, evidence),
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.evidence.lastObservedAt.localeCompare(a.evidence.lastObservedAt);
      });

    if (scored.length === 0) {
      return null;
    }

    const selected = scored.filter((item) => item.score > 0).slice(0, this.maxSessionsToInclude);
    const fallback = scored.slice(0, 1);
    const chosen = (selected.length > 0 ? selected : fallback).map((item) => item.evidence);

    const contextBlock = buildContextBlock(input.query, chosen, scored.length);
    const selectedEventCount = chosen.reduce((sum, evidence) => sum + evidence.events.length, 0);

    return {
      contextBlock,
      knowledgeChunk: buildKnowledgeChunk(chosen),
      selectedSessionIds: chosen.map((evidence) => evidence.sessionId),
      selectedEventCount,
      inspectedSessionCount: scored.length,
    };
  }
}
