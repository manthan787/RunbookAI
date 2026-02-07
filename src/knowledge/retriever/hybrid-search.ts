/**
 * Hybrid Search
 *
 * Combines full-text search (FTS) and vector similarity search for
 * better knowledge retrieval. Uses reciprocal rank fusion (RRF) to
 * merge results from both approaches.
 */

import { KnowledgeStore } from '../store/sqlite';
import { VectorStore, createVectorStore } from '../store/vector-store';
import { isEmbedderConfigured } from '../indexer/embedder';
import type { RetrievedChunk, KnowledgeType, RetrievedKnowledge } from '../types';

export interface HybridSearchConfig {
  storePath: string;
  vectorStorePath?: string;
  ftsWeight?: number; // Weight for FTS results (default: 0.4)
  vectorWeight?: number; // Weight for vector results (default: 0.6)
  rrf_k?: number; // RRF parameter (default: 60)
}

export class HybridRetriever {
  private ftsStore: KnowledgeStore;
  private vectorStore: VectorStore | null = null;
  private config: HybridSearchConfig;

  constructor(config: HybridSearchConfig) {
    this.config = {
      ftsWeight: config.ftsWeight ?? 0.4,
      vectorWeight: config.vectorWeight ?? 0.6,
      rrf_k: config.rrf_k ?? 60,
      ...config,
    };

    this.ftsStore = new KnowledgeStore(config.storePath);

    // Only initialize vector store if embedder is configured
    if (isEmbedderConfigured()) {
      const vectorPath = config.vectorStorePath || config.storePath.replace('.db', '_vectors.db');
      this.vectorStore = createVectorStore(vectorPath.replace('/vectors.db', ''));
    }
  }

  /**
   * Check if vector search is available
   */
  hasVectorSearch(): boolean {
    return this.vectorStore !== null && isEmbedderConfigured();
  }

  /**
   * Perform hybrid search combining FTS and vector similarity
   */
  async search(
    query: string,
    options: {
      topK?: number;
      typeFilter?: KnowledgeType[];
      serviceFilter?: string[];
      mode?: 'hybrid' | 'fts' | 'vector';
    } = {}
  ): Promise<RetrievedChunk[]> {
    const topK = options.topK || 10;
    const mode = options.mode || (this.hasVectorSearch() ? 'hybrid' : 'fts');

    // FTS-only mode
    if (mode === 'fts' || !this.hasVectorSearch()) {
      return this.ftsStore.search(query, {
        typeFilter: options.typeFilter,
        serviceFilter: options.serviceFilter,
        limit: topK,
      });
    }

    // Vector-only mode
    if (mode === 'vector' && this.vectorStore) {
      return this.vectorStore.search(query, {
        topK,
        typeFilter: options.typeFilter,
        serviceFilter: options.serviceFilter,
      });
    }

    // Hybrid mode: combine FTS and vector results
    const [ftsResults, vectorResults] = await Promise.all([
      this.ftsStore.search(query, {
        typeFilter: options.typeFilter,
        serviceFilter: options.serviceFilter,
        limit: topK * 2, // Get more for fusion
      }),
      this.vectorStore!.search(query, {
        topK: topK * 2,
        typeFilter: options.typeFilter,
        serviceFilter: options.serviceFilter,
      }),
    ]);

    // Apply Reciprocal Rank Fusion (RRF)
    return this.reciprocalRankFusion(ftsResults, vectorResults, topK);
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * Combines rankings from multiple sources into a single ranking
   */
  private reciprocalRankFusion(
    ftsResults: RetrievedChunk[],
    vectorResults: RetrievedChunk[],
    topK: number
  ): RetrievedChunk[] {
    const k = this.config.rrf_k!;
    const ftsWeight = this.config.ftsWeight!;
    const vectorWeight = this.config.vectorWeight!;

    const scores = new Map<string, { chunk: RetrievedChunk; score: number }>();

    // Add FTS scores
    for (let i = 0; i < ftsResults.length; i++) {
      const chunk = ftsResults[i];
      const rrfScore = ftsWeight * (1 / (k + i + 1));

      const existing = scores.get(chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(chunk.id, { chunk, score: rrfScore });
      }
    }

    // Add vector scores
    for (let i = 0; i < vectorResults.length; i++) {
      const chunk = vectorResults[i];
      const rrfScore = vectorWeight * (1 / (k + i + 1));

      const existing = scores.get(chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(chunk.id, { chunk, score: rrfScore });
      }
    }

    // Sort by combined score and return top K
    const results = Array.from(scores.values());
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK).map((r) => ({
      ...r.chunk,
      score: r.score,
    }));
  }

  /**
   * Search and organize by knowledge type
   */
  async searchByType(
    query: string,
    options: {
      topK?: number;
      serviceFilter?: string[];
    } = {}
  ): Promise<RetrievedKnowledge> {
    const results = await this.search(query, {
      topK: options.topK || 20,
      serviceFilter: options.serviceFilter,
    });

    const knowledge: RetrievedKnowledge = {
      runbooks: [],
      postmortems: [],
      architecture: [],
      knownIssues: [],
    };

    for (const chunk of results) {
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
   * Get runbooks for a specific service using hybrid search
   */
  async getRunbooksForService(serviceName: string): Promise<RetrievedChunk[]> {
    return this.search(`runbook for ${serviceName}`, {
      topK: 5,
      typeFilter: ['runbook'],
      serviceFilter: [serviceName],
    });
  }

  /**
   * Find similar past incidents
   */
  async findSimilarIncidents(description: string): Promise<RetrievedChunk[]> {
    return this.search(description, {
      topK: 5,
      typeFilter: ['postmortem', 'known_issue'],
    });
  }

  /**
   * Get architecture context for services
   */
  async getArchitectureContext(services: string[]): Promise<RetrievedChunk[]> {
    const query = `architecture dependencies ${services.join(' ')}`;
    return this.search(query, {
      topK: 5,
      typeFilter: ['architecture'],
      serviceFilter: services,
    });
  }

  /**
   * Close all stores
   */
  close(): void {
    this.ftsStore.close();
    this.vectorStore?.close();
  }
}

/**
 * Create a hybrid retriever with default configuration
 */
export function createHybridRetriever(baseDir: string = '.runbook'): HybridRetriever {
  return new HybridRetriever({
    storePath: `${baseDir}/knowledge.db`,
    vectorStorePath: `${baseDir}/vectors.db`,
  });
}
