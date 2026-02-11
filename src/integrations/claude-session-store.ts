import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { isAbsolute, join } from 'path';
import type { Config } from '../utils/config';

export type ClaudeSessionStorageBackend = 'local' | 's3';

export interface ClaudeSessionEventRecord {
  observedAt: string;
  sessionId: string;
  eventName: string;
  cwd: string;
  transcriptPath: string | null;
  payload: Record<string, unknown>;
}

export interface ClaudeSessionStorageDestination {
  backend: ClaudeSessionStorageBackend;
  baseLocation: string;
  sessionLocation: string;
  eventsLocation: string;
  latestLocation: string;
}

export interface ClaudeSessionPersistResult {
  primary: ClaudeSessionStorageDestination;
  mirrors: ClaudeSessionStorageDestination[];
}

export interface ClaudeSessionStorage {
  persistEvent(
    event: ClaudeSessionEventRecord,
    options?: { prompt?: string }
  ): Promise<ClaudeSessionPersistResult>;
  getSessionEvents(sessionId: string): Promise<ClaudeSessionEventRecord[]>;
}

export interface CreateClaudeSessionStorageOptions {
  projectDir?: string;
}

interface ClaudeS3StorageConfig {
  bucket?: string;
  prefix: string;
  region?: string;
  endpoint?: string;
  forcePathStyle: boolean;
}

interface ClaudeSessionStorageConfig {
  backend: ClaudeSessionStorageBackend;
  mirrorLocal: boolean;
  localBaseDir: string;
  s3: ClaudeS3StorageConfig;
}

interface SessionBackend {
  kind: ClaudeSessionStorageBackend;
  persistEvent(
    event: ClaudeSessionEventRecord,
    options?: { prompt?: string }
  ): Promise<ClaudeSessionStorageDestination>;
  getSessionEvents(sessionId: string): Promise<ClaudeSessionEventRecord[]>;
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function normalizePrefix(prefix: string): string {
  return prefix
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseEventLine(line: string): ClaudeSessionEventRecord | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const observedAt = typeof parsed.observedAt === 'string' ? parsed.observedAt : '';
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
    const eventName = typeof parsed.eventName === 'string' ? parsed.eventName : '';
    const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : '';
    const transcriptPath =
      typeof parsed.transcriptPath === 'string'
        ? parsed.transcriptPath
        : parsed.transcriptPath === null
          ? null
          : null;
    const payload = asRecord(parsed.payload);

    if (!observedAt || !sessionId || !eventName || !cwd || !payload) {
      return null;
    }

    return {
      observedAt,
      sessionId,
      eventName,
      cwd,
      transcriptPath,
      payload,
    };
  } catch {
    return null;
  }
}

function resolveLocalBaseDir(projectDir: string, localBaseDir: string): string {
  if (isAbsolute(localBaseDir)) {
    return localBaseDir;
  }
  return join(projectDir, localBaseDir);
}

function createLocalBackend(baseDir: string): SessionBackend {
  return {
    kind: 'local',
    async persistEvent(event, options) {
      const sessionDir = join(baseDir, 'sessions', sanitizeSessionId(event.sessionId));
      const eventsFile = join(sessionDir, 'events.ndjson');
      const latestEventFile = join(baseDir, 'latest.json');

      await mkdir(sessionDir, { recursive: true });
      await appendFile(eventsFile, `${JSON.stringify(event)}\n`, 'utf-8');
      await writeFile(latestEventFile, `${JSON.stringify(event, null, 2)}\n`, 'utf-8');

      if (options?.prompt) {
        await writeFile(join(sessionDir, 'last-prompt.txt'), `${options.prompt}\n`, 'utf-8');
      }

      return {
        backend: 'local',
        baseLocation: baseDir,
        sessionLocation: sessionDir,
        eventsLocation: eventsFile,
        latestLocation: latestEventFile,
      };
    },
    async getSessionEvents(sessionId) {
      const eventsFile = join(baseDir, 'sessions', sanitizeSessionId(sessionId), 'events.ndjson');
      if (!existsSync(eventsFile)) {
        return [];
      }

      const content = await readFile(eventsFile, 'utf-8');
      const events: ClaudeSessionEventRecord[] = [];
      for (const line of content
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const event = parseEventLine(line);
        if (event) {
          events.push(event);
        }
      }
      return events;
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (candidate.name === 'NoSuchKey' || candidate.name === 'NotFound') {
    return true;
  }
  if (candidate.$metadata?.httpStatusCode === 404) {
    return true;
  }
  return false;
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) {
    return '';
  }

  const withTransform = body as { transformToString?: () => Promise<string> };
  if (typeof withTransform.transformToString === 'function') {
    return withTransform.transformToString();
  }

  const asyncIterable = body as AsyncIterable<unknown>;
  if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of asyncIterable) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf-8'));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(new Uint8Array(chunk)));
      } else {
        chunks.push(Buffer.from(String(chunk), 'utf-8'));
      }
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  return '';
}

