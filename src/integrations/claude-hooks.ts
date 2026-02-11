import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export type ClaudeSettingsScope = 'project' | 'user';

export type ClaudeHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'Notification';

interface ClaudeHookEventConfig {
  event: ClaudeHookEventName;
  matcher: string;
}

interface ClaudeHookEntry extends Record<string, unknown> {
  type?: string;
  command?: string;
}

interface ClaudeHookMatcher extends Record<string, unknown> {
  matcher: string;
  hooks: ClaudeHookEntry[];
}

export interface InstallClaudeHooksOptions {
  scope?: ClaudeSettingsScope;
  cwd?: string;
  homeDir?: string;
  runbookCommand?: string;
  includeNotifications?: boolean;
}

export interface InstallClaudeHooksResult {
  settingsPath: string;
  hookCommand: string;
  addedHooks: number;
  eventsUpdated: ClaudeHookEventName[];
}

export interface UninstallClaudeHooksOptions {
  scope?: ClaudeSettingsScope;
  cwd?: string;
  homeDir?: string;
  runbookCommand?: string;
}

export interface UninstallClaudeHooksResult {
  settingsPath: string;
  removedHooks: number;
  eventsUpdated: ClaudeHookEventName[];
}

export interface ClaudeHookStatusOptions {
  scope?: ClaudeSettingsScope;
  cwd?: string;
  homeDir?: string;
  runbookCommand?: string;
}

export interface ClaudeHookStatusResult {
  settingsPath: string;
  exists: boolean;
  installed: boolean;
  installedHooks: number;
  eventCounts: Partial<Record<ClaudeHookEventName, number>>;
}

export interface PersistClaudeHookEventOptions {
  projectDir?: string;
  now?: Date;
}

export interface PersistClaudeHookEventResult {
  baseDir: string;
  sessionDir: string;
  eventsFile: string;
  latestEventFile: string;
  sessionId: string;
  eventName: string;
}

export interface HandleClaudeHookStdinResult {
  handled: boolean;
  reason?: 'empty_stdin' | 'invalid_json' | 'persist_error';
  error?: string;
  persistence?: PersistClaudeHookEventResult;
}

const DEFAULT_EVENTS: ClaudeHookEventConfig[] = [
  { event: 'SessionStart', matcher: '' },
  { event: 'UserPromptSubmit', matcher: '' },
  { event: 'PreToolUse', matcher: '.*' },
  { event: 'PostToolUse', matcher: '.*' },
  { event: 'Stop', matcher: '' },
  { event: 'SubagentStop', matcher: '' },
  { event: 'PreCompact', matcher: '' },
];

const NOTIFICATION_EVENT: ClaudeHookEventConfig = { event: 'Notification', matcher: '.*' };

const CLAUDE_HOOK_COMMAND_SUFFIX = 'integrations claude hook';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimCommand(value: string | undefined): string {
  const fallback = 'runbook';
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildHookCommand(runbookCommand: string | undefined): string {
  return `${trimCommand(runbookCommand)} ${CLAUDE_HOOK_COMMAND_SUFFIX}`;
}

function isRunbookClaudeHookCommand(command: string, runbookCommand?: string): boolean {
  const expected = buildHookCommand(runbookCommand);
  if (command.trim() === expected) {
    return true;
  }
  return command.includes(` ${CLAUDE_HOOK_COMMAND_SUFFIX}`) || command.startsWith(expected);
}

function getEvents(options: { includeNotifications?: boolean }): ClaudeHookEventConfig[] {
  if (!options.includeNotifications) {
    return DEFAULT_EVENTS;
  }
  return [...DEFAULT_EVENTS, NOTIFICATION_EVENT];
}

function resolveProjectRoot(startDir: string): string {
  let current = resolve(startDir);

  while (!existsSync(join(current, '.git')) && !existsSync(join(current, '.claude'))) {
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir);
    }
    current = parent;
  }

  return current;
}

function getSettingsPath(options: {
  scope?: ClaudeSettingsScope;
  cwd?: string;
  homeDir?: string;
}): string {
  const scope = options.scope || 'project';
  if (scope === 'user') {
    return join(options.homeDir || homedir(), '.claude', 'settings.json');
  }
  const projectRoot = resolveProjectRoot(options.cwd || process.cwd());
  return join(projectRoot, '.claude', 'settings.json');
}

