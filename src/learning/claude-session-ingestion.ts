import type { InvestigationResult } from '../agent/investigation-orchestrator';
import type { ClaudeSessionEventRecord } from '../integrations/claude-session-store';
import { runLearningLoop, type LearningEvent, type LearningLoopOutput } from './loop';

export interface ClaudeSessionLearningInput {
  sessionId: string;
  sessionEvents: ClaudeSessionEventRecord[];
  complete: (prompt: string) => Promise<string>;
  incidentId?: string;
  query?: string;
  baseDir?: string;
  applyRunbookUpdates?: boolean;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function describeEvent(event: ClaudeSessionEventRecord): string {
  const details: string[] = [];
  const prompt = asString(event.payload.prompt);
  if (prompt) {
    details.push(`prompt="${truncate(prompt.replace(/\s+/g, ' '), 140)}"`);
  }

  const toolName =
    asString(event.payload.tool_name) ||
    asString(event.payload.toolName) ||
    asString(event.payload.tool);
  if (toolName) {
    details.push(`tool=${toolName}`);
  }

  const status = asString(event.payload.status);
  if (status) {
    details.push(`status=${status}`);
  }

  const errorMessage = asString(event.payload.error);
  if (errorMessage) {
    details.push(`error="${truncate(errorMessage, 120)}"`);
  }

  if (details.length === 0) {
    return `Claude event ${event.eventName}`;
  }

  return `Claude ${event.eventName}: ${details.join(' | ')}`;
}

export function convertClaudeSessionToLearningEvents(
  sessionEvents: ClaudeSessionEventRecord[]
): LearningEvent[] {
  const sorted = [...sessionEvents].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return sorted.map((event) => ({
    timestamp: event.observedAt,
    phase: event.eventName.includes('Tool')
      ? 'tool'
      : event.eventName === 'Stop' || event.eventName === 'SubagentStop'
        ? 'conclude'
        : 'investigate',
    type: `claude_${event.eventName.toLowerCase()}`,
    summary: describeEvent(event),
    details: {
      sessionId: event.sessionId,
      eventName: event.eventName,
      transcriptPath: event.transcriptPath,
    },
  }));
}

function inferQuery(sessionEvents: ClaudeSessionEventRecord[], fallback: string): string {
  for (const event of sessionEvents) {
    const prompt = asString(event.payload.prompt);
    if (prompt) {
      return prompt;
    }
  }
  return fallback;
}

function inferAffectedServices(sessionEvents: ClaudeSessionEventRecord[]): string[] {
  const services = new Set<string>();
  for (const event of sessionEvents) {
    const service = asString(event.payload.service);
    if (service) {
      services.add(service.toLowerCase());
    }
    const serviceList = asStringArray(event.payload.services);
    for (const item of serviceList) {
      services.add(item);
    }
  }
  return Array.from(services);
}

function inferRootCause(sessionEvents: ClaudeSessionEventRecord[]): string | undefined {
  for (let i = sessionEvents.length - 1; i >= 0; i--) {
    const payload = sessionEvents[i].payload;
    const direct = asString(payload.root_cause) || asString(payload.rootCause);
    if (direct) {
      return direct;
    }
  }
  return undefined;
}

function inferDurationMs(sessionEvents: ClaudeSessionEventRecord[]): number {
  if (sessionEvents.length < 2) {
    return 0;
  }
  const first = new Date(sessionEvents[0].observedAt).getTime();
  const last = new Date(sessionEvents[sessionEvents.length - 1].observedAt).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) {
    return 0;
  }
  return last - first;
}

export function synthesizeInvestigationResultFromClaudeSession(input: {
  sessionId: string;
  sessionEvents: ClaudeSessionEventRecord[];
  query?: string;
}): InvestigationResult {
  const fallbackQuery = `Analyze Claude session ${input.sessionId} and generate incident learnings.`;
  const query = input.query || inferQuery(input.sessionEvents, fallbackQuery);
  const affectedServices = inferAffectedServices(input.sessionEvents);
  const rootCause = inferRootCause(input.sessionEvents);
  const eventCount = input.sessionEvents.length;

  return {
    id: `claude-${input.sessionId}`,
    query,
    rootCause,
    affectedServices,
    confidence: eventCount >= 8 ? 'medium' : 'low',
    remediationPlan: {
      steps: [],
      monitoring: [],
    },
    summary: `Synthesized from Claude session ${input.sessionId} (${eventCount} captured hook events).`,
    durationMs: inferDurationMs(input.sessionEvents),
  };
}

export async function runLearningLoopFromClaudeSession(
  input: ClaudeSessionLearningInput
): Promise<LearningLoopOutput> {
  const investigationResult = synthesizeInvestigationResultFromClaudeSession({
    sessionId: input.sessionId,
    sessionEvents: input.sessionEvents,
    query: input.query,
  });
  const learningEvents = convertClaudeSessionToLearningEvents(input.sessionEvents);

  return runLearningLoop({
    result: investigationResult,
    incidentId: input.incidentId || input.sessionId,
    query: investigationResult.query,
    events: learningEvents,
    complete: input.complete,
    baseDir: input.baseDir,
    applyRunbookUpdates: input.applyRunbookUpdates,
  });
}
