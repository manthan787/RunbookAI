/**
 * Embedder
 *
 * Generate vector embeddings for knowledge chunks using OpenAI's embedding models.
 * Supports batch processing and caching.
 */

import { createHash } from 'crypto';

interface EmbedderConfig {
  apiKey: string;
  model?: string;
  batchSize?: number;
  dimensions?: number;
}

let config: EmbedderConfig | null = null;

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_DIMENSIONS = 1536;

// Simple in-memory cache for embeddings
const embeddingCache = new Map<string, number[]>();

export function configure(apiKey: string, options?: Partial<EmbedderConfig>): void {
  config = {
    apiKey,
    model: options?.model || DEFAULT_MODEL,
    batchSize: options?.batchSize || DEFAULT_BATCH_SIZE,
    dimensions: options?.dimensions || DEFAULT_DIMENSIONS,
  };
}

function getApiKey(): string {
  if (config?.apiKey) return config.apiKey;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
}

export function isEmbedderConfigured(): boolean {
  return !!(config?.apiKey || process.env.OPENAI_API_KEY);
}

/**
 * Generate a cache key for a text
 */
function getCacheKey(text: string, model: string): string {
  const hash = createHash('md5').update(text).digest('hex');
  return `${model}:${hash}`;
}

/**
 * Generate embedding for a single text
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = getApiKey();
  const model = config?.model || DEFAULT_MODEL;

  // Check cache
  const cacheKey = getCacheKey(text, model);
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      dimensions: config?.dimensions || DEFAULT_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { prompt_tokens: number; total_tokens: number };
  };

  const embedding = data.data[0].embedding;

  // Cache the result
  embeddingCache.set(cacheKey, embedding);

  return embedding;
}

/**
 * Generate embeddings for multiple texts in batches
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = getApiKey();
  const model = config?.model || DEFAULT_MODEL;
  const batchSize = config?.batchSize || DEFAULT_BATCH_SIZE;

  const results: number[][] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // Check cache first
  for (let i = 0; i < texts.length; i++) {
    const cacheKey = getCacheKey(texts[i], model);
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  // Process uncached texts in batches
  for (let i = 0; i < uncachedTexts.length; i += batchSize) {
    const batch = uncachedTexts.slice(i, i + batchSize);
    const batchIndices = uncachedIndices.slice(i, i + batchSize);

    const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: batch,
        dimensions: config?.dimensions || DEFAULT_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    // Map embeddings back to original indices
    for (const item of data.data) {
      const originalIndex = batchIndices[item.index];
      results[originalIndex] = item.embedding;

      // Cache the result
      const cacheKey = getCacheKey(texts[originalIndex], model);
      embeddingCache.set(cacheKey, item.embedding);
    }
  }

  return results;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find the most similar items from a list of embeddings
 */
export function findMostSimilar(
  queryEmbedding: number[],
  embeddings: Array<{ id: string; embedding: number[] }>,
  topK: number = 10
): Array<{ id: string; score: number }> {
  const scored = embeddings.map((item) => ({
    id: item.id,
    score: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

/**
 * Embed a knowledge chunk with its context
 */
export async function embedChunk(chunk: {
  content: string;
  title?: string;
  documentTitle?: string;
  services?: string[];
}): Promise<number[]> {
  // Build a rich text representation for embedding
  const parts: string[] = [];

  if (chunk.documentTitle) {
    parts.push(`Document: ${chunk.documentTitle}`);
  }

  if (chunk.title) {
    parts.push(`Section: ${chunk.title}`);
  }

  if (chunk.services && chunk.services.length > 0) {
    parts.push(`Services: ${chunk.services.join(', ')}`);
  }

  parts.push(chunk.content);

  const text = parts.join('\n\n');

  return embedText(text);
}

/**
 * Clear the embedding cache
 */
export function clearCache(): void {
  embeddingCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; memoryBytes: number } {
  let memoryBytes = 0;

  for (const embedding of embeddingCache.values()) {
    memoryBytes += embedding.length * 8; // 8 bytes per float64
  }

  return {
    size: embeddingCache.size,
    memoryBytes,
  };
}

/**
 * Estimate embedding cost for a set of texts
 */
export function estimateCost(texts: string[]): {
  totalTokens: number;
  estimatedCost: number;
} {
  // Rough estimate: 1 token per 4 characters
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  const totalTokens = Math.ceil(totalChars / 4);

  // text-embedding-3-small: $0.00002 per 1K tokens
  const estimatedCost = (totalTokens / 1000) * 0.00002;

  return { totalTokens, estimatedCost };
}
