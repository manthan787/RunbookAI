/**
 * Citation Context
 *
 * Tracks and formats numbered source citations from knowledge retrieval.
 * Used to provide transparent source references in agent answers.
 */

import type { KnowledgeChunk } from './types';

export interface Citation {
  /** Unique citation ID (1-based) */
  id: number;
  /** Type of knowledge source */
  type: 'runbook' | 'postmortem' | 'known_issue' | 'architecture';
  /** Document title */
  title: string;
  /** Optional source URL or path */
  sourceUrl?: string;
  /** Relevance score (0-100) */
  score: number;
  /** Document ID for deduplication */
  documentId: string;
  /** Services related to this citation */
  services: string[];
}

export interface CitationContextOptions {
  /** Maximum number of citations to track */
  maxCitations?: number;
  /** Minimum score threshold for inclusion */
  minScore?: number;
  /** Include scores in formatted output */
  showScores?: boolean;
}

const DEFAULT_OPTIONS: CitationContextOptions = {
  maxCitations: 10,
  minScore: 0,
  showScores: true,
};

/**
 * Manages citations during an agent run
 */
export class CitationContext {
  private citations: Map<string, Citation> = new Map();
  private nextId = 1;
  private options: CitationContextOptions;

  constructor(options: Partial<CitationContextOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add a knowledge chunk as a citation
   * @returns Citation ID for reference in text
   */
  add(chunk: KnowledgeChunk): number {
    // Use documentId for deduplication, fall back to id or title
    const key = chunk.documentId || chunk.id || chunk.title;

    // Check if already cited
    const existing = this.citations.get(key);
    if (existing) {
      // Update score if higher
      if (chunk.score > existing.score) {
        existing.score = chunk.score;
      }
      return existing.id;
    }

    // Check score threshold
    const scorePercent = Math.round(chunk.score * 100);
    if (scorePercent < (this.options.minScore || 0)) {
      return -1; // Not added
    }

    // Check capacity
    if (this.citations.size >= (this.options.maxCitations || 10)) {
      // Find lowest scoring citation
      let lowestKey: string | null = null;
      let lowestScore = Infinity;
      for (const [k, c] of this.citations) {
        if (c.score < lowestScore) {
          lowestScore = c.score;
          lowestKey = k;
        }
      }
      // Only replace if new citation has higher score
      if (lowestKey && scorePercent > lowestScore) {
        this.citations.delete(lowestKey);
      } else {
        return -1; // Not added, at capacity with higher-scoring citations
      }
    }

    const citation: Citation = {
      id: this.nextId++,
      type: this.normalizeType(chunk.type),
      title: chunk.title,
      sourceUrl: chunk.sourceUrl,
      score: scorePercent,
      documentId: key,
      services: chunk.services || [],
    };

    this.citations.set(key, citation);
    return citation.id;
  }

  /**
   * Add multiple knowledge chunks
   */
  addAll(chunks: KnowledgeChunk[]): number[] {
    return chunks.map((chunk) => this.add(chunk));
  }

  /**
   * Get a citation by ID
   */
  get(id: number): Citation | undefined {
    for (const citation of this.citations.values()) {
      if (citation.id === id) {
        return citation;
      }
    }
    return undefined;
  }

  /**
   * Get all citations sorted by ID
   */
  getAll(): Citation[] {
    return Array.from(this.citations.values()).sort((a, b) => a.id - b.id);
  }

  /**
   * Get citations sorted by score (highest first)
   */
  getByScore(): Citation[] {
    return Array.from(this.citations.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Get citations filtered by type
   */
  getByType(type: Citation['type']): Citation[] {
    return this.getAll().filter((c) => c.type === type);
  }

  /**
   * Format citations as markdown for inclusion in answers
   *
   * Example output:
   * ## Sources
   * 1. Redis Connection Exhaustion Runbook (92%) - .runbook/runbooks/redis.md
   * 2. 2024-01 Redis Outage Postmortem (78%) - confluence://SRE/pm-2024-01
   */
  formatMarkdown(): string {
    const citations = this.getAll();
    if (citations.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('## Sources');
    lines.push('');

    for (const citation of citations) {
      const typeLabel = this.formatTypeLabel(citation.type);
      const scoreStr = this.options.showScores ? ` (${citation.score}%)` : '';
      const sourceStr = citation.sourceUrl ? ` - ${citation.sourceUrl}` : '';

      lines.push(`${citation.id}. [${typeLabel}] ${citation.title}${scoreStr}${sourceStr}`);
    }

    return lines.join('\n');
  }

  /**
   * Format citations as a compact inline reference list
   *
   * Example output: "Sources: [1] Redis Runbook, [2] Postmortem 2024-01"
   */
  formatInline(): string {
    const citations = this.getAll();
    if (citations.length === 0) {
      return '';
    }

    const refs = citations.map((c) => `[${c.id}] ${c.title}`).join(', ');
    return `Sources: ${refs}`;
  }

  /**
   * Format for non-TTY output (plain text)
   */
  formatPlain(): string {
    const citations = this.getAll();
    if (citations.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('Sources:');

    for (const citation of citations) {
      const typeLabel = this.formatTypeLabel(citation.type);
      const scoreStr = this.options.showScores ? ` (${citation.score}%)` : '';
      const sourceStr = citation.sourceUrl ? `\n   Location: ${citation.sourceUrl}` : '';

      lines.push(`  ${citation.id}. [${typeLabel}] ${citation.title}${scoreStr}${sourceStr}`);
    }

    return lines.join('\n');
  }

  /**
   * Create a citation reference for use in text
   *
   * Example: "[1]" or "[1,2,3]"
   */
  createReference(...ids: number[]): string {
    const validIds = ids.filter((id) => this.get(id) !== undefined);
    if (validIds.length === 0) {
      return '';
    }
    return `[${validIds.join(',')}]`;
  }

  /**
   * Get number of citations
   */
  get count(): number {
    return this.citations.size;
  }

  /**
   * Check if there are any citations
   */
  get hasCitations(): boolean {
    return this.citations.size > 0;
  }

  /**
   * Clear all citations
   */
  clear(): void {
    this.citations.clear();
    this.nextId = 1;
  }

  /**
   * Get citation statistics
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    avgScore: number;
    maxScore: number;
    minScore: number;
  } {
    const citations = this.getAll();
    const byType: Record<string, number> = {};

    let totalScore = 0;
    let maxScore = 0;
    let minScore = 100;

    for (const citation of citations) {
      byType[citation.type] = (byType[citation.type] || 0) + 1;
      totalScore += citation.score;
      maxScore = Math.max(maxScore, citation.score);
      minScore = Math.min(minScore, citation.score);
    }

    return {
      total: citations.length,
      byType,
      avgScore: citations.length > 0 ? Math.round(totalScore / citations.length) : 0,
      maxScore: citations.length > 0 ? maxScore : 0,
      minScore: citations.length > 0 ? minScore : 0,
    };
  }

  /**
   * Normalize chunk type to Citation type
   */
  private normalizeType(type: string): Citation['type'] {
    const typeMap: Record<string, Citation['type']> = {
      runbook: 'runbook',
      postmortem: 'postmortem',
      post_mortem: 'postmortem',
      'post-mortem': 'postmortem',
      known_issue: 'known_issue',
      known_issues: 'known_issue',
      architecture: 'architecture',
      arch: 'architecture',
    };

    return typeMap[type.toLowerCase()] || 'runbook';
  }

  /**
   * Format type as readable label
   */
  private formatTypeLabel(type: Citation['type']): string {
    const labels: Record<Citation['type'], string> = {
      runbook: 'Runbook',
      postmortem: 'Postmortem',
      known_issue: 'Known Issue',
      architecture: 'Architecture',
    };

    return labels[type] || type;
  }
}

/**
 * Create a citation context instance
 */
export function createCitationContext(options?: Partial<CitationContextOptions>): CitationContext {
  return new CitationContext(options);
}
