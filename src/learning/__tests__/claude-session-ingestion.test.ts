import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  convertClaudeSessionToLearningEvents,
  runLearningLoopFromClaudeSession,
  synthesizeInvestigationResultFromClaudeSession,
} from '../claude-session-ingestion';
import type { ClaudeSessionEventRecord } from '../../integrations/claude-session-store';

function buildDraftResponse(): string {
  return JSON.stringify({
    postmortem: {
      title: 'Checkout incident from Claude session',
      severity: 'sev2',
      summary: 'Checkout failures were diagnosed from collected evidence.',
      impact: 'Users experienced checkout errors.',
      detection: 'Detected by synthetic checks and on-call triage.',
      rootCause: 'DB pool saturation',
      contributingFactors: ['Missing pool saturation alerts'],
      timeline: [
        { timestamp: '2026-02-11T08:00:00Z', event: 'Session started', evidence: 'session' },
        { timestamp: '2026-02-11T08:03:00Z', event: 'Prompt submitted', evidence: 'prompt' },
        { timestamp: '2026-02-11T08:10:00Z', event: 'Investigation ended', evidence: 'stop' },
      ],
      whatWentWell: ['Rapid timeline reconstruction'],
      whatDidntGoWell: ['Telemetry context needed manual correlation'],
      actionItems: [
        {
          title: 'Add DB pool saturation monitor',
          ownerRole: 'sre-oncall',
          priority: 'P1',
          dueInDays: 7,
          category: 'detection',
          details: 'Alert when checkout DB pool utilization exceeds threshold.',
        },
      ],
      confidenceNotes: 'Derived from prompt/tool sequence in session logs.',
    },
    knowledgeSuggestions: [],
  });
}

function buildSessionEvents(): ClaudeSessionEventRecord[] {
  return [
    {
      observedAt: '2026-02-11T08:00:00.000Z',
      sessionId: 'sess-abc',
      eventName: 'SessionStart',
      cwd: '/tmp/project',
      transcriptPath: null,
      payload: {},
    },
    {
      observedAt: '2026-02-11T08:03:00.000Z',
      sessionId: 'sess-abc',
      eventName: 'UserPromptSubmit',
      cwd: '/tmp/project',
      transcriptPath: null,
      payload: {
        prompt: 'Investigate checkout API failures caused by DB pool exhaustion',
        service: 'checkout-api',
      },
    },
    {
      observedAt: '2026-02-11T08:10:00.000Z',
      sessionId: 'sess-abc',
      eventName: 'Stop',
      cwd: '/tmp/project',
      transcriptPath: null,
      payload: {
        root_cause: 'DB pool saturation',
      },
    },
  ];
}

describe('claude session learning ingestion', () => {
  it('converts Claude session records into learning events', () => {
    const events = convertClaudeSessionToLearningEvents(buildSessionEvents());
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('claude_sessionstart');
    expect(events[1].summary).toContain('prompt=');
  });

  it('synthesizes investigation metadata from session records', () => {
    const result = synthesizeInvestigationResultFromClaudeSession({
      sessionId: 'sess-abc',
      sessionEvents: buildSessionEvents(),
    });

    expect(result.query).toContain('Investigate checkout API failures');
    expect(result.rootCause).toBe('DB pool saturation');
    expect(result.affectedServices).toContain('checkout-api');
    expect(result.confidence).toBe('low');
  });

  it('runs learning loop directly from Claude session events', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'runbook-learning-from-session-'));
    const output = await runLearningLoopFromClaudeSession({
      sessionId: 'sess-abc',
      sessionEvents: buildSessionEvents(),
      incidentId: 'PD-2026',
      baseDir,
      complete: async () => buildDraftResponse(),
    });

    expect(output.postmortemPath).toContain('postmortem-pd-2026.md');
    const postmortem = await readFile(output.postmortemPath, 'utf-8');
    expect(postmortem).toContain('Checkout incident from Claude session');
    expect(postmortem).toContain('DB pool saturation');
  });
});
