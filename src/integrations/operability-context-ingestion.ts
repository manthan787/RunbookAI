import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import { promisify } from 'util';
import type {
  AgentChangeClaim,
  AgentKind,
  ChangeRiskLevel,
  ChangeSessionReference,
} from '../providers/operability-context/types';
import type { Config } from '../utils/config';

const execFileAsync = promisify(execFile);

export type OperabilityIngestionStage = 'start' | 'checkpoint' | 'end';

export interface OperabilityHookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  service?: string;
  services?: string[];
  risk?: string;
  checkpoint_id?: string;
  [key: string]: unknown;
}

interface OperabilitySpoolEntry {
  id: string;
  stage: OperabilityIngestionStage;
  endpoint: string;
  claim: AgentChangeClaim;
  createdAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface OperabilityDispatchResult {
  status: 'sent' | 'queued' | 'skipped';
  stage: OperabilityIngestionStage;
  endpoint?: string;
  error?: string;
  queueFile?: string;
}

export interface OperabilityReplayResult {
  processed: number;
  sent: number;
  failed: number;
  remaining: number;
}

export interface OperabilityQueueStatus {
  enabled: boolean;
  pending: number;
  spoolDir: string;
}

export interface OperabilityIngestionClientOptions {
  projectDir?: string;
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
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

function normalizeList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.toLowerCase())
    )
  );
}

function parseRisk(value: unknown): ChangeRiskLevel | undefined {
  const parsed = asString(value)?.toLowerCase();
  if (parsed === 'low' || parsed === 'medium' || parsed === 'high' || parsed === 'critical') {
    return parsed;
  }
  return undefined;
}