async function loadSettings(settingsPath: string): Promise<Record<string, unknown>> {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const content = await readFile(settingsPath, 'utf-8');
  if (content.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Claude settings.json must contain a JSON object');
  }
  return parsed;
}

async function writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

function readEventMatchers(
  hooks: Record<string, unknown>,
  event: ClaudeHookEventName
): ClaudeHookMatcher[] {
  const raw = hooks[event];
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: ClaudeHookMatcher[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const matcher = typeof item.matcher === 'string' ? item.matcher : '';
    const hooksRaw = Array.isArray(item.hooks) ? item.hooks : [];
    const entries: ClaudeHookEntry[] = [];
    for (const entry of hooksRaw) {
      if (isRecord(entry)) {
        entries.push({ ...entry });
      }
    }
    normalized.push({ ...item, matcher, hooks: entries });
  }
  return normalized;
}

function addCommandToMatchers(
  matchers: ClaudeHookMatcher[],
  matcherName: string,
  command: string
): { matchers: ClaudeHookMatcher[]; added: boolean } {
  for (let i = 0; i < matchers.length; i++) {
    if (matchers[i].matcher !== matcherName) {
      continue;
    }

    const alreadyExists = matchers[i].hooks.some((hook) => hook.command === command);
    if (alreadyExists) {
      return { matchers, added: false };
    }

    const next = [...matchers];
    next[i] = {
      ...next[i],
      hooks: [...next[i].hooks, { type: 'command', command }],
    };
    return { matchers: next, added: true };
  }

  return {
    matchers: [...matchers, { matcher: matcherName, hooks: [{ type: 'command', command }] }],
    added: true,
  };
}

function removeCommandFromMatchers(
  matchers: ClaudeHookMatcher[],
  runbookCommand?: string
): { matchers: ClaudeHookMatcher[]; removed: number } {
  const next: ClaudeHookMatcher[] = [];
  let removed = 0;

  for (const matcher of matchers) {
    const filteredHooks = matcher.hooks.filter((entry) => {
      const command = typeof entry.command === 'string' ? entry.command : '';
      const shouldRemove =
        command.length > 0 && isRunbookClaudeHookCommand(command, runbookCommand);
      if (shouldRemove) {
        removed++;
      }
      return !shouldRemove;
    });

    if (filteredHooks.length > 0) {
      next.push({ ...matcher, hooks: filteredHooks });
    }
  }

  return { matchers: next, removed };
}

function countCommands(
  matchers: ClaudeHookMatcher[],
  runbookCommand?: string
): { total: number; matching: number } {
  let total = 0;
  let matching = 0;
  for (const matcher of matchers) {
    for (const entry of matcher.hooks) {
      if (typeof entry.command !== 'string') {
        continue;
      }
      total++;
      if (isRunbookClaudeHookCommand(entry.command, runbookCommand)) {
        matching++;
      }
    }
  }
  return { total, matching };
}

export async function installClaudeHooks(
  options: InstallClaudeHooksOptions = {}
): Promise<InstallClaudeHooksResult> {
  const settingsPath = getSettingsPath(options);
  const hookCommand = buildHookCommand(options.runbookCommand);
  const settings = await loadSettings(settingsPath);
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const events = getEvents({ includeNotifications: options.includeNotifications });

  let addedHooks = 0;
  const eventsUpdated: ClaudeHookEventName[] = [];

  for (const config of events) {
    const matchers = readEventMatchers(hooks, config.event);
    const result = addCommandToMatchers(matchers, config.matcher, hookCommand);
    hooks[config.event] = result.matchers;
    if (result.added) {
      addedHooks++;
      eventsUpdated.push(config.event);
    }
  }

  if (addedHooks > 0 || !existsSync(settingsPath)) {
    settings.hooks = hooks;
    await writeSettings(settingsPath, settings);
  }

  return {
    settingsPath,
    hookCommand,
    addedHooks,
    eventsUpdated,
  };
}

