import { existsSync, readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createClaudeSessionStorageFromConfig } from '../claude-session-store';
import { DEFAULT_CONFIG, type Config } from '../../utils/config';

function cloneConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

describe('claude-session-store', () => {
  it('persists and retrieves session events with local backend', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-session-store-local-'));
    const config = cloneConfig();
    config.integrations.claude.sessionStorage.backend = 'local';
    config.integrations.claude.sessionStorage.localBaseDir = '.runbook/hooks/claude';

    const storage = createClaudeSessionStorageFromConfig(config, { projectDir });
    const persisted = await storage.persistEvent(
      {
        observedAt: '2026-02-11T18:00:00.000Z',
        sessionId: 'sess-local-1',
        eventName: 'UserPromptSubmit',
        cwd: projectDir,
        transcriptPath: null,
        payload: {
          prompt: 'Investigate checkout latency',
        },
      },
      { prompt: 'Investigate checkout latency' }
    );

    expect(persisted.primary.backend).toBe('local');
    expect(existsSync(persisted.primary.eventsLocation)).toBe(true);
    expect(existsSync(join(projectDir, '.runbook', 'hooks', 'claude', 'latest.json'))).toBe(true);

    const lines = readFileSync(persisted.primary.eventsLocation, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines).toHaveLength(1);

    const events = await storage.getSessionEvents('sess-local-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe('UserPromptSubmit');
    expect(events[0].sessionId).toBe('sess-local-1');
  });

  it('rejects s3 backend when bucket is not configured', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-session-store-s3-'));
    const config = cloneConfig();
    config.integrations.claude.sessionStorage.backend = 's3';
    config.integrations.claude.sessionStorage.s3.bucket = undefined;

    expect(() => createClaudeSessionStorageFromConfig(config, { projectDir })).toThrow(
      /no bucket configured/i
    );
  });
});
