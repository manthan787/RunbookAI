import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChangeClaim } from '../../providers/operability-context/types';
import { DEFAULT_CONFIG, type Config } from '../../utils/config';
import {
  buildClaimFromClaudeHookPayload,
  createOperabilityContextIngestionClient,
} from '../operability-context-ingestion';

function cloneConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

function createClaim(sessionId: string): AgentChangeClaim {
  return {
    session: {
      sessionId,
      agent: 'claude',
      repository: 'runbook',
      branch: 'main',
      baseSha: 'a1',
      headSha: 'b2',
      startedAt: '2026-02-13T00:00:00.000Z',
    },
    capturedAt: '2026-02-13T00:01:00.000Z',
    filesTouchedClaimed: [],
    servicesClaimed: [],
    testsRunClaimed: [],
    unknowns: [],
  };
}

describe('operability-context-ingestion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('dispatches ingestion payloads to configured endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = cloneConfig();
    config.providers.operabilityContext.enabled = true;
    config.providers.operabilityContext.adapter = 'sourcegraph';
    config.providers.operabilityContext.baseUrl = 'https://context.example.com';
    config.providers.operabilityContext.apiKey = 'test-token';

    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-operability-dispatch-'));
    const client = createOperabilityContextIngestionClient(config, { projectDir });
    const result = await client.ingest('start', createClaim('sess-success'));

    expect(result.status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://context.example.com/v1/ingest/change-session/start');
    expect(request.method).toBe('POST');
    expect(String((request.headers as Headers).get('Authorization'))).toBe('Bearer test-token');
  });

  it('queues failed dispatches to local spool', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'temporary outage',
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = cloneConfig();
    config.providers.operabilityContext.enabled = true;
    config.providers.operabilityContext.adapter = 'sourcegraph';
    config.providers.operabilityContext.baseUrl = 'https://context.example.com';
    config.providers.operabilityContext.apiKey = 'test-token';

    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-operability-queue-'));
    const client = createOperabilityContextIngestionClient(config, { projectDir });
    const result = await client.ingest('checkpoint', createClaim('sess-queued'));

    expect(result.status).toBe('queued');
    expect(result.queueFile).toBeDefined();
    expect(result.queueFile && existsSync(result.queueFile)).toBe(true);

    const status = await client.getQueueStatus();
    expect(status.pending).toBe(1);
  });

  it('replays queued entries after endpoint recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => '',
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchMock);

    const config = cloneConfig();
    config.providers.operabilityContext.enabled = true;
    config.providers.operabilityContext.adapter = 'sourcegraph';
    config.providers.operabilityContext.baseUrl = 'https://context.example.com';
    config.providers.operabilityContext.apiKey = 'test-token';

    const projectDir = mkdtempSync(join(tmpdir(), 'runbook-operability-replay-'));
    const client = createOperabilityContextIngestionClient(config, { projectDir });
    const queued = await client.ingest('end', createClaim('sess-replay'));

    expect(queued.status).toBe('queued');

    const replay = await client.replaySpool();
    expect(replay.processed).toBe(1);
    expect(replay.sent).toBe(1);
    expect(replay.failed).toBe(0);
    expect(replay.remaining).toBe(0);
  });

  it('maps claude hook payloads into staged claims', async () => {
    const mapped = await buildClaimFromClaudeHookPayload({
      payload: {
        session_id: 'sess-hook',
        hook_event_name: 'PostToolUse',
        cwd: process.cwd(),
        prompt: 'Investigate checkout-service 500 errors',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm run test -- src/checkout/retry.ts',
        },
      },
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.stage).toBe('checkpoint');
    expect(mapped?.claim.session.sessionId).toBe('sess-hook');
    expect(mapped?.claim.servicesClaimed).toContain('checkout');
    expect(mapped?.claim.testsRunClaimed[0]).toContain('npm run test');
  });
});
