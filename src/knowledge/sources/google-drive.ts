/**
 * Google Drive Knowledge Source
 *
 * Loads runbooks and knowledge documents from Google Drive.
 * Supports Google Docs and Sheets with markdown export.
 */

import { refreshAccessToken } from './google-auth';
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeType,
  GoogleDriveSourceConfig,
} from '../types';
import type { LoadOptions } from './index';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// MIME types for Google Workspace files
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const MARKDOWN_MIME = 'text/markdown';
const TEXT_MIME = 'text/plain';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  description?: string;
  properties?: Record<string, string>;
  parents?: string[];
  webViewLink?: string;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

/**
 * Load knowledge documents from Google Drive
 */
export async function loadFromGoogleDrive(
  config: GoogleDriveSourceConfig,
  options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  const documents: KnowledgeDocument[] = [];

  if (!config.refreshToken) {
    console.warn(
      'Google Drive: No refresh token configured. Run "runbook knowledge auth google" to authenticate.'
    );
    return documents;
  }

  // Get a fresh access token
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(
      config.refreshToken,
      config.clientId,
      config.clientSecret
    );
  } catch (error) {
    console.error('Failed to refresh Google Drive access token:', error);
    return documents;
  }

  // Collect all files from specified folders
  const allFiles: DriveFile[] = [];

  for (const folderId of config.folderIds) {
    const files = await listFilesInFolder(accessToken, folderId, {
      includeSubfolders: config.includeSubfolders ?? true,
      mimeTypes: config.mimeTypes,
      modifiedAfter: options.since,
    });
    allFiles.push(...files);
  }

  // Process each file
  for (const file of allFiles) {
    try {
      const doc = await processFile(file, accessToken, config);
      if (doc) {
        documents.push(doc);
      }
    } catch (error) {
      console.error(`Error processing Google Drive file ${file.id} (${file.name}):`, error);
    }
  }

  return documents;
}

/**
 * List all files in a folder (optionally recursive)
 */
async function listFilesInFolder(
  accessToken: string,
  folderId: string,
  options: {
    includeSubfolders?: boolean;
    mimeTypes?: string[];
    modifiedAfter?: string;
  }
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const subfolders: string[] = [];

  // Build query
  const queryParts: string[] = [`'${folderId}' in parents`, 'trashed = false'];

  // Filter by modified time for incremental sync
  if (options.modifiedAfter) {
    queryParts.push(`modifiedTime > '${options.modifiedAfter}'`);
  }

  const query = queryParts.join(' and ');
  let pageToken: string | undefined;

  do {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,description,properties,parents,webViewLink)'
    );
    url.searchParams.set('pageSize', '100');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Drive API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as DriveListResponse;

    for (const file of data.files) {
      // Check if it's a subfolder
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        if (options.includeSubfolders) {
          subfolders.push(file.id);
        }
        continue;
      }

      // Filter by MIME type if specified
      if (options.mimeTypes && options.mimeTypes.length > 0) {
        if (!options.mimeTypes.includes(file.mimeType)) {
          continue;
        }
      }

      // Only include supported file types
      if (isSupportedFileType(file.mimeType)) {
        files.push(file);
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Recursively list subfolders
  for (const subfolderId of subfolders) {
    const subfolderFiles = await listFilesInFolder(accessToken, subfolderId, options);
    files.push(...subfolderFiles);
  }

  return files;
}

/**
 * Check if a file type is supported
 */
function isSupportedFileType(mimeType: string): boolean {
  const supportedTypes = [
    GOOGLE_DOC_MIME,
    GOOGLE_SHEET_MIME,
    MARKDOWN_MIME,
    TEXT_MIME,
    'text/html',
    'application/pdf',
  ];
  return supportedTypes.includes(mimeType);
}

/**
 * Process a single file into a KnowledgeDocument
 */
async function processFile(
  file: DriveFile,
  accessToken: string,
  config: GoogleDriveSourceConfig
): Promise<KnowledgeDocument | null> {
  let content: string;

  // Export or download based on file type
  if (file.mimeType === GOOGLE_DOC_MIME) {
    content = await exportGoogleDoc(accessToken, file.id);
  } else if (file.mimeType === GOOGLE_SHEET_MIME) {
    content = await exportGoogleSheet(accessToken, file.id);
  } else if (file.mimeType === MARKDOWN_MIME || file.mimeType === TEXT_MIME) {
    content = await downloadFile(accessToken, file.id);
  } else {
    // Unsupported file type for now
    return null;
  }

  if (!content || content.trim().length === 0) {
    return null;
  }

  // Extract metadata from file properties
  const docType = inferTypeFromProperties(file);
  const services = extractServicesFromProperties(file);
  const tags = extractTagsFromProperties(file);

  // Generate document ID
  const id = `gdrive_${file.id}`;

  // Chunk the content
  const chunks = chunkMarkdown(id, content);

  return {
    id,
    source: {
      type: 'google_drive',
      name: 'google_drive',
      config,
    },
    type: docType,
    title: file.name.replace(/\.(md|txt)$/, ''),
    content,
    chunks,
    services,
    tags,
    severityRelevance: extractSeverityFromProperties(file),
    createdAt: file.createdTime,
    updatedAt: file.modifiedTime,
    sourceUrl: file.webViewLink,
  };
}

