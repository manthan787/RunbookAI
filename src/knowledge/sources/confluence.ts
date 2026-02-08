/**
 * Confluence Knowledge Source
 *
 * Loads runbooks and knowledge documents from Confluence Cloud/Server.
 * Uses REST API v2 for fetching pages and their content.
 */

import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeType,
  ConfluenceSourceConfig,
} from '../types';
import type { LoadOptions } from './index';

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  version: {
    number: number;
    createdAt: string;
  };
  body?: {
    storage?: {
      value: string;
    };
  };
  labels?: {
    results: Array<{
      name: string;
    }>;
  };
  _links?: {
    webui?: string;
  };
}

interface ConfluenceResponse {
  results: ConfluencePage[];
  _links?: {
    next?: string;
  };
}

/**
 * Load knowledge documents from Confluence
 */
export async function loadFromConfluence(
  config: ConfluenceSourceConfig,
  options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  const documents: KnowledgeDocument[] = [];
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const authHeader = createBasicAuthHeader(config.auth.email, config.auth.apiToken);

  // Fetch pages from the space
  const pages = await fetchPagesFromSpace(baseUrl, config.spaceKey, authHeader, {
    labels: config.labels,
    since: options.since,
  });

  for (const page of pages) {
    try {
      const doc = await processPage(page, config, baseUrl);
      if (doc) {
        documents.push(doc);
      }
    } catch (error) {
      console.error(`Error processing Confluence page ${page.id}:`, error);
    }
  }

  return documents;
}

/**
 * Create Basic Auth header
 */
function createBasicAuthHeader(email: string, apiToken: string): string {
  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Fetch all pages from a Confluence space
 */
async function fetchPagesFromSpace(
  baseUrl: string,
  spaceKey: string,
  authHeader: string,
  options: { labels?: string[]; since?: string }
): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let url = `${baseUrl}/wiki/api/v2/spaces/${spaceKey}/pages?body-format=storage&limit=50`;

  // Add label filter if specified
  if (options.labels && options.labels.length > 0) {
    url += `&label=${options.labels.join(',')}`;
  }

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // Try fallback to v1 API if v2 fails
      if (response.status === 404) {
        return fetchPagesV1(baseUrl, spaceKey, authHeader, options);
      }
      throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ConfluenceResponse;

    for (const page of data.results) {
      // Filter by last modified time for incremental sync
      if (options.since) {
        const pageModified = new Date(page.version.createdAt);
        const sinceDate = new Date(options.since);
        if (pageModified <= sinceDate) {
          continue;
        }
      }

      // Fetch full page content with body if not included
      if (!page.body?.storage?.value) {
        const fullPage = await fetchPageContent(baseUrl, page.id, authHeader);
        if (fullPage) {
          pages.push(fullPage);
        }
      } else {
        pages.push(page);
      }
    }

    // Handle pagination
    url = data._links?.next ? `${baseUrl}${data._links.next}` : '';
  }

  return pages;
}

/**
 * Fallback to Confluence v1 API for older instances
 */
async function fetchPagesV1(
  baseUrl: string,
  spaceKey: string,
  authHeader: string,
  options: { labels?: string[]; since?: string }
): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let start = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    let url = `${baseUrl}/wiki/rest/api/content?spaceKey=${spaceKey}&type=page&expand=body.storage,version,metadata.labels&start=${start}&limit=${limit}`;

    // Add label filter using CQL
    if (options.labels && options.labels.length > 0) {
      const labelCql = options.labels.map((l) => `label="${l}"`).join(' OR ');
      url += `&cql=space="${spaceKey}" AND (${labelCql})`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
    }

    interface V1Page {
      id: string;
      title: string;
      status: string;
      history?: { createdDate?: string; lastUpdated?: { when?: string } };
      version?: { number?: number; when?: string };
      body?: { storage?: { value?: string } };
      metadata?: { labels?: { results?: Array<{ name: string }> } };
      _links?: { webui?: string };
    }
    interface V1Response {
      results?: V1Page[];
    }
    const data = (await response.json()) as V1Response;

    for (const page of data.results || []) {
      // Filter by last modified time
      if (options.since) {
        const pageModified = new Date(page.version?.when || page.history?.lastUpdated?.when || '');
        const sinceDate = new Date(options.since);
        if (pageModified <= sinceDate) {
          continue;
        }
      }

      // Convert v1 format to v2 format
      pages.push({
        id: page.id,
        title: page.title,
        status: page.status,
        createdAt: page.history?.createdDate || new Date().toISOString(),
        version: {
          number: page.version?.number || 1,
          createdAt: page.version?.when || new Date().toISOString(),
        },
        body: {
          storage: {
            value: page.body?.storage?.value || '',
          },
        },
        labels: {
          results: page.metadata?.labels?.results || [],
        },
        _links: {
          webui: page._links?.webui,
        },
      });
    }

    // Check for more pages
    if ((data.results?.length ?? 0) < limit) {
      hasMore = false;
    } else {
      start += limit;
    }
  }

  return pages;
}

