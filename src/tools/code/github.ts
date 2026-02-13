import type { CodeFixCandidate, CodeFixSearchResult } from './types';

const DEFAULT_GITHUB_API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 5000;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

export interface GitHubFixCandidateQuery {
  token: string;
  repository: string;
  query: string;
  services?: string[];
  limit?: number;
  baseUrl?: string;
  timeoutMs?: number;
}

interface GitHubCodeSearchResponse {
  items?: Array<{
    name?: string;
    path?: string;
    html_url?: string;
    score?: number;
  }>;
}

interface GitHubIssueSearchResponse {
  items?: Array<{
    title?: string;
    html_url?: string;
    body?: string;
    updated_at?: string;
    pull_request?: Record<string, unknown>;
  }>;
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || DEFAULT_GITHUB_API).trim();
  return value.replace(/\/+$/, '');
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const cleaned = repository
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error('GitHub repository must be in "owner/repo" format.');
  }

  return {
    owner: parts[0],
    repo: parts[1],
  };
}

function extractSearchTerms(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !STOP_WORDS.has(part))
    .slice(0, 10);
}

function buildSearchText(query: string, services: string[]): string {
  const terms = [...extractSearchTerms(query), ...services.flatMap(extractSearchTerms)];
  const deduped = Array.from(new Set(terms)).slice(0, 10);

  if (deduped.length > 0) {
    return deduped.join(' ');
  }

  const fallback = `${query} ${services.join(' ')}`.trim();
  return fallback || 'incident fix rollback';
}

async function githubFetch<T>(
  token: string,
  baseUrl: string,
  path: string,
  params: Record<string, string>,
  timeoutMs: number
): Promise<T> {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RunbookAI',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function toCodeCandidates(items: GitHubCodeSearchResponse['items']): CodeFixCandidate[] {
  return (items || [])
    .filter((item) => Boolean(item?.html_url))
    .map((item) => ({
      provider: 'github' as const,
      type: 'code' as const,
      title: item.name || item.path || 'Code match',
      url: item.html_url || '',
      path: item.path,
      summary: item.path ? `Matched file: ${item.path}` : undefined,
    }));
}

function toPullRequestCandidates(items: GitHubIssueSearchResponse['items']): CodeFixCandidate[] {
  return (items || [])
    .filter((item) => Boolean(item?.html_url) && Boolean(item?.pull_request))
    .map((item) => ({
      provider: 'github' as const,
      type: 'pull_request' as const,
      title: item.title || 'Pull request',
      url: item.html_url || '',
      summary: item.body ? item.body.slice(0, 180) : undefined,
      updatedAt: item.updated_at,
    }));
}

function toIssueCandidates(items: GitHubIssueSearchResponse['items']): CodeFixCandidate[] {
  return (items || [])
    .filter((item) => Boolean(item?.html_url) && !item?.pull_request)
    .map((item) => ({
      provider: 'github' as const,
      type: 'issue' as const,
      title: item.title || 'Issue',
      url: item.html_url || '',
      summary: item.body ? item.body.slice(0, 180) : undefined,
      updatedAt: item.updated_at,
    }));
}

export async function findGitHubFixCandidates(
  options: GitHubFixCandidateQuery
): Promise<CodeFixSearchResult> {
  const query = options.query.trim();
  if (!query) {
    throw new Error('GitHub fix-candidate query cannot be empty.');
  }

  const { owner, repo } = parseRepository(options.repository);
  const token = options.token.trim();
  if (!token) {
    throw new Error('GitHub token is required to query fix candidates.');
  }

  const services = (options.services || []).map((service) => service.trim()).filter(Boolean);
  const limit = Math.max(1, Math.min(20, Math.round(options.limit || 8)));
  const perSource = Math.max(1, Math.min(5, Math.ceil(limit / 3)));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const searchText = buildSearchText(query, services);
  const repoSelector = `${owner}/${repo}`;

  const [codeResponse, prResponse, issueResponse] = await Promise.allSettled([
    githubFetch<GitHubCodeSearchResponse>(
      token,
      baseUrl,
      '/search/code',
      {
        q: `${searchText} repo:${repoSelector}`,
        per_page: String(perSource),
        sort: 'indexed',
        order: 'desc',
      },
      timeoutMs
    ),
    githubFetch<GitHubIssueSearchResponse>(
      token,
      baseUrl,
      '/search/issues',
      {
        q: `${searchText} repo:${repoSelector} is:pr`,
        per_page: String(perSource),
        sort: 'updated',
        order: 'desc',
      },
      timeoutMs
    ),
    githubFetch<GitHubIssueSearchResponse>(
      token,
      baseUrl,
      '/search/issues',
      {
        q: `${searchText} repo:${repoSelector} is:issue`,
        per_page: String(perSource),
        sort: 'updated',
        order: 'desc',
      },
      timeoutMs
    ),
  ]);

  const warnings: string[] = [];
  const candidates: CodeFixCandidate[] = [];

  if (codeResponse.status === 'fulfilled') {
    candidates.push(...toCodeCandidates(codeResponse.value.items));
  } else {
    warnings.push(
      codeResponse.reason instanceof Error ? codeResponse.reason.message : 'Code search failed'
    );
  }

  if (prResponse.status === 'fulfilled') {
    candidates.push(...toPullRequestCandidates(prResponse.value.items));
  } else {
    warnings.push(
      prResponse.reason instanceof Error ? prResponse.reason.message : 'Pull request search failed'
    );
  }

  if (issueResponse.status === 'fulfilled') {
    candidates.push(...toIssueCandidates(issueResponse.value.items));
  } else {
    warnings.push(
      issueResponse.reason instanceof Error ? issueResponse.reason.message : 'Issue search failed'
    );
  }

  if (candidates.length === 0 && warnings.length > 0) {
    throw new Error(`GitHub fix-candidate search failed: ${warnings.join(' | ')}`);
  }

  const dedupedCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.url, candidate])).values()
  ).slice(0, limit);

  return {
    provider: 'github',
    query,
    repository: repoSelector,
    candidates: dedupedCandidates,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
