import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { runLearningLoop } from '../loop';
import type { InvestigationResult } from '../../agent/investigation-orchestrator';

function buildResult(id: string): InvestigationResult {
  return {
    id,
    query: `Investigate ${id}`,
    rootCause: 'Checkout API timed out due to DB connection exhaustion',
    confidence: 'high',
    affectedServices: ['checkout-api'],
    summary: 'Checkout API had elevated errors caused by exhausted DB connections.',
    remediationPlan: {
      steps: [],
      monitoring: [],
    },
    durationMs: 1200,
  };
}

function buildDraftResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    postmortem: {
      title: 'Checkout API timeout incident',
      severity: 'sev2',
      summary: 'Checkout API experienced elevated timeout failures.',
      impact: 'Users could not complete checkout for 14 minutes.',
      detection: 'PagerDuty alert fired on checkout error budget burn.',
      rootCause: 'DB pool exhaustion in checkout-api',
      contributingFactors: ['No active pool saturation alert'],
      timeline: [
        { timestamp: '2026-02-10T08:00:00Z', event: 'Alert fired', evidence: 'pagerduty' },
        { timestamp: '2026-02-10T08:03:00Z', event: 'Error rate confirmed', evidence: 'logs' },
        { timestamp: '2026-02-10T08:10:00Z', event: 'Rollback reduced errors', evidence: 'deploy' },
      ],
      whatWentWell: ['Investigation identified root cause quickly'],
      whatDidntGoWell: ['Runbook lacked DB pool saturation checks'],
      actionItems: [
        {
          title: 'Add DB saturation monitor for checkout-api',
          ownerRole: 'sre-oncall',
          priority: 'P1',
          dueInDays: 7,
          category: 'detection',
          details: 'Create monitor with paging threshold and runbook link.',
        },
      ],
      confidenceNotes: 'High confidence from correlated metrics and rollback signal.',
    },
    knowledgeSuggestions: [],
    ...overrides,
  });
}

describe('runLearningLoop', () => {
  it('creates update proposals when auto-apply is disabled', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'runbook-learning-propose-'));
    const runbookDir = join(baseDir, 'runbooks');
    const runbookPath = join(runbookDir, 'checkout-recovery.md');
    await mkdir(runbookDir, { recursive: true });
    await writeFile(
      runbookPath,
      `---
type: runbook
title: Checkout API Recovery
services:
  - checkout-api
---

# Checkout API Recovery

## Existing Guidance
- Restart service if downstream is healthy.
`,
      'utf-8'
    );

    const output = await runLearningLoop({
      result: buildResult('inv_test_proposal'),
      incidentId: 'PD-123',
      query: 'Investigate incident PD-123',
      events: [
        {
          timestamp: '2026-02-10T08:00:00Z',
          type: 'triage_complete',
          summary: 'Checkout API elevated latency and timeout alerts.',
        },
      ],
      baseDir,
      applyRunbookUpdates: false,
      complete: async () =>
        buildDraftResponse({
          knowledgeSuggestions: [
            {
              type: 'update_runbook',
              title: 'Add DB pool saturation validation',
              targetRunbookTitle: 'Checkout API Recovery',
              services: ['checkout-api'],
              reasoning: 'Current runbook omits pool exhaustion diagnosis.',
              contentMarkdown:
                '### DB Pool Saturation Check\n1. Query pool utilization metrics.\n2. Validate max connection settings.',
              confidence: 0.92,
            },
          ],
        }),
    });

    const runbookAfter = await readFile(runbookPath, 'utf-8');
    expect(runbookAfter).not.toContain('Incident Learnings');
    expect(output.appliedRunbookUpdates).toHaveLength(0);
    expect(output.proposedRunbookUpdates.length).toBeGreaterThanOrEqual(1);

    const proposalContent = await readFile(output.proposedRunbookUpdates[0], 'utf-8');
    expect(proposalContent).toContain('Runbook Update Proposal');
    expect(proposalContent).toContain('Checkout API Recovery');
  });

  it('applies update suggestions directly to local runbooks in apply mode', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'runbook-learning-apply-'));
    const runbookDir = join(baseDir, 'runbooks');
    const runbookPath = join(runbookDir, 'checkout-recovery.md');
    await mkdir(runbookDir, { recursive: true });
    await writeFile(
      runbookPath,
      `---
type: runbook
title: Checkout API Recovery
services:
  - checkout-api
---

# Checkout API Recovery

## Existing Guidance
- Restart service if downstream is healthy.
`,
      'utf-8'
    );

    const output = await runLearningLoop({
      result: buildResult('inv_test_apply'),
      incidentId: 'PD-456',
      query: 'Investigate incident PD-456',
      events: [
        {
          timestamp: '2026-02-10T08:00:00Z',
          type: 'conclusion_reached',
          summary: 'DB pool exhaustion identified as root cause.',
        },
      ],
      baseDir,
      applyRunbookUpdates: true,
      complete: async () =>
        buildDraftResponse({
          knowledgeSuggestions: [
            {
              type: 'update_runbook',
              title: 'Add DB pool saturation validation',
              targetRunbookTitle: 'Checkout API Recovery',
              services: ['checkout-api'],
              reasoning: 'Current runbook omits pool exhaustion diagnosis.',
              contentMarkdown:
                '### DB Pool Saturation Check\n1. Query pool utilization metrics.\n2. Validate max connection settings.',
              confidence: 0.95,
            },
          ],
        }),
    });

    const runbookAfter = await readFile(runbookPath, 'utf-8');
    expect(runbookAfter).toContain('Incident Learnings (PD-456)');
    expect(output.appliedRunbookUpdates).toContain(runbookPath);
    expect(output.proposedRunbookUpdates).toHaveLength(0);
  });

  it('creates new runbook proposal when suggestion is new_runbook', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'runbook-learning-new-runbook-'));
    await mkdir(join(baseDir, 'runbooks'), { recursive: true });

    const output = await runLearningLoop({
      result: buildResult('inv_test_new_runbook'),
      incidentId: 'PD-789',
      query: 'Investigate incident PD-789',
      events: [
        {
          timestamp: '2026-02-10T08:00:00Z',
          type: 'remediation_step',
          summary: 'Manual mitigation recovered service quickly.',
        },
      ],
      baseDir,
      applyRunbookUpdates: false,
      complete: async () =>
        buildDraftResponse({
          knowledgeSuggestions: [
            {
              type: 'new_runbook',
              title: 'Checkout DB Pool Exhaustion Mitigation',
              services: ['checkout-api', 'postgres'],
              reasoning: 'No dedicated runbook exists for this failure mode.',
              contentMarkdown: '# Checkout DB Pool Exhaustion\n\n## Mitigation\n- Scale read replicas.',
              confidence: 0.88,
            },
          ],
        }),
    });

    expect(output.proposedKnowledgeDocs.length).toBeGreaterThanOrEqual(1);
    const docContent = await readFile(output.proposedKnowledgeDocs[0], 'utf-8');
    expect(docContent).toContain('type: runbook');
    expect(docContent).toContain('Checkout DB Pool Exhaustion');
  });
});
