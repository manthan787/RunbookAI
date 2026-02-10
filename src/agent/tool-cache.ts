/**
 * Tool Result Cache
 *
 * LRU cache for tool execution results to avoid redundant API calls
 * during investigations. Supports per-tool TTLs and non-cacheable tools.
 */

export interface CacheConfig {
  /** Whether caching is enabled */
  enabled: boolean;
  /** Maximum number of entries in the cache */
  maxSize: number;
  /** Default TTL in milliseconds */
  defaultTTLMs: number;
  /** Per-tool TTL overrides */
  toolTTLs: Record<string, number>;
}

export interface CacheEntry {
  result: unknown;
  timestamp: number;
  ttlMs: number;
  toolName: string;
  argsHash: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  maxSize: 100,
  defaultTTLMs: 300000, // 5 minutes
  toolTTLs: {
    aws_query: 60000, // 1 min - infra changes frequently
    search_knowledge: 300000, // 5 min - knowledge is stable
    cloudwatch_logs: 60000, // 1 min - logs change
    kubernetes_query: 30000, // 30 sec - pods change quickly
    pagerduty_get_incident: 60000, // 1 min
    datadog_query: 60000, // 1 min
  },
};

/**
 * Create a stable hash from tool arguments for cache key generation
 */
function hashArgs(args: Record<string, unknown>): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize).sort();
    }
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        normalized[key] = normalize(obj[key]);
      }
      return normalized;
    }
    return input;
  };

  return JSON.stringify(normalize(args));
}

/**
 * LRU Cache for tool execution results
 */
export class LRUToolCache {
  private cache: Map<string, CacheEntry>;
  private config: CacheConfig;
  private stats: { hits: number; misses: number; evictions: number };

  /** Tools that should never be cached (side effects or real-time data) */
  private readonly nonCacheableTools = new Set([
    'skill', // Skills may have side effects
    'aws_cli', // Direct CLI commands may mutate state
    'execute_remediation', // Remediation actions
    'approve_remediation', // Approval actions
    'kubectl_exec', // Container execution
    'run_command', // Arbitrary commands
  ]);

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Generate a cache key from tool name and arguments
   */
  private getCacheKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${hashArgs(args)}`;
  }

  /**
   * Check if a tool result is cached and still valid
   */
  get(toolName: string, args: Record<string, unknown>): unknown | null {
    if (!this.config.enabled) {
      return null;
    }

    if (this.nonCacheableTools.has(toolName)) {
      return null;
    }

    const key = this.getCacheKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry has expired
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.result;
  }

  /**
   * Store a tool result in the cache
   */
  set(toolName: string, args: Record<string, unknown>, result: unknown): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.nonCacheableTools.has(toolName)) {
      return;
    }

    // Don't cache errors or null results
    if (result === null || result === undefined) {
      return;
    }
    if (typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
      return;
    }

    const key = this.getCacheKey(toolName, args);
    const ttlMs = this.config.toolTTLs[toolName] ?? this.config.defaultTTLMs;

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    const entry: CacheEntry = {
      result,
      timestamp: Date.now(),
      ttlMs,
      toolName,
      argsHash: hashArgs(args),
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if a result would come from cache (without counting stats)
   */
  has(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.config.enabled || this.nonCacheableTools.has(toolName)) {
      return false;
    }

    const key = this.getCacheKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    const age = Date.now() - entry.timestamp;
    return age <= entry.ttlMs;
  }

  /**
   * Invalidate cache entries
   * @param toolName Optional - if provided, only invalidate entries for this tool
   */
  invalidate(toolName?: string): void {
    if (toolName) {
      for (const [key, entry] of this.cache) {
        if (entry.toolName === toolName) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Invalidate entries matching a pattern in args
   */
  invalidateByPattern(pattern: Record<string, unknown>): void {
    const patternStr = JSON.stringify(pattern);
    for (const [key, entry] of this.cache) {
      if (entry.argsHash.includes(patternStr)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      size: this.cache.size,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Check if a tool is cacheable
   */
  isCacheable(toolName: string): boolean {
    return !this.nonCacheableTools.has(toolName);
  }

  /**
   * Add a tool to the non-cacheable list
   */
  addNonCacheable(toolName: string): void {
    this.nonCacheableTools.add(toolName);
  }

  /**
   * Get the TTL for a specific tool
   */
  getTTL(toolName: string): number {
    return this.config.toolTTLs[toolName] ?? this.config.defaultTTLMs;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    if (!this.config.enabled) {
      this.cache.clear();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }
}

/**
 * Create a tool cache instance with default or custom configuration
 */
export function createToolCache(config?: Partial<CacheConfig>): LRUToolCache {
  return new LRUToolCache(config);
}