function resolveProviderConfig(config: Config): {
  enabled: boolean;
  adapter: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  requestHeaders: Record<string, string>;
} {
  const provider = config.providers.operabilityContext;
  return {
    enabled: provider.enabled,
    adapter: provider.adapter,
    baseUrl: (provider.baseUrl || process.env.RUNBOOK_OPERABILITY_CONTEXT_URL || '').trim(),
    apiKey: (provider.apiKey || process.env.RUNBOOK_OPERABILITY_CONTEXT_API_KEY || '').trim(),
    timeoutMs: provider.timeoutMs,
    requestHeaders: provider.requestHeaders || {},
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function resolveGitContext(cwd: string): Promise<{
  repository: string;
  branch: string;
  headSha?: string;
  baseSha?: string;
}> {
  const root = (await tryGit(cwd, ['rev-parse', '--show-toplevel'])) || cwd;
  const branch = (await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'unknown';
  const headSha = (await tryGit(cwd, ['rev-parse', 'HEAD'])) || undefined;
  const baseSha = (await tryGit(cwd, ['rev-parse', 'HEAD~1'])) || headSha;

  return {
    repository: basename(root),
    branch,
    headSha,
    baseSha,
  };
}

function collectPotentialFilePaths(value: unknown, collected: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (
      trimmed.includes('/') ||
      trimmed.endsWith('.ts') ||
      trimmed.endsWith('.tsx') ||
      trimmed.endsWith('.js') ||
      trimmed.endsWith('.jsx') ||
      trimmed.endsWith('.py') ||
      trimmed.endsWith('.go') ||
      trimmed.endsWith('.rb')
    ) {
      collected.add(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPotentialFilePaths(item, collected);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('file') ||
      lower.includes('path') ||
      lower === 'target' ||
      lower === 'targets'
    ) {
      collectPotentialFilePaths(nestedValue, collected);
      continue;
    }
    if (lower === 'command') {
      const cmd = asString(nestedValue);
      if (cmd) {
        const tokens = cmd.split(/\s+/);
        for (const token of tokens) {
          if (token.includes('/') && extname(token)) {
            collected.add(token.replace(/^["']|["']$/g, ''));
          }
        }
      }
    }
    collectPotentialFilePaths(nestedValue, collected);
  }
}

function inferStageFromHookEvent(eventName: string): OperabilityIngestionStage | null {
  const normalized = eventName.trim();
  if (!normalized) return null;
  if (normalized === 'SessionStart') return 'start';
  if (normalized === 'Stop' || normalized === 'SubagentStop') return 'end';
  if (
    normalized === 'UserPromptSubmit' ||
    normalized === 'PreToolUse' ||
    normalized === 'PostToolUse' ||
    normalized === 'PreCompact' ||
    normalized === 'Notification'
  ) {
    return 'checkpoint';
  }
  return null;
}

function extractPrompt(payload: OperabilityHookPayload): string | undefined {
  return asString(payload.prompt);
}

function extractServices(payload: OperabilityHookPayload): string[] {
  const services = new Set<string>();

  const direct = asString(payload.service);
  if (direct) services.add(direct.toLowerCase());

  for (const service of asStringArray(payload.services)) {
    services.add(service.toLowerCase());
  }

  const prompt = asString(payload.prompt);
  if (prompt) {
    const pattern = /(\w+)(?:-service|-api|-worker|-gateway)\b/gi;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(prompt)) !== null) {
      services.add(match[1].toLowerCase());
    }
  }

  return Array.from(services);
}

function extractTests(payload: OperabilityHookPayload): string[] {
  const tests: string[] = [];
  const toolInput = payload.tool_input || {};
  const command = asString((toolInput as Record<string, unknown>).command);
  if (command && /\b(test|pytest|vitest|jest|bun test|npm run test)\b/i.test(command)) {
    tests.push(command);
  }
  return tests;
}

export async function buildSessionReferenceFromOptions(input: {
  sessionId: string;
  agent?: AgentKind;
  repository?: string;
  branch?: string;
  baseSha?: string;
  headSha?: string;
  actor?: string;
  startedAt?: string;
  cwd?: string;
}): Promise<ChangeSessionReference> {
  const cwd = resolve(input.cwd || process.cwd());
  const git = await resolveGitContext(cwd);

  return {
    sessionId: input.sessionId,
    agent: input.agent || 'custom',
    repository: input.repository || git.repository || basename(cwd),
    branch: input.branch || git.branch || 'unknown',
    baseSha: input.baseSha || git.baseSha || git.headSha || 'unknown',
    headSha: input.headSha || git.headSha,
    startedAt: input.startedAt || new Date().toISOString(),
    actor: input.actor,
  };
}

export async function buildClaimFromClaudeHookPayload(input: {
  payload: OperabilityHookPayload;
  sessionAgent?: AgentKind;
  cwd?: string;
}): Promise<{ stage: OperabilityIngestionStage; claim: AgentChangeClaim } | null> {
  const eventName = asString(input.payload.hook_event_name);
  const sessionId = asString(input.payload.session_id);
  if (!eventName || !sessionId) {
    return null;
  }

  const stage = inferStageFromHookEvent(eventName);
  if (!stage) {
    return null;
  }

  const cwd = resolve(asString(input.payload.cwd) || input.cwd || process.cwd());
  const session = await buildSessionReferenceFromOptions({
    sessionId,
    agent: input.sessionAgent || 'claude',
    cwd,
  });

  const fileCandidates = new Set<string>();
  collectPotentialFilePaths(input.payload.tool_input, fileCandidates);
  collectPotentialFilePaths(input.payload.tool_result, fileCandidates);

  const prompt = extractPrompt(input.payload);
  const toolName = asString(input.payload.tool_name);
  const testsRunClaimed = extractTests(input.payload);
  const servicesClaimed = extractServices(input.payload);

  const claim: AgentChangeClaim = {
    session,
    capturedAt: new Date().toISOString(),
    checkpointId: asString(input.payload.checkpoint_id),
    intentSummary: prompt || undefined,
    filesTouchedClaimed: normalizeList(Array.from(fileCandidates)),
    servicesClaimed: normalizeList(servicesClaimed),
    riskClaimed: parseRisk(input.payload.risk),
    testsRunClaimed: testsRunClaimed,
    unknowns: [],
    metadata: {
      hookEventName: eventName,
      toolName,
    },
  };

  return { stage, claim };
}

export class OperabilityContextIngestionClient {
  private readonly enabled: boolean;
  private readonly adapter: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly requestHeaders: Record<string, string>;
  private readonly spoolDir: string;

  constructor(config: Config, options: OperabilityIngestionClientOptions = {}) {
    const provider = resolveProviderConfig(config);
    const projectDir = resolve(options.projectDir || process.cwd());
    this.enabled = provider.enabled;
    this.adapter = provider.adapter;
    this.baseUrl = normalizeBaseUrl(provider.baseUrl);
    this.apiKey = provider.apiKey;
    this.timeoutMs = provider.timeoutMs;
    this.requestHeaders = provider.requestHeaders;
    this.spoolDir = join(projectDir, '.runbook', 'operability-context', 'spool');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getQueueStatus(): Promise<OperabilityQueueStatus> {
    const pending = await this.countSpoolEntries();
    return {
      enabled: this.enabled,
      pending,
      spoolDir: this.spoolDir,
    };
  }

  async ingest(
    stage: OperabilityIngestionStage,
    claim: AgentChangeClaim,
    options: { strict?: boolean } = {}
  ): Promise<OperabilityDispatchResult> {
    if (!this.enabled) {
      return {
        status: 'skipped',
        stage,
        error: 'providers.operabilityContext.enabled is false',
      };
    }

    if (!this.baseUrl) {
      const error = 'providers.operabilityContext.baseUrl is not configured';
      if (options.strict) {
        throw new Error(error);
      }
      const queueFile = await this.enqueue(stage, claim, `${error}; queued locally`);
      return { status: 'queued', stage, error, queueFile };
    }

    const endpoint = `${this.baseUrl}/v1/ingest/change-session/${stage}`;
    try {
      await this.sendRequest(endpoint, {
        adapter: this.adapter,
        stage,
        claim,
      });
      return {
        status: 'sent',
        stage,
        endpoint,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.strict) {
        throw error;
      }
      const queueFile = await this.enqueue(stage, claim, message, endpoint);
      return {
        status: 'queued',
        stage,
        endpoint,
        error: message,
        queueFile,
      };
    }
  }

  async replaySpool(
    options: { limit?: number; strict?: boolean } = {}
  ): Promise<OperabilityReplayResult> {
    if (!existsSync(this.spoolDir)) {
      return { processed: 0, sent: 0, failed: 0, remaining: 0 };
    }

    const files = (await readdir(this.spoolDir))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .slice(0, options.limit && options.limit > 0 ? options.limit : undefined);

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const file of files) {
      const filePath = join(this.spoolDir, file);
      const entry = await this.readSpoolEntry(filePath);
      if (!entry) {
        await unlink(filePath).catch(() => undefined);
        continue;
      }

      processed += 1;

      try {
        await this.sendRequest(entry.endpoint, {
          adapter: this.adapter,
          stage: entry.stage,
          claim: entry.claim,
        });
        await unlink(filePath);
        sent += 1;
      } catch (error) {
        failed += 1;
        entry.attempts += 1;
        entry.lastAttemptAt = new Date().toISOString();
        entry.lastError = error instanceof Error ? error.message : String(error);
        await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
        if (options.strict) {
          throw error;
        }
      }
    }

    return {
      processed,
      sent,
      failed,
      remaining: await this.countSpoolEntries(),
    };
  }

  private async sendRequest(endpoint: string, payload: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...this.requestHeaders,
    });

    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `Operability context ingestion failed (${response.status} ${response.statusText})${body ? `: ${body}` : ''}`
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async enqueue(
    stage: OperabilityIngestionStage,
    claim: AgentChangeClaim,
    lastError: string,
    endpoint?: string
  ): Promise<string> {
    await mkdir(this.spoolDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const filePath = join(this.spoolDir, `${id}.json`);
    const entry: OperabilitySpoolEntry = {
      id,
      stage,
      endpoint:
        endpoint || `${this.baseUrl || 'http://unconfigured'}/v1/ingest/change-session/${stage}`,
      claim,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError,
    };
    await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
    return filePath;
  }

  private async readSpoolEntry(path: string): Promise<OperabilitySpoolEntry | null> {
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as OperabilitySpoolEntry;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.stage || !parsed.claim || !parsed.endpoint) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async countSpoolEntries(): Promise<number> {
    if (!existsSync(this.spoolDir)) {
      return 0;
    }
    const files = await readdir(this.spoolDir);
    return files.filter((file) => file.endsWith('.json')).length;
  }
}

export function createOperabilityContextIngestionClient(
  config: Config,
  options: OperabilityIngestionClientOptions = {}
): OperabilityContextIngestionClient {
  return new OperabilityContextIngestionClient(config, options);
}
