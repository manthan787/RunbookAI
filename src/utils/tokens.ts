/**
 * Token estimation utilities
 *
 * Provides rough token counts for context management.
 * Uses a simple heuristic rather than exact tokenization for speed.
 */

/**
 * Estimate token count for a string
 *
 * Uses the rough heuristic of ~4 characters per token for English text.
 * This is a conservative estimate that works well for most content.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Average ~4 characters per token for English
  // JSON and code tend to be slightly higher, so we use 3.5
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate tokens for an object (serialized to JSON)
 */
export function estimateObjectTokens(obj: unknown): number {
  try {
    const json = JSON.stringify(obj);
    return estimateTokens(json);
  } catch {
    return 0;
  }
}

/**
 * Check if content exceeds token limit
 */
export function exceedsTokenLimit(text: string, limit: number): boolean {
  return estimateTokens(text) > limit;
}

/**
 * Truncate text to fit within token limit
 *
 * Truncates at word boundaries and adds ellipsis.
 */
export function truncateToTokenLimit(text: string, limit: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= limit) {
    return text;
  }

  // Estimate character limit
  const charLimit = Math.floor(limit * 3.5) - 10; // Leave room for ellipsis

  // Find last word boundary before limit
  const truncated = text.slice(0, charLimit);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > charLimit * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Format token count for display
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return count.toString();
  }
  return `${(count / 1000).toFixed(1)}k`;
}