function createS3Backend(config: ClaudeS3StorageConfig): SessionBackend {
  if (!config.bucket) {
    throw new Error('S3 backend selected for Claude session storage but no bucket configured.');
  }

  const prefix = normalizePrefix(config.prefix);
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });

  function keyForSessionEvents(sessionId: string): string {
    const suffix = `sessions/${sanitizeSessionId(sessionId)}/events.ndjson`;
    return prefix ? `${prefix}/${suffix}` : suffix;
  }

  function keyForSessionPrompt(sessionId: string): string {
    const suffix = `sessions/${sanitizeSessionId(sessionId)}/last-prompt.txt`;
    return prefix ? `${prefix}/${suffix}` : suffix;
  }

  function keyForLatest(): string {
    return prefix ? `${prefix}/latest.json` : 'latest.json';
  }

  async function getObjectTextOptional(key: string): Promise<string> {
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        })
      );
      return bodyToString(response.Body);
    } catch (error) {
      if (isNotFoundError(error)) {
        return '';
      }
      throw error;
    }
  }

  return {
    kind: 's3',
    async persistEvent(event, options) {
      const eventsKey = keyForSessionEvents(event.sessionId);
      const latestKey = keyForLatest();
      const promptKey = keyForSessionPrompt(event.sessionId);
      const serialized = JSON.stringify(event);

      const existing = await getObjectTextOptional(eventsKey);
      const nextEvents =
        existing.trim().length > 0 ? `${existing.trimEnd()}\n${serialized}\n` : `${serialized}\n`;

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: eventsKey,
          Body: nextEvents,
          ContentType: 'application/x-ndjson',
        })
      );
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: latestKey,
          Body: `${JSON.stringify(event, null, 2)}\n`,
          ContentType: 'application/json',
        })
      );

      if (options?.prompt) {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: promptKey,
            Body: `${options.prompt}\n`,
            ContentType: 'text/plain; charset=utf-8',
          })
        );
      }

      const baseLocation = `s3://${config.bucket}${prefix ? `/${prefix}` : ''}`;
      return {
        backend: 's3',
        baseLocation,
        sessionLocation: `${baseLocation}/sessions/${sanitizeSessionId(event.sessionId)}`,
        eventsLocation: `s3://${config.bucket}/${eventsKey}`,
        latestLocation: `s3://${config.bucket}/${latestKey}`,
      };
    },
    async getSessionEvents(sessionId) {
      const eventsKey = keyForSessionEvents(sessionId);
      const content = await getObjectTextOptional(eventsKey);
      if (!content.trim()) {
        return [];
      }

      const events: ClaudeSessionEventRecord[] = [];
      for (const line of content
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const event = parseEventLine(line);
        if (event) {
          events.push(event);
        }
      }
      return events;
    },
  };
}

function normalizeConfig(config: Config): ClaudeSessionStorageConfig {
  return {
    backend: config.integrations.claude.sessionStorage.backend,
    mirrorLocal: config.integrations.claude.sessionStorage.mirrorLocal,
    localBaseDir: config.integrations.claude.sessionStorage.localBaseDir,
    s3: {
      bucket: config.integrations.claude.sessionStorage.s3.bucket,
      prefix: config.integrations.claude.sessionStorage.s3.prefix,
      region: config.integrations.claude.sessionStorage.s3.region,
      endpoint: config.integrations.claude.sessionStorage.s3.endpoint,
      forcePathStyle: config.integrations.claude.sessionStorage.s3.forcePathStyle,
    },
  };
}

export function createClaudeSessionStorageFromConfig(
  config: Config,
  options: CreateClaudeSessionStorageOptions = {}
): ClaudeSessionStorage {
  const projectDir = options.projectDir || process.cwd();
  const normalized = normalizeConfig(config);
  const localBackend = createLocalBackend(resolveLocalBaseDir(projectDir, normalized.localBaseDir));

  const primary: SessionBackend =
    normalized.backend === 's3' ? createS3Backend(normalized.s3) : localBackend;

  const mirrorBackends: SessionBackend[] = [];
  if (normalized.backend === 's3' && normalized.mirrorLocal) {
    mirrorBackends.push(localBackend);
  }

  return {
    async persistEvent(event, persistOptions) {
      const primaryDestination = await primary.persistEvent(event, persistOptions);
      const mirrors: ClaudeSessionStorageDestination[] = [];

      for (const mirror of mirrorBackends) {
        mirrors.push(await mirror.persistEvent(event, persistOptions));
      }

      return {
        primary: primaryDestination,
        mirrors,
      };
    },
    async getSessionEvents(sessionId) {
      const primaryEvents = await primary.getSessionEvents(sessionId);
      if (primaryEvents.length > 0) {
        return primaryEvents;
      }

      for (const mirror of mirrorBackends) {
        const fallbackEvents = await mirror.getSessionEvents(sessionId);
        if (fallbackEvents.length > 0) {
          return fallbackEvents;
        }
      }

      return [];
    },
  };
}
