/**
 * Vector Store
 *
 * Stores and retrieves vector embeddings for semantic search.
 * Uses SQLite for persistence with in-memory similarity calculation.
 * (For production, consider sqlite-vss or a dedicated vector DB)
 */

import Database from 'better-sqlite3';
import { embedText, embedTexts, cosineSimilarity, isEmbedderConfigured } from '../indexer/embedder';
import type { KnowledgeChunk, RetrievedChunk, KnowledgeType } from '../types';

export interface VectorDocument {
  id: string;
  chunkId: string;
  documentId: string;
  embedding: number[];
  content: string;
  title?: string;
  type: KnowledgeType;
  services: string[];
}

export class VectorStore {
  private db: Database.Database;
  private embeddings: Map<string, number[]> = new Map();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
    this.loadEmbeddings();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        content TEXT NOT NULL,
        title TEXT,
        type TEXT NOT NULL,
        services TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_vector_document_id ON vector_embeddings(document_id);
      CREATE INDEX IF NOT EXISTS idx_vector_type ON vector_embeddings(type);
    `);
  }

  /**
   * Load all embeddings into memory for fast similarity search
   */
  private loadEmbeddings(): void {
    const rows = this.db.prepare('SELECT id, embedding FROM vector_embeddings').all() as Array<{
      id: string;
      embedding: Buffer;
    }>;

    for (const row of rows) {
      const embedding = this.bufferToFloatArray(row.embedding);
      this.embeddings.set(row.id, embedding);
    }
  }

  /**
   * Convert Float64Array to Buffer for storage
   */
  private floatArrayToBuffer(arr: number[]): Buffer {
    const buffer = Buffer.alloc(arr.length * 8);
    for (let i = 0; i < arr.length; i++) {
      buffer.writeDoubleLE(arr[i], i * 8);
    }
    return buffer;
  }

  /**
   * Convert Buffer back to number array
   */
  private bufferToFloatArray(buffer: Buffer): number[] {
    const arr: number[] = [];
    for (let i = 0; i < buffer.length; i += 8) {
      arr.push(buffer.readDoubleLE(i));
    }
    return arr;
  }

  /**
   * Add a chunk with its embedding
   */
  async addChunk(
    chunk: KnowledgeChunk,
    documentTitle: string,
    type: KnowledgeType,
    services: string[]
  ): Promise<void> {
    if (!isEmbedderConfigured()) {
      throw new Error('Embedder not configured. Set OPENAI_API_KEY.');
    }

    // Generate embedding
    const embedding = await embedText(
      [documentTitle, chunk.sectionTitle, chunk.content].filter(Boolean).join('\n\n')
    );

    const id = `vec_${chunk.id}`;

    // Store in database
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vector_embeddings
      (id, chunk_id, document_id, embedding, content, title, type, services)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      chunk.id,
      chunk.documentId,
      this.floatArrayToBuffer(embedding),
      chunk.content,
      chunk.sectionTitle || documentTitle,
      type,
      JSON.stringify(services)
    );

    // Update in-memory cache
    this.embeddings.set(id, embedding);
  }

  /**
   * Add multiple chunks with embeddings (batch processing)
   */
  async addChunks(
    chunks: Array<{
      chunk: KnowledgeChunk;
      documentTitle: string;
      type: KnowledgeType;
      services: string[];
    }>
  ): Promise<void> {
    if (!isEmbedderConfigured()) {
      throw new Error('Embedder not configured. Set OPENAI_API_KEY.');
    }

    // Prepare texts for batch embedding
    const texts = chunks.map((c) =>
      [c.documentTitle, c.chunk.sectionTitle, c.chunk.content].filter(Boolean).join('\n\n')
    );

    // Generate embeddings in batch
    const embeddings = await embedTexts(texts);

    // Store all
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vector_embeddings
      (id, chunk_id, document_id, embedding, content, title, type, services)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, documentTitle, type, services } = chunks[i];
        const id = `vec_${chunk.id}`;

        stmt.run(
          id,
          chunk.id,
          chunk.documentId,
          this.floatArrayToBuffer(embeddings[i]),
          chunk.content,
          chunk.sectionTitle || documentTitle,
          type,
          JSON.stringify(services)
        );

        this.embeddings.set(id, embeddings[i]);
      }
    });

    transaction();
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async search(
    query: string,
    options: {
      topK?: number;
      typeFilter?: KnowledgeType[];
      serviceFilter?: string[];
      minScore?: number;
    } = {}
  ): Promise<RetrievedChunk[]> {
    if (!isEmbedderConfigured()) {
      throw new Error('Embedder not configured. Set OPENAI_API_KEY.');
    }

    const topK = options.topK || 10;
    const minScore = options.minScore || 0.5;

    // Generate query embedding
    const queryEmbedding = await embedText(query);

    // Calculate similarities
    const scored: Array<{ id: string; score: number }> = [];

    for (const [id, embedding] of this.embeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score >= minScore) {
        scored.push({ id, score });
      }
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Get top results
    const topIds = scored.slice(0, topK * 2).map((s) => s.id); // Get extra for filtering

    if (topIds.length === 0) {
      return [];
    }

    // Fetch full data from database
    const placeholders = topIds.map(() => '?').join(',');
    let sql = `
      SELECT id, chunk_id, document_id, content, title, type, services
      FROM vector_embeddings
      WHERE id IN (${placeholders})
    `;

    const params: (string | number)[] = [...topIds];

    // Add type filter
    if (options.typeFilter && options.typeFilter.length > 0) {
      sql += ` AND type IN (${options.typeFilter.map(() => '?').join(',')})`;
      params.push(...options.typeFilter);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      chunk_id: string;
      document_id: string;
      content: string;
      title: string | null;
      type: string;
      services: string;
    }>;

    // Build result with scores
    const scoreMap = new Map(scored.map((s) => [s.id, s.score]));
    const results: RetrievedChunk[] = [];

    for (const row of rows) {
      const services = JSON.parse(row.services || '[]') as string[];

      // Apply service filter
      if (options.serviceFilter && options.serviceFilter.length > 0) {
        const hasMatch = options.serviceFilter.some((s) => services.includes(s));
        if (!hasMatch) continue;
      }

      results.push({
        id: row.chunk_id,
        documentId: row.document_id,
        title: row.title || '',
        content: row.content,
        type: row.type as KnowledgeType,
        services,
        score: scoreMap.get(row.id) || 0,
      });
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Delete embeddings for a document
   */
  deleteDocument(documentId: string): void {
    // Remove from in-memory cache
    const rows = this.db
      .prepare('SELECT id FROM vector_embeddings WHERE document_id = ?')
      .all(documentId) as Array<{ id: string }>;

    for (const row of rows) {
      this.embeddings.delete(row.id);
    }

    // Remove from database
    this.db.prepare('DELETE FROM vector_embeddings WHERE document_id = ?').run(documentId);
  }

  /**
   * Get embedding count
   */
  getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM vector_embeddings').get() as {
      count: number;
    };
    return result.count;
  }

  /**
   * Check if a document has embeddings
   */
  hasDocument(documentId: string): boolean {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM vector_embeddings WHERE document_id = ?')
      .get(documentId) as { count: number };
    return result.count > 0;
  }

  /**
   * Clear all embeddings
   */
  clear(): void {
    this.db.exec('DELETE FROM vector_embeddings');
    this.embeddings.clear();
  }

  /**
   * Close the database
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Create a vector store with default path
 */
export function createVectorStore(baseDir: string = '.runbook'): VectorStore {
  const dbPath = `${baseDir}/vectors.db`;
  return new VectorStore(dbPath);
}