/**
 * Fetch full page content
 */
async function fetchPageContent(
  baseUrl: string,
  pageId: string,
  authHeader: string
): Promise<ConfluencePage | null> {
  const url = `${baseUrl}/wiki/api/v2/pages/${pageId}?body-format=storage`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch page ${pageId}: ${response.status}`);
    return null;
  }

  return (await response.json()) as ConfluencePage;
}

/**
 * Process a Confluence page into a KnowledgeDocument
 */
async function processPage(
  page: ConfluencePage,
  config: ConfluenceSourceConfig,
  baseUrl: string
): Promise<KnowledgeDocument | null> {
  const htmlContent = page.body?.storage?.value || '';
  if (!htmlContent) {
    return null;
  }

  // Convert Confluence storage format (HTML) to markdown
  const markdown = convertConfluenceToMarkdown(htmlContent);

  // Extract metadata from labels
  const labels = page.labels?.results?.map((l) => l.name) || [];
  const docType = inferTypeFromLabels(labels);
  const services = extractServicesFromLabels(labels);
  const tags = labels.filter((l) => !l.startsWith('service:') && !isTypeLabel(l));

  // Generate document ID
  const id = `confluence_${config.spaceKey}_${page.id}`;

  // Chunk the content
  const chunks = chunkMarkdown(id, markdown);

  // Build source URL
  const sourceUrl = page._links?.webui
    ? `${baseUrl}/wiki${page._links.webui}`
    : `${baseUrl}/wiki/spaces/${config.spaceKey}/pages/${page.id}`;

  return {
    id,
    source: {
      type: 'confluence',
      name: `confluence:${config.spaceKey}`,
      config,
    },
    type: docType,
    title: page.title,
    content: markdown,
    chunks,
    services,
    tags,
    severityRelevance: extractSeverityFromLabels(labels),
    createdAt: page.createdAt,
    updatedAt: page.version.createdAt,
    sourceUrl,
  };
}

/**
 * Convert Confluence storage format (HTML) to markdown
 */
function convertConfluenceToMarkdown(html: string): string {
  let md = html;

  // Remove Confluence macros (keep content where possible)
  md = md.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    '```\n$1\n```'
  );
  md = md.replace(
    /<ac:structured-macro[^>]*ac:name="info"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    '> $1'
  );
  md = md.replace(
    /<ac:structured-macro[^>]*ac:name="warning"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    '> $1'
  );
  md = md.replace(
    /<ac:structured-macro[^>]*ac:name="note"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    '> $1'
  );
  md = md.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  md = md.replace(/<ul[^>]*>/gi, '');
  md = md.replace(/<\/ul>/gi, '\n');
  md = md.replace(/<ol[^>]*>/gi, '');
  md = md.replace(/<\/ol>/gi, '\n');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

  // Convert formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```');

  // Convert paragraphs and breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '---\n');

  // Convert tables
  md = md.replace(/<table[^>]*>/gi, '\n');
  md = md.replace(/<\/table>/gi, '\n');
  md = md.replace(/<thead[^>]*>/gi, '');
  md = md.replace(/<\/thead>/gi, '');
  md = md.replace(/<tbody[^>]*>/gi, '');
  md = md.replace(/<\/tbody>/gi, '');
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '|$1\n');
  md = md.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, ' $1 |');
  md = md.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, ' $1 |');

  // Clean up remaining HTML
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

/**
 * Infer document type from labels
 */
