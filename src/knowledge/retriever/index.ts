/**
 * Knowledge Retriever
 *
 * Coordinates knowledge retrieval from multiple sources and the store.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { KnowledgeStore } from '../store/sqlite';
import { loadFromSource } from '../sources';
import type {
  RetrievedKnowledge,
  KnowledgeType,
  KnowledgeSourceConfig,
  FilesystemSourceConfig,
  KnowledgeDocument,
} from '../types';

export interface RetrieverConfig {
  storePath: string;
  sources: KnowledgeSourceConfig[];
}

export class KnowledgeRetriever {
  private store: KnowledgeStore;
  private config: RetrieverConfig;
  private initialized = false;

  constructor(config: RetrieverConfig) {
    this.config = config;

    // Ensure directory exists
    const dir = join(config.storePath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.store = new KnowledgeStore(config.storePath);
  }

  /**
   * Sync knowledge from all configured sources
   */
  async sync(): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;

    for (const source of this.config.sources) {
      const lastSync = 'lastSyncTime' in source ? source.lastSyncTime : undefined;
      const documents = await loadFromSource(source, { since: lastSync });

      for (const doc of documents) {
        const existing = this.store.getDocument(doc.id);
        if (existing) {
          updated++;
        } else {
          added++;
        }
        this.store.upsertDocument(doc);
      }

      // Update lastSyncTime for incremental sync support
      if ('lastSyncTime' in source) {
        (source as { lastSyncTime?: string }).lastSyncTime = new Date().toISOString();
      }
    }

    this.initialized = true;
    return { added, updated };
  }

  /**
   * Initialize if not already done
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.store.getDocumentCount() === 0) {
      await this.sync();
    }
    this.initialized = true;
  }

  /**
   * Search for relevant knowledge
   */
  async search(
    query: string,
    options: {
      typeFilter?: KnowledgeType[];
      serviceFilter?: string[];
      limit?: number;
    } = {}
  ): Promise<RetrievedKnowledge> {
    await this.ensureInitialized();

    const allResults = this.store.search(query, {
      ...options,
      limit: options.limit || 20,
    });

    // Organize by type
    const knowledge: RetrievedKnowledge = {
      runbooks: [],
      postmortems: [],
      architecture: [],
      knownIssues: [],
    };

    for (const chunk of allResults) {
      switch (chunk.type) {
        case 'runbook':
          knowledge.runbooks.push(chunk);
          break;
        case 'postmortem':
          knowledge.postmortems.push(chunk);
          break;
        case 'architecture':
          knowledge.architecture.push(chunk);
          break;
        case 'known_issue':
          knowledge.knownIssues.push(chunk);
          break;
      }
    }

    return knowledge;
  }

  /**
   * Get runbooks for specific services
   */
  async getRunbooksForService(serviceName: string): Promise<RetrievedKnowledge> {
    return this.search(serviceName, {
      typeFilter: ['runbook'],
      serviceFilter: [serviceName],
    });
  }

  /**
   * Get document count
   */
  getDocumentCount(): number {
    return this.store.getDocumentCount();
  }

  /**
   * Get document counts grouped by type.
   */
  getDocumentCountsByType(): Record<KnowledgeType, number> {
    return this.store.getDocumentCountsByType();
  }

  /**
   * Get all stored documents.
   */
  getAllDocuments(): KnowledgeDocument[] {
    return this.store.getAllDocuments();
  }

  /**
   * Close the store
   */
  close(): void {
    this.store.close();
  }
}

/**
 * Create a retriever with default configuration
 */
export function createRetriever(baseDir: string = '.runbook'): KnowledgeRetriever {
  const storePath = join(baseDir, 'knowledge.db');

  const sources: FilesystemSourceConfig[] = [
    {
      type: 'filesystem',
      path: join(baseDir, 'runbooks'),
      filePatterns: ['**/*.md', '**/*.yaml'],
    },
  ];

  // Also check for examples
  if (existsSync('examples/runbooks')) {
    sources.push({
      type: 'filesystem',
      path: 'examples/runbooks',
      filePatterns: ['**/*.md'],
    });
  }

  return new KnowledgeRetriever({ storePath, sources });
}
