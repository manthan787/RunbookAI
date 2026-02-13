import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { findGitLabFixCandidates } from '../gitlab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('findGitLabFixCandidates', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns candidates from blob, MR, and issue searches', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith('/projects/acme%2Fplatform')) {
        return jsonResponse({
          path_with_namespace: 'acme/platform',
          web_url: 'https://gitlab.com/acme/platform',
        });
      }

      if (url.pathname.endsWith('/projects/acme%2Fplatform/search')) {
        return jsonResponse([
          {
            filename: 'retry.ts',
            path: 'src/checkout/retry.ts',
            data: 'retry logic for checkout service',
            ref: 'main',
            startline: 48,
          },
        ]);
      }

      if (url.pathname.endsWith('/projects/acme%2Fplatform/merge_requests')) {
        return jsonResponse([
          {
            title: 'Fix checkout DB connection leak',
            description: 'Patch pool lifecycle management',
            web_url: 'https://gitlab.com/acme/platform/-/merge_requests/12',
            updated_at: '2026-02-13T00:00:00Z',
          },
        ]);
      }

      if (url.pathname.endsWith('/projects/acme%2Fplatform/issues')) {
        return jsonResponse([
          {
            title: 'Checkout timeout on traffic spikes',
            description: 'Possible relation with DB pool exhaustion',
            web_url: 'https://gitlab.com/acme/platform/-/issues/91',
            updated_at: '2026-02-12T23:00:00Z',
          },
        ]);
      }

      return jsonResponse({ message: 'not found' }, 404);
    });

    const result = await findGitLabFixCandidates({
      token: 'glpat_test_token',
      project: 'acme/platform',
      query: 'Database connection pool exhausted',
      services: ['checkout-api'],
      limit: 8,
    });

    expect(result.provider).toBe('gitlab');
    expect(result.project).toBe('acme/platform');
    expect(result.candidates.some((candidate) => candidate.type === 'code')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.type === 'merge_request')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.type === 'issue')).toBe(true);

    const codeCandidate = result.candidates.find((candidate) => candidate.type === 'code');
    expect(codeCandidate?.url).toContain('/-/blob/main/src/checkout/retry.ts');
  });

  it('throws for empty query', async () => {
    await expect(
      findGitLabFixCandidates({
        token: 'glpat_test_token',
        project: 'acme/platform',
        query: '   ',
      })
    ).rejects.toThrow('cannot be empty');
  });
});
