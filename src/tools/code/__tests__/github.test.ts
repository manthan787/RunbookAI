import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { findGitHubFixCandidates } from '../github';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('findGitHubFixCandidates', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns deduped candidates across code, PRs, and issues', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/search/code')) {
        return jsonResponse({
          items: [
            {
              name: 'retry.ts',
              path: 'src/checkout/retry.ts',
              html_url: 'https://github.com/acme/platform/blob/main/src/checkout/retry.ts',
            },
          ],
        });
      }

      const query = url.searchParams.get('q') || '';
      if (url.pathname.endsWith('/search/issues') && query.includes('is:pr')) {
        return jsonResponse({
          items: [
            {
              title: 'Fix DB connection leak',
              html_url: 'https://github.com/acme/platform/pull/42',
              body: 'Fixes production leak in checkout path',
              updated_at: '2026-02-13T00:00:00Z',
              pull_request: { url: 'https://api.github.com/repos/acme/platform/pulls/42' },
            },
          ],
        });
      }

      if (url.pathname.endsWith('/search/issues') && query.includes('is:issue')) {
        return jsonResponse({
          items: [
            {
              title: 'Checkout timeout during surge',
              html_url: 'https://github.com/acme/platform/issues/88',
              body: 'Symptoms match incident behavior',
              updated_at: '2026-02-12T23:00:00Z',
            },
          ],
        });
      }

      return jsonResponse({ message: 'not found' }, 404);
    });

    const result = await findGitHubFixCandidates({
      token: 'ghp_test_token',
      repository: 'acme/platform',
      query: 'Database connection pool exhausted',
      services: ['checkout-api'],
      limit: 8,
    });

    expect(result.provider).toBe('github');
    expect(result.repository).toBe('acme/platform');
    expect(result.candidates.some((candidate) => candidate.type === 'code')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.type === 'pull_request')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.type === 'issue')).toBe(true);
  });

  it('throws for invalid repository format', async () => {
    await expect(
      findGitHubFixCandidates({
        token: 'ghp_test_token',
        repository: 'invalid-repo-format',
        query: 'Redis timeout',
      })
    ).rejects.toThrow('owner/repo');
  });
});