export async function uninstallClaudeHooks(
  options: UninstallClaudeHooksOptions = {}
): Promise<UninstallClaudeHooksResult> {
  const settingsPath = getSettingsPath(options);
  if (!existsSync(settingsPath)) {
    return { settingsPath, removedHooks: 0, eventsUpdated: [] };
  }

  const settings = await loadSettings(settingsPath);
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const events = getEvents({ includeNotifications: true });

  let removedHooks = 0;
  const eventsUpdated: ClaudeHookEventName[] = [];

  for (const config of events) {
    const matchers = readEventMatchers(hooks, config.event);
    const result = removeCommandFromMatchers(matchers, options.runbookCommand);
    hooks[config.event] = result.matchers;
    if (result.removed > 0) {
      removedHooks += result.removed;
      eventsUpdated.push(config.event);
    }
  }

  if (removedHooks > 0) {
    settings.hooks = hooks;
    await writeSettings(settingsPath, settings);
  }

  return {
    settingsPath,
    removedHooks,
    eventsUpdated,
  };
}

export async function getClaudeHookStatus(
  options: ClaudeHookStatusOptions = {}
): Promise<ClaudeHookStatusResult> {
  const settingsPath = getSettingsPath(options);
  if (!existsSync(settingsPath)) {
    return {
      settingsPath,
      exists: false,
      installed: false,
      installedHooks: 0,
      eventCounts: {},
    };
  }

  const settings = await loadSettings(settingsPath);
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const events = getEvents({ includeNotifications: true });
  const eventCounts: Partial<Record<ClaudeHookEventName, number>> = {};
  let installedHooks = 0;

  for (const config of events) {
    const matchers = readEventMatchers(hooks, config.event);
    const { matching } = countCommands(matchers, options.runbookCommand);
    if (matching > 0) {
      eventCounts[config.event] = matching;
      installedHooks += matching;
    }
  }

  return {
    settingsPath,
    exists: true,
    installed: installedHooks > 0,
    installedHooks,
    eventCounts,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function persistClaudeHookEvent(
  payload: unknown,
  options: PersistClaudeHookEventOptions = {}
): Promise<PersistClaudeHookEventResult> {
  if (!isRecord(payload)) {
    throw new Error('Hook payload must be a JSON object');
  }

  const payloadCwd = asString(payload.cwd);
  const projectDir = resolveProjectRoot(options.projectDir || payloadCwd || process.cwd());
  const sessionId = asString(payload.session_id) || 'unknown-session';
  const eventName = asString(payload.hook_event_name) || 'UnknownEvent';
  const now = options.now || new Date();

  const baseDir = join(projectDir, '.runbook', 'hooks', 'claude');
  const sessionDir = join(baseDir, 'sessions', sanitizeSessionId(sessionId));
  const eventsFile = join(sessionDir, 'events.ndjson');
  const latestEventFile = join(baseDir, 'latest.json');

  await mkdir(sessionDir, { recursive: true });

  const eventRecord = {
    observedAt: now.toISOString(),
    sessionId,
    eventName,
    cwd: payloadCwd || projectDir,
    transcriptPath: asString(payload.transcript_path) || null,
    payload,
  };

  await appendFile(eventsFile, `${JSON.stringify(eventRecord)}\n`, 'utf-8');
  await writeFile(latestEventFile, `${JSON.stringify(eventRecord, null, 2)}\n`, 'utf-8');

  const prompt = asString(payload.prompt);
  if (prompt) {
    await writeFile(join(sessionDir, 'last-prompt.txt'), `${prompt}\n`, 'utf-8');
  }

  return {
    baseDir,
    sessionDir,
    eventsFile,
    latestEventFile,
    sessionId,
    eventName,
  };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function handleClaudeHookStdin(
  options: PersistClaudeHookEventOptions = {}
): Promise<HandleClaudeHookStdinResult> {
  const input = await readStdin();
  if (input.trim().length === 0) {
    return { handled: false, reason: 'empty_stdin' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch (error) {
    return {
      handled: false,
      reason: 'invalid_json',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const persistence = await persistClaudeHookEvent(payload, options);
    return { handled: true, persistence };
  } catch (error) {
    return {
      handled: false,
      reason: 'persist_error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
