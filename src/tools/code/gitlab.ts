import type { CodeFixCandidate, CodeFixSearchResult } from './types';

const DEFAULT_GITLAB_API = 'https://gitlab.com/api/v4';
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

export interface GitLabFixCandidateQuery {
  token: string;
  project: string;
  query: string;
  services?: string[];
  limit?: number;
  baseUrl?: string;
  timeoutMs?: number;
}

interface GitLabBlobMatch {
  filename?: string;
  path?: string;
  data?: string;
  ref?: string;
  startline?: number;
}

interface GitLabMergeRequest {
  title?: string;
  description?: string;
  web_url?: string;
  updated_at?: string;
}

interface GitLabIssue {
  title?: string;
  description?: string;
  web_url?: string;
  updated_at?: string;
}

interface GitLabProjectMetadata {
  path_with_namespace?: string;
  web_url?: string;
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || DEFAULT_GITLAB_API).trim();
  return value.replace(/\/+$/, '');
}

function normalizeProject(project: string): string {
  const cleaned = project
    .trim()
    .replace(/^https?:\/\/gitlab\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  if (!cleaned) {
    throw new Error('GitLab project must not be empty.');
  }

  return cleaned;
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

function inferWebOrigin(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'https://gitlab.com';
  }
}

function encodeProjectForApi(project: string): string {
  return encodeURIComponent(project);
}

function encodePathForUrl(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function gitlabFetch<T>(
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
        'PRIVATE-TOKEN': token,
        'User-Agent': 'RunbookAI',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function toBlobCandidates(
  items: GitLabBlobMatch[],
  projectPath: string,
  projectWebUrl: string
): CodeFixCandidate[] {
  return items
    .filter((item) => Boolean(item.path))
    .map((item) => {
      const path = item.path || item.filename || '';
      const ref = item.ref || 'main';
      const url =
        `${projectWebUrl}/-/blob/${encodeURIComponent(ref)}/` +
        encodePathForUrl(path) +
        (item.startline ? `#L${item.startline}` : '');

      return {
        provider: 'gitlab' as const,
        type: 'code' as const,
        title: item.filename || path || 'Code match',
        url,
        path,
        summary: item.data ? item.data.slice(0, 180) : `Matched file in ${projectPath}`,
      };
    });
}

function toMergeRequestCandidates(items: GitLabMergeRequest[]): CodeFixCandidate[] {
  return items
    .filter((item) => Boolean(item.web_url))
    .map((item) => ({
      provider: 'gitlab' as const,
      type: 'merge_request' as const,
      title: item.title || 'Merge request',
      url: item.web_url || '',
      summary: item.description ? item.description.slice(0, 180) : undefined,
      updatedAt: item.updated_at,
    }));
}

function toIssueCandidates(items: GitLabIssue[]): CodeFixCandidate[] {
  return items
    .filter((item) => Boolean(item.web_url))
    .map((item) => ({
      provider: 'gitlab' as const,
      type: 'issue' as const,
      title: item.title || 'Issue',
      url: item.web_url || '',
      summary: item.description ? item.description.slice(0, 180) : undefined,
      updatedAt: item.updated_at,
    }));
}

export async function findGitLabFixCandidates(
  options: GitLabFixCandidateQuery
): Promise<CodeFixSearchResult> {
  const query = options.query.trim();
  if (!query) {
    throw new Error('GitLab fix-candidate query cannot be empty.');
  }

  const project = normalizeProject(options.project);
  const token = options.token.trim();
  if (!token) {
    throw new Error('GitLab token is required to query fix candidates.');
  }

  const services = (options.services || []).map((service) => service.trim()).filter(Boolean);
  const limit = Math.max(1, Math.min(20, Math.round(options.limit || 8)));
  const perSource = Math.max(1, Math.min(5, Math.ceil(limit / 3)));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const searchText = buildSearchText(query, services);
  const projectParam = encodeProjectForApi(project);
  const webOrigin = inferWebOrigin(baseUrl);

  const metadataPromise = gitlabFetch<GitLabProjectMetadata>(
    token,
    baseUrl,
    `/projects/${projectParam}`,
    {},
    timeoutMs
  );

  const [metadataResult, blobsResult, mergeRequestsResult, issuesResult] = await Promise.allSettled(
    [
      metadataPromise,
      gitlabFetch<GitLabBlobMatch[]>(
        token,
        baseUrl,
        `/projects/${projectParam}/search`,
        {
          scope: 'blobs',
          search: searchText,
          per_page: String(perSource),
        },
        timeoutMs
      ),
      gitlabFetch<GitLabMergeRequest[]>(
        token,
        baseUrl,
        `/projects/${projectParam}/merge_requests`,
        {
          state: 'all',
          search: searchText,
          order_by: 'updated_at',
          sort: 'desc',
          per_page: String(perSource),
        },
        timeoutMs
      ),
      gitlabFetch<GitLabIssue[]>(
        token,
        baseUrl,
        `/projects/${projectParam}/issues`,
        {
          state: 'all',
          search: searchText,
          order_by: 'updated_at',
          sort: 'desc',
          per_page: String(perSource),
        },
        timeoutMs
      ),
    ]
  );

  const warnings: string[] = [];

  let projectPath = project;
  let projectWebUrl = `${webOrigin}/${project}`;
  if (metadataResult.status === 'fulfilled') {
    projectPath = metadataResult.value.path_with_namespace || projectPath;
    projectWebUrl = metadataResult.value.web_url || projectWebUrl;
  } else {
    warnings.push(
      metadataResult.reason instanceof Error
        ? metadataResult.reason.message
        : 'GitLab project metadata query failed'
    );
  }

  const candidates: CodeFixCandidate[] = [];

  if (blobsResult.status === 'fulfilled') {
    candidates.push(...toBlobCandidates(blobsResult.value, projectPath, projectWebUrl));
  } else {
    warnings.push(
      blobsResult.reason instanceof Error ? blobsResult.reason.message : 'Blob search failed'
    );
  }

  if (mergeRequestsResult.status === 'fulfilled') {
    candidates.push(...toMergeRequestCandidates(mergeRequestsResult.value));
  } else {
    warnings.push(
      mergeRequestsResult.reason instanceof Error
        ? mergeRequestsResult.reason.message
        : 'Merge request search failed'
    );
  }

  if (issuesResult.status === 'fulfilled') {
    candidates.push(...toIssueCandidates(issuesResult.value));
  } else {
    warnings.push(
      issuesResult.reason instanceof Error ? issuesResult.reason.message : 'Issue search failed'
    );
  }

  if (candidates.length === 0 && warnings.length > 0) {
    throw new Error(`GitLab fix-candidate search failed: ${warnings.join(' | ')}`);
  }

  const dedupedCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.url, candidate])).values()
  ).slice(0, limit);

  return {
    provider: 'gitlab',
    query,
    project: projectPath,
    candidates: dedupedCandidates,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
