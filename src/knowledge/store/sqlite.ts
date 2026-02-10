/**
 * SQLite Knowledge Store
 *
 * Stores knowledge documents and chunks in SQLite for fast retrieval.
 * Uses simple keyword search (vector search can be added later).
 */

import Database from 'better-sqlite3';
import type { KnowledgeDocument, KnowledgeChunk, RetrievedChunk, KnowledgeType } from '../types';

export class KnowledgeStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        services TEXT,
        tags TEXT,
        symptoms TEXT,
        severity_relevance TEXT,
        source_url TEXT,
        author TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_validated TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        section_title TEXT,
        chunk_type TEXT,
        line_start INTEGER,
        line_end INTEGER,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      );

      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
      CREATE INDEX IF NOT EXISTS idx_documents_services ON documents(services);
      CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

      -- Full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        section_title,
        content='chunks',
        content_rowid='rowid'
      );

      -- Trigger to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content, section_title)
        VALUES (NEW.rowid, NEW.content, NEW.section_title);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content, section_title)
        VALUES('delete', OLD.rowid, OLD.content, OLD.section_title);
      END;
    `);
  }

  /**
   * Insert or update a document
   */
  upsertDocument(doc: KnowledgeDocument): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents
      (id, type, title, content, services, tags, symptoms, severity_relevance,
       source_url, author, created_at, updated_at, last_validated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.id,
      doc.type,
      doc.title,
      doc.content,
      JSON.stringify(doc.services),
      JSON.stringify(doc.tags),
      JSON.stringify(doc.symptoms || []),
      JSON.stringify(doc.severityRelevance),
      this.toNullableText(doc.sourceUrl),
      this.toNullableText(doc.author),
      this.toNullableText(doc.createdAt),
      this.toNullableText(doc.updatedAt),
      this.toNullableText(doc.lastValidated)
    );

    // Delete old chunks
    this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(doc.id);

    // Insert new chunks
    const chunkStmt = this.db.prepare(`
      INSERT INTO chunks (id, document_id, content, section_title, chunk_type, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of doc.chunks) {
      chunkStmt.run(
        chunk.id,
        doc.id,
        chunk.content,
        chunk.sectionTitle,
        chunk.chunkType,
        chunk.lineStart,
        chunk.lineEnd
      );
    }
  }

  /**
   * Search for relevant chunks using full-text search
   */
  search(
    query: string,
    options: {
      typeFilter?: KnowledgeType[];
      serviceFilter?: string[];
      limit?: number;
    } = {}
  ): RetrievedChunk[] {
    const limit = options.limit || 10;
    const safeQuery = typeof query === 'string' ? query : String(query ?? '');
    const typeFilter = this.normalizeStringArray(options.typeFilter);
    const serviceFilter = this.normalizeStringArray(options.serviceFilter);

    // Build FTS query
    const ftsTerms = safeQuery
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .map((t) => `"${t}"*`)
      .join(' OR ');

    if (!ftsTerms) {
      return [];
    }

    let sql = `
      SELECT
        c.id,
        c.document_id,
        c.content,
        c.section_title,
        c.chunk_type,
        d.title,
        d.type,
        d.services,
        d.source_url,
        bm25(chunks_fts) as score
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.rowid
      JOIN documents d ON c.document_id = d.id
      WHERE chunks_fts MATCH ?
    `;

    const params: (string | number)[] = [ftsTerms];

    // Add type filter
    if (typeFilter.length > 0) {
      sql += ` AND d.type IN (${typeFilter.map(() => '?').join(',')})`;
      params.push(...typeFilter);
    }

    // Add service filter
    if (serviceFilter.length > 0) {
      const serviceConditions = serviceFilter.map(() => `d.services LIKE ?`).join(' OR ');
      sql += ` AND (${serviceConditions})`;
      params.push(...serviceFilter.map((s) => `%"${s}"%`));
    }

    sql += ` ORDER BY score LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      document_id: string;
      content: string;
      section_title: string | null;
      chunk_type: string;
      title: string;
      type: string;
      services: string;
      source_url: string | null;
      score: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      title: row.section_title || row.title,
      content: row.content,
      type: row.type as KnowledgeType,
      services: JSON.parse(row.services || '[]'),
      score: Math.abs(row.score), // BM25 returns negative scores
      sourceUrl: row.source_url || undefined,
    }));
  }

  /**
   * Get all documents of a specific type
   */
  getDocumentsByType(type: KnowledgeType): KnowledgeDocument[] {
    const stmt = this.db.prepare('SELECT * FROM documents WHERE type = ?');
    const rows = stmt.all(type) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToDocument(row));
  }

  /**
   * Get all documents.
   */
  getAllDocuments(): KnowledgeDocument[] {
    const stmt = this.db.prepare('SELECT * FROM documents');
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToDocument(row));
  }

  /**
   * Get document counts grouped by type.
   */
  getDocumentCountsByType(): Record<KnowledgeType, number> {
    const counts: Record<KnowledgeType, number> = {
      runbook: 0,
      postmortem: 0,
      architecture: 0,
      ownership: 0,
      known_issue: 0,
      environment: 0,
      playbook: 0,
      faq: 0,
    };

    const stmt = this.db.prepare('SELECT type, COUNT(*) as count FROM documents GROUP BY type');
    const rows = stmt.all() as Array<{ type: string; count: number }>;

    for (const row of rows) {
      const type = row.type as KnowledgeType;
      if (type in counts) {
        counts[type] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get a document by ID
   */
  getDocument(id: string): KnowledgeDocument | null {
    const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    const doc = this.rowToDocument(row);

    // Get chunks
    const chunkStmt = this.db.prepare('SELECT * FROM chunks WHERE document_id = ?');
    const chunkRows = chunkStmt.all(id) as Array<Record<string, unknown>>;

    doc.chunks = chunkRows.map((cr) => ({
      id: cr.id as string,
      documentId: cr.document_id as string,
      content: cr.content as string,
      sectionTitle: cr.section_title as string | undefined,
      chunkType: cr.chunk_type as KnowledgeChunk['chunkType'],
      lineStart: cr.line_start as number | undefined,
      lineEnd: cr.line_end as number | undefined,
    }));

    return doc;
  }

  private rowToDocument(row: Record<string, unknown>): KnowledgeDocument {
    return {
      id: row.id as string,
      source: {
        type: 'filesystem',
        name: 'local',
        config: { type: 'filesystem', path: '', filePatterns: [] },
      },
      type: row.type as KnowledgeType,
      title: row.title as string,
      content: row.content as string,
      chunks: [],
      services: JSON.parse((row.services as string) || '[]'),
      tags: JSON.parse((row.tags as string) || '[]'),
      severityRelevance: JSON.parse((row.severity_relevance as string) || '[]'),
      symptoms: JSON.parse((row.symptoms as string) || '[]'),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      author: row.author as string | undefined,
      sourceUrl: row.source_url as string | undefined,
      lastValidated: row.last_validated as string | undefined,
    };
  }

  /**
   * Get document count
   */
  getDocumentCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM documents');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.db.exec('DELETE FROM chunks');
    this.db.exec('DELETE FROM documents');
  }

  /**
   * Close the database
   */
  close(): void {
    this.db.close();
  }

  private toNullableText(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item === null || item === undefined) return '';
        if (item instanceof Date) return item.toISOString();
        return String(item);
      })
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
