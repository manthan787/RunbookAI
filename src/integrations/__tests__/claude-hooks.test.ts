import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getClaudeHookStatus,
  installClaudeHooks,
  persistClaudeHookEvent,
  uninstallClaudeHooks,
} from '../claude-hooks';

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function getCommandsForEvent(
  settings: Record<string, unknown>,
  event: string
): Array<{ matcher: string; command: string }> {
  const hooks = settings.hooks as Record<string, unknown>;
  const eventMatchers = hooks?.[event];
  if (!Array.isArray(eventMatchers)) {
    return [];
  }

  const commands: Array<{ matcher: string; command: string }> = [];
  for (const matcherEntry of eventMatchers) {
    const matcherObj = matcherEntry as Record<string, unknown>;
    const matcher = typeof matcherObj.matcher === 'string' ? matcherObj.matcher : '';
    const hooksForMatcher = matcherObj.hooks;
    if (!Array.isArray(hooksForMatcher)) {
      continue;
    }
    for (const hook of hooksForMatcher) {
      const hookObj = hook as Record<string, unknown>;
      if (typeof hookObj.command === 'string') {
        commands.push({ matcher, command: hookObj.command });
      }
    }
  }

  return commands;
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'runbook-claude-hooks-'));
}

describe('claude-hooks integration', () => {
  it('installs Claude hooks into project settings.json', async () => {
    const root = createTempDir();
    const result = await installClaudeHooks({
      cwd: root,
      runbookCommand: 'runbook',
    });

    expect(result.addedHooks).toBe(7);
    expect(result.eventsUpdated).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SubagentStop',
      'PreCompact',
    ]);
    expect(existsSync(result.settingsPath)).toBe(true);

    const settings = readJson(result.settingsPath);
    const command = 'runbook integrations claude hook';

    expect(getCommandsForEvent(settings, 'SessionStart')).toContainEqual({ matcher: '', command });
    expect(getCommandsForEvent(settings, 'UserPromptSubmit')).toContainEqual({
      matcher: '',
      command,
    });
    expect(getCommandsForEvent(settings, 'PreToolUse')).toContainEqual({
      matcher: '.*',
      command,
    });
    expect(getCommandsForEvent(settings, 'PostToolUse')).toContainEqual({
      matcher: '.*',
      command,
    });
    expect(getCommandsForEvent(settings, 'Stop')).toContainEqual({ matcher: '', command });
    expect(getCommandsForEvent(settings, 'SubagentStop')).toContainEqual({
      matcher: '',
      command,
    });
    expect(getCommandsForEvent(settings, 'PreCompact')).toContainEqual({ matcher: '', command });
  });

  it('is idempotent when run repeatedly', async () => {
    const root = createTempDir();

    const first = await installClaudeHooks({
      cwd: root,
      runbookCommand: 'runbook',
    });
    const second = await installClaudeHooks({
      cwd: root,
      runbookCommand: 'runbook',
    });

    expect(first.addedHooks).toBe(7);
    expect(second.addedHooks).toBe(0);

    const settings = readJson(first.settingsPath);
    const allCommands = [
      ...getCommandsForEvent(settings, 'SessionStart'),
      ...getCommandsForEvent(settings, 'UserPromptSubmit'),
      ...getCommandsForEvent(settings, 'PreToolUse'),
      ...getCommandsForEvent(settings, 'PostToolUse'),
      ...getCommandsForEvent(settings, 'Stop'),
      ...getCommandsForEvent(settings, 'SubagentStop'),
      ...getCommandsForEvent(settings, 'PreCompact'),
    ].filter((item) => item.command === 'runbook integrations claude hook');

    expect(allCommands).toHaveLength(7);
  });

  it('preserves existing user hooks and removes only runbook hooks on uninstall', async () => {
    const root = createTempDir();
    const claudeDir = join(root, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');

    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: '',
                hooks: [{ type: 'command', command: 'echo "user stop hook"' }],
              },
            ],
          },
        },
        null,
        2
      )
    );

    await installClaudeHooks({ cwd: root, runbookCommand: 'runbook' });

    const installed = readJson(settingsPath);
    expect(getCommandsForEvent(installed, 'Stop')).toContainEqual({
      matcher: '',
      command: 'echo "user stop hook"',
    });
    expect(getCommandsForEvent(installed, 'Stop')).toContainEqual({
      matcher: '',
      command: 'runbook integrations claude hook',
    });

    const removed = await uninstallClaudeHooks({ cwd: root, runbookCommand: 'runbook' });
    expect(removed.removedHooks).toBeGreaterThan(0);

    const afterUninstall = readJson(settingsPath);
    const stopCommands = getCommandsForEvent(afterUninstall, 'Stop');
    expect(stopCommands).toContainEqual({ matcher: '', command: 'echo "user stop hook"' });
    expect(stopCommands.some((item) => item.command === 'runbook integrations claude hook')).toBe(
      false
    );
  });

  it('reports hook status accurately', async () => {
    const root = createTempDir();
    const before = await getClaudeHookStatus({ cwd: root, runbookCommand: 'runbook' });
    expect(before.exists).toBe(false);
    expect(before.installed).toBe(false);

    await installClaudeHooks({ cwd: root, runbookCommand: 'runbook' });
    const after = await getClaudeHookStatus({ cwd: root, runbookCommand: 'runbook' });

    expect(after.exists).toBe(true);
    expect(after.installed).toBe(true);
    expect(after.installedHooks).toBe(7);
    expect(after.eventCounts.SessionStart).toBe(1);
    expect(after.eventCounts.Stop).toBe(1);
  });

  it('persists hook payloads as NDJSON artifacts', async () => {
    const root = createTempDir();

    const saved = await persistClaudeHookEvent(
      {
        session_id: 'sess-123',
        hook_event_name: 'UserPromptSubmit',
        cwd: root,
        transcript_path: '/tmp/transcript.jsonl',
        prompt: 'Investigate checkout latency spike',
      },
      { now: new Date('2026-02-11T12:00:00.000Z') }
    );

    expect(existsSync(saved.eventsFile)).toBe(true);
    expect(existsSync(saved.latestEventFile)).toBe(true);
    expect(existsSync(join(saved.sessionDir, 'last-prompt.txt'))).toBe(true);

    const lines = readFileSync(saved.eventsFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(event.eventName).toBe('UserPromptSubmit');
    expect(event.sessionId).toBe('sess-123');
    expect(event.observedAt).toBe('2026-02-11T12:00:00.000Z');
  });
});
