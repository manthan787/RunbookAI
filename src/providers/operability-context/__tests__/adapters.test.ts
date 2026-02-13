import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../../utils/config';
import { DEFAULT_CONFIG } from '../../../utils/config';
import { createSourcegraphOperabilityAdapter } from '../adapters';
import {
  createOperabilityContextProviderFromConfig,
  createOperabilityContextRegistryFromConfig,
} from '../factory';

function cloneConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

describe('operability context adapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates adapter instances from config', () => {
    const sourcegraph = cloneConfig();
    sourcegraph.providers.operabilityContext.enabled = true;
    sourcegraph.providers.operabilityContext.adapter = 'sourcegraph';
    sourcegraph.providers.operabilityContext.baseUrl = 'https://context.example.com';
    sourcegraph.providers.operabilityContext.apiKey = 'token';
    expect(createOperabilityContextProviderFromConfig(sourcegraph)?.id).toBe('sourcegraph');

    const entireio = cloneConfig();
    entireio.providers.operabilityContext.enabled = true;
    entireio.providers.operabilityContext.adapter = 'entireio';
    entireio.providers.operabilityContext.baseUrl = 'https://context.example.com';
    entireio.providers.operabilityContext.apiKey = 'token';
    expect(createOperabilityContextProviderFromConfig(entireio)?.id).toBe('entireio');

    const runbookContext = cloneConfig();
    runbookContext.providers.operabilityContext.enabled = true;
    runbookContext.providers.operabilityContext.adapter = 'runbook_context';
    runbookContext.providers.operabilityContext.baseUrl = 'https://context.example.com';
    runbookContext.providers.operabilityContext.apiKey = 'token';
    expect(createOperabilityContextProviderFromConfig(runbookContext)?.id).toBe('runbook_context');

    const custom = cloneConfig();
    custom.providers.operabilityContext.enabled = true;
    custom.providers.operabilityContext.adapter = 'custom';
    custom.providers.operabilityContext.baseUrl = 'https://context.example.com';
    expect(createOperabilityContextProviderFromConfig(custom)?.id).toBe(
      'custom-operability-context'
    );
  });

  it('returns null when provider is disabled or missing base url', () => {
    const disabled = cloneConfig();
    disabled.providers.operabilityContext.enabled = false;
    disabled.providers.operabilityContext.adapter = 'sourcegraph';
    disabled.providers.operabilityContext.baseUrl = 'https://context.example.com';
    expect(createOperabilityContextProviderFromConfig(disabled)).toBeNull();

    const missingUrl = cloneConfig();
    missingUrl.providers.operabilityContext.enabled = true;
    missingUrl.providers.operabilityContext.adapter = 'sourcegraph';
    missingUrl.providers.operabilityContext.baseUrl = undefined;
    expect(createOperabilityContextProviderFromConfig(missingUrl)).toBeNull();
  });

  it('dispatches adapter requests and parses provider results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          data: {
            service: 'checkout',
            owners: ['team-checkout'],
            repos: ['RunbookAI'],
            runbooks: [],
            alerts: [],
            dependencies: [],
            recentChanges: [],
            provenance: [],
          },
          confidence: {
            value: 0.87,
            rationale: 'graph + git',
          },
          provenance: [],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createSourcegraphOperabilityAdapter({
      baseUrl: 'https://context.example.com',
      apiKey: 'sg-token',
      requestHeaders: {
        'x-team': 'sre',
      },
    });

    await adapter.ingestChangeSessionStart({
      session: {
        sessionId: 'sess-1',
        agent: 'codex',
        repository: 'RunbookAI',
        branch: 'main',
        baseSha: 'a',
        headSha: 'b',
        startedAt: '2026-02-13T00:00:00.000Z',
      },
      capturedAt: '2026-02-13T00:01:00.000Z',
      filesTouchedClaimed: [],
      servicesClaimed: [],
      testsRunClaimed: [],
      unknowns: [],
    });

    const context = await adapter.getServiceContext({ service: 'checkout' });
    expect(context.data.service).toBe('checkout');
    expect(context.confidence.value).toBe(0.87);

    expect(fetchMock).toHaveBeenCalled();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://context.example.com/v1/ingest/change-session/start');
    expect(request.method).toBe('POST');
    expect(String((request.headers as Headers).get('Authorization'))).toBe('Bearer sg-token');
    expect(String((request.headers as Headers).get('x-runbook-adapter'))).toBe('sourcegraph');
    expect(String((request.headers as Headers).get('x-team'))).toBe('sre');
  });

  it('builds registry with configured provider', () => {
    const config = cloneConfig();
    config.providers.operabilityContext.enabled = true;
    config.providers.operabilityContext.adapter = 'sourcegraph';
    config.providers.operabilityContext.baseUrl = 'https://context.example.com';
    config.providers.operabilityContext.apiKey = 'token';

    const registry = createOperabilityContextRegistryFromConfig(config);
    expect(registry.list().map((provider) => provider.id)).toEqual(['sourcegraph']);
  });
});