/**
 * Export Google Doc to plain text (markdown-like)
 */
async function exportGoogleDoc(accessToken: string, fileId: string): Promise<string> {
  const url = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/plain`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to export Google Doc ${fileId}: ${response.status}`);
  }

  return response.text();
}

/**
 * Export Google Sheet to markdown table format
 */
async function exportGoogleSheet(accessToken: string, fileId: string): Promise<string> {
  // Export as CSV then convert to markdown table
  const url = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/csv`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to export Google Sheet ${fileId}: ${response.status}`);
  }

  const csv = await response.text();
  return csvToMarkdownTable(csv);
}

/**
 * Download a regular file
 */
async function downloadFile(accessToken: string, fileId: string): Promise<string> {
  const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status}`);
  }

  return response.text();
}

/**
 * Convert CSV to markdown table
 */
function csvToMarkdownTable(csv: string): string {
  const lines = csv.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return '';
  }

  const rows = lines.map((line) => parseCSVLine(line));
  if (rows.length === 0) {
    return '';
  }

  // Build markdown table
  const header = rows[0];
  const headerRow = '| ' + header.join(' | ') + ' |';
  const separatorRow = '| ' + header.map(() => '---').join(' | ') + ' |';

  const dataRows = rows.slice(1).map((row) => '| ' + row.join(' | ') + ' |');

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

/**
 * Parse a CSV line (handles quoted values)
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Infer document type from file properties or name
 */
function inferTypeFromProperties(file: DriveFile): KnowledgeType {
  // Check custom properties first
  const typeProperty = file.properties?.type?.toLowerCase();
  if (typeProperty) {
    if (typeProperty === 'runbook' || typeProperty === 'playbook') return 'runbook';
    if (typeProperty === 'postmortem' || typeProperty === 'post-mortem') return 'postmortem';
    if (typeProperty === 'architecture' || typeProperty === 'design') return 'architecture';
    if (typeProperty === 'known_issue' || typeProperty === 'known-issue') return 'known_issue';
    if (typeProperty === 'faq') return 'faq';
  }

  // Infer from filename
  const lowerName = file.name.toLowerCase();
  if (lowerName.includes('runbook') || lowerName.includes('playbook')) return 'runbook';
  if (lowerName.includes('postmortem') || lowerName.includes('post-mortem')) return 'postmortem';
  if (
    lowerName.includes('architecture') ||
    lowerName.includes('design') ||
    lowerName.includes('adr')
  )
    return 'architecture';
  if (lowerName.includes('known-issue') || lowerName.includes('known_issue')) return 'known_issue';

  // Infer from description
  if (file.description) {
    const lowerDesc = file.description.toLowerCase();
    if (lowerDesc.includes('runbook')) return 'runbook';
    if (lowerDesc.includes('postmortem')) return 'postmortem';
    if (lowerDesc.includes('architecture')) return 'architecture';
  }

  return 'runbook';
}

/**
 * Extract service names from file properties
 */
function extractServicesFromProperties(file: DriveFile): string[] {
  const servicesProperty = file.properties?.services;
  if (servicesProperty) {
    return servicesProperty
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extract tags from file properties
 */
function extractTagsFromProperties(file: DriveFile): string[] {
  const tagsProperty = file.properties?.tags;
  if (tagsProperty) {
    return tagsProperty
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extract severity relevance from file properties
 */
function extractSeverityFromProperties(file: DriveFile): Array<'sev1' | 'sev2' | 'sev3'> {
  const severityProperty = file.properties?.severity?.toLowerCase();
  if (!severityProperty) return [];

  const severities: Array<'sev1' | 'sev2' | 'sev3'> = [];
  if (severityProperty.includes('sev1') || severityProperty.includes('critical')) {
    severities.push('sev1');
  }
  if (severityProperty.includes('sev2') || severityProperty.includes('high')) {
    severities.push('sev2');
  }
  if (severityProperty.includes('sev3') || severityProperty.includes('medium')) {
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
