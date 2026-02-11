import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../../utils/config';
import { createClaudeSessionStorageFromConfig } from '../claude-session-store';
import { ClaudeSessionContextSubagent } from '../claude-session-context-subagent';

function cloneConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

describe('claude-session-context-subagent', () => {
  it('selects relevant sessions and builds context + knowledge chunk', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-session-subagent-'));
    const config = cloneConfig();
    config.integrations.claude.sessionStorage.backend = 'local';
    const storage = createClaudeSessionStorageFromConfig(config, { projectDir });

    await storage.persistEvent({
      observedAt: '2026-02-11T12:00:00.000Z',
      sessionId: 'sess-checkout',
      eventName: 'UserPromptSubmit',
      cwd: projectDir,
      transcriptPath: null,
      payload: {
        prompt: 'Investigate checkout latency spikes caused by DB pool saturation',
        service: 'checkout-api',
      },
    });

    await storage.persistEvent({
      observedAt: '2026-02-11T10:00:00.000Z',
      sessionId: 'sess-unrelated',
      eventName: 'UserPromptSubmit',
      cwd: projectDir,
      transcriptPath: null,
      payload: {
        prompt: 'Investigate kafka consumer lag',
        service: 'fulfillment-worker',
      },
    });

    const subagent = new ClaudeSessionContextSubagent(config, {
      projectDir,
      maxSessionsToInspect: 4,
      maxSessionsToInclude: 2,
    });

    const context = await subagent.collectRelevantContext({
      query: 'Checkout API is timing out due to database pool saturation',
      incidentId: 'PD-777',
    });

    expect(context).not.toBeNull();
    expect(context?.contextBlock).toContain('Claude Session Context (Auto-Discovered)');
    expect(context?.selectedSessionIds).toContain('sess-checkout');
    expect(context?.knowledgeChunk.type).toBe('known_issue');
    expect(context?.knowledgeChunk.content).toContain('checkout');
  });
});