function inferTypeFromLabels(labels: string[]): KnowledgeType {
  const lowerLabels = labels.map((l) => l.toLowerCase());

  if (lowerLabels.includes('runbook') || lowerLabels.includes('playbook')) {
    return 'runbook';
  }
  if (
    lowerLabels.includes('postmortem') ||
    lowerLabels.includes('post-mortem') ||
    lowerLabels.includes('incident-report')
  ) {
    return 'postmortem';
  }
  if (
    lowerLabels.includes('architecture') ||
    lowerLabels.includes('design') ||
    lowerLabels.includes('adr')
  ) {
    return 'architecture';
  }
  if (
    lowerLabels.includes('known-issue') ||
    lowerLabels.includes('known_issue') ||
    lowerLabels.includes('bug')
  ) {
    return 'known_issue';
  }
  if (lowerLabels.includes('faq')) {
    return 'faq';
  }

  return 'runbook';
}

/**
 * Check if a label indicates document type
 */
function isTypeLabel(label: string): boolean {
  const typeLabels = [
    'runbook',
    'playbook',
    'postmortem',
    'post-mortem',
    'incident-report',
    'architecture',
    'design',
    'adr',
    'known-issue',
    'known_issue',
    'bug',
    'faq',
  ];
  return typeLabels.includes(label.toLowerCase());
}

/**
 * Extract service names from labels
 */
function extractServicesFromLabels(labels: string[]): string[] {
  const services: string[] = [];

  for (const label of labels) {
    if (label.startsWith('service:')) {
      services.push(label.slice(8));
    } else if (label.startsWith('svc-')) {
      services.push(label.slice(4));
    }
  }

  return services;
}

/**
 * Extract severity relevance from labels
 */
function extractSeverityFromLabels(labels: string[]): Array<'sev1' | 'sev2' | 'sev3'> {
  const severities: Array<'sev1' | 'sev2' | 'sev3'> = [];
  const lowerLabels = labels.map((l) => l.toLowerCase());

  if (
    lowerLabels.includes('sev1') ||
    lowerLabels.includes('critical') ||
    lowerLabels.includes('p0')
  ) {
    severities.push('sev1');
  }
  if (lowerLabels.includes('sev2') || lowerLabels.includes('high') || lowerLabels.includes('p1')) {
    severities.push('sev2');
  }
  if (
    lowerLabels.includes('sev3') ||
    lowerLabels.includes('medium') ||
    lowerLabels.includes('p2')
  ) {
    severities.push('sev3');
  }

  return severities;
}

/**
 * Chunk markdown content by sections
 */
function chunkMarkdown(documentId: string, content: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const lines = content.split('\n');

  let currentChunk: string[] = [];
  let currentTitle: string | undefined;
  let chunkIndex = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section headers
    if (line.match(/^#{1,3}\s+/)) {
      // Save previous chunk if exists
      if (currentChunk.length > 0) {
        chunks.push({
          id: `${documentId}_${chunkIndex++}`,
          documentId,
          content: currentChunk.join('\n').trim(),
          sectionTitle: currentTitle,
          chunkType: inferChunkType(currentChunk.join('\n')),
          lineStart,
          lineEnd: i - 1,
        });
      }

      currentTitle = line.replace(/^#+\s+/, '').trim();
      currentChunk = [line];
      lineStart = i;
    } else {
      currentChunk.push(line);
    }
  }

  // Save final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      id: `${documentId}_${chunkIndex}`,
      documentId,
      content: currentChunk.join('\n').trim(),
      sectionTitle: currentTitle,
      chunkType: inferChunkType(currentChunk.join('\n')),
      lineStart,
      lineEnd: lines.length - 1,
    });
  }

  return chunks;
}

/**
 * Infer chunk type from content
 */
function inferChunkType(content: string): KnowledgeChunk['chunkType'] {
  const lower = content.toLowerCase();

  if (content.includes('```')) {
    return 'command';
  }
  if (lower.includes('step') || lower.includes('[ ]') || lower.includes('[x]')) {
    return 'procedure';
  }
  if (lower.includes('if ') || lower.includes('when ') || lower.includes('decision')) {
    return 'decision';
  }
  if (lower.includes('symptom') || lower.includes('overview') || lower.includes('background')) {
    return 'context';
  }

  return 'reference';
}
