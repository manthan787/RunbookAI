/**
 * Investigation Checkpoint System
 *
 * Provides checkpoint/resume capabilities for investigations,
 * allowing users to save and restore investigation state.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { InvestigationPhase } from '../agent/state-machine';
import type { InvestigationHypothesis } from '../agent/state-machine';

/**
 * Unique checkpoint identifier (12 hex characters)
 */
export type CheckpointId = string;

/**
 * Investigation checkpoint metadata
 */
export interface CheckpointMetadata {
  id: CheckpointId;
  investigationId: string;
  sessionId?: string;
  createdAt: string;
  phase: InvestigationPhase;
  query: string;
  confidence: number;
  promptCount: number;
  toolCallCount: number;
  summary?: string;
}

/**
 * Full investigation checkpoint with state
 */
export interface InvestigationCheckpoint extends CheckpointMetadata {
  /** Hypothesis snapshots */
  hypotheses: HypothesisSnapshot[];
  /** Services discovered during investigation */
  servicesDiscovered: string[];
  /** Symptoms identified */
  symptomsIdentified: string[];
  /** Tool result IDs (for archived results) */
  toolResultIds: string[];
  /** Evidence gathered */
  evidence: EvidenceRecord[];
  /** Remediation steps if in remediate phase */
  remediationSteps?: RemediationStepSnapshot[];
  /** Root cause if concluded */
  rootCause?: string;
  /** Affected services */
  affectedServices?: string[];
}

/**
 * Snapshot of a hypothesis at checkpoint time
 */
export interface HypothesisSnapshot {
  id: string;
  statement: string;
  category: string;
  status: 'pending' | 'investigating' | 'confirmed' | 'pruned';
  confidence: number;
  reasoning?: string;
  parentId?: string;
}

/**
 * Record of evidence gathered
 */
export interface EvidenceRecord {
  id: string;
  hypothesisId: string;
  type: 'supporting' | 'refuting' | 'inconclusive';
  source: string;
  summary: string;
  timestamp: string;
}

/**
 * Snapshot of a remediation step
 */
export interface RemediationStepSnapshot {
  id: string;
  action: string;
  description: string;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'skipped';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Checkpoint list entry (lightweight)
 */
export interface CheckpointListEntry {
  id: CheckpointId;
  investigationId: string;
  createdAt: string;
  phase: InvestigationPhase;
  query: string;
  confidence: number;
  hypothesisCount: number;
}

/**
 * Generate a unique checkpoint ID (12 hex characters)
 */
export function generateCheckpointId(): CheckpointId {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Checkpoint storage configuration
 */
export interface CheckpointStoreConfig {
  baseDir: string;
  maxCheckpointsPerInvestigation: number;
}

const DEFAULT_CONFIG: CheckpointStoreConfig = {
  baseDir: '.runbook',
  maxCheckpointsPerInvestigation: 50,
};

/**
 * Checkpoint storage class
 */
export class CheckpointStore {
  private config: CheckpointStoreConfig;

  constructor(config: Partial<CheckpointStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the checkpoints directory for an investigation
   */
  private getCheckpointsDir(investigationId: string): string {
    return join(this.config.baseDir, 'checkpoints', investigationId);
  }

  /**
   * Get the path for a checkpoint file
   */
  private getCheckpointPath(investigationId: string, checkpointId: CheckpointId): string {
    return join(this.getCheckpointsDir(investigationId), `${checkpointId}.json`);
  }

  /**
   * Get the path for the latest checkpoint symlink
   */
  private getLatestPath(investigationId: string): string {
    return join(this.getCheckpointsDir(investigationId), 'latest.json');
  }

  /**
   * Save a checkpoint
   */
  async save(checkpoint: InvestigationCheckpoint): Promise<CheckpointId> {
    const checkpointsDir = this.getCheckpointsDir(checkpoint.investigationId);
    await mkdir(checkpointsDir, { recursive: true });

    const checkpointPath = this.getCheckpointPath(checkpoint.investigationId, checkpoint.id);
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

    // Update latest pointer
    const latestPath = this.getLatestPath(checkpoint.investigationId);
    await writeFile(latestPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

    // Prune old checkpoints if needed
    await this.pruneOldCheckpoints(checkpoint.investigationId);

    return checkpoint.id;
  }

  /**
   * Load a checkpoint by ID
   */
  async load(
    investigationId: string,
    checkpointId: CheckpointId
  ): Promise<InvestigationCheckpoint | null> {
    const checkpointPath = this.getCheckpointPath(investigationId, checkpointId);
    if (!existsSync(checkpointPath)) {
      return null;
    }

    try {
      const content = await readFile(checkpointPath, 'utf-8');
      return JSON.parse(content) as InvestigationCheckpoint;
    } catch {
      return null;
    }
  }

  /**
   * Load the latest checkpoint for an investigation
   */
  async loadLatest(investigationId: string): Promise<InvestigationCheckpoint | null> {
    const latestPath = this.getLatestPath(investigationId);
    if (!existsSync(latestPath)) {
      return null;
    }

    try {
      const content = await readFile(latestPath, 'utf-8');
      return JSON.parse(content) as InvestigationCheckpoint;
    } catch {
      return null;
    }
  }

  /**
   * List checkpoints for an investigation
   */
  async list(investigationId: string): Promise<CheckpointListEntry[]> {
    const checkpointsDir = this.getCheckpointsDir(investigationId);
    if (!existsSync(checkpointsDir)) {
      return [];
    }

    const entries: CheckpointListEntry[] = [];
    const files = await readdir(checkpointsDir);

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'latest.json') {
        continue;
      }

      try {
        const content = await readFile(join(checkpointsDir, file), 'utf-8');
        const checkpoint = JSON.parse(content) as InvestigationCheckpoint;
        entries.push({
          id: checkpoint.id,
          investigationId: checkpoint.investigationId,
          createdAt: checkpoint.createdAt,
          phase: checkpoint.phase,
          query: checkpoint.query,
          confidence: checkpoint.confidence,
          hypothesisCount: checkpoint.hypotheses.length,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by creation time (newest first)
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return entries;
  }

  /**
   * List all investigations with checkpoints
   */
  async listInvestigations(): Promise<
    Array<{
      investigationId: string;
      checkpointCount: number;
      latestCheckpoint?: CheckpointListEntry;
    }>
  > {
    const checkpointsBaseDir = join(this.config.baseDir, 'checkpoints');
    if (!existsSync(checkpointsBaseDir)) {
      return [];
    }

    const investigations: Array<{
      investigationId: string;
      checkpointCount: number;
      latestCheckpoint?: CheckpointListEntry;
    }> = [];

    const dirs = await readdir(checkpointsBaseDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) {
        continue;
      }

      const checkpoints = await this.list(dir.name);
      investigations.push({
        investigationId: dir.name,
        checkpointCount: checkpoints.length,
        latestCheckpoint: checkpoints[0],
      });
    }

    // Sort by latest checkpoint time
    investigations.sort((a, b) => {
      const aTime = a.latestCheckpoint ? new Date(a.latestCheckpoint.createdAt).getTime() : 0;
      const bTime = b.latestCheckpoint ? new Date(b.latestCheckpoint.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return investigations;
  }

  /**
   * Delete a checkpoint
   */
  async delete(investigationId: string, checkpointId: CheckpointId): Promise<boolean> {
    const checkpointPath = this.getCheckpointPath(investigationId, checkpointId);
    if (!existsSync(checkpointPath)) {
      return false;
    }

    await unlink(checkpointPath);
    return true;
  }

  /**
   * Delete all checkpoints for an investigation
   */
  async deleteAll(investigationId: string): Promise<number> {
    const checkpointsDir = this.getCheckpointsDir(investigationId);
    if (!existsSync(checkpointsDir)) {
      return 0;
    }

    const files = await readdir(checkpointsDir);
    let deleted = 0;

    for (const file of files) {
      try {
        await unlink(join(checkpointsDir, file));
        deleted++;
      } catch {
        // Ignore errors
      }
    }

    return deleted;
  }

  /**
   * Prune old checkpoints to stay under the limit
   */
  private async pruneOldCheckpoints(investigationId: string): Promise<number> {
    const checkpoints = await this.list(investigationId);
    const excess = checkpoints.length - this.config.maxCheckpointsPerInvestigation;

    if (excess <= 0) {
      return 0;
    }

    // Delete oldest checkpoints
    const toDelete = checkpoints.slice(-excess);
    let deleted = 0;

    for (const checkpoint of toDelete) {
      const success = await this.delete(investigationId, checkpoint.id);
      if (success) {
        deleted++;
      }
    }

    return deleted;
  }
}

/**
 * Create a checkpoint from investigation state
 */
export function createCheckpoint(
  investigationId: string,
  state: {
    query: string;
    phase: InvestigationPhase;
    hypotheses: InvestigationHypothesis[];
    confidence?: number;
    toolCallCount?: number;
    servicesDiscovered?: string[];
    symptomsIdentified?: string[];
    rootCause?: string;
    affectedServices?: string[];
  },
  sessionId?: string
): InvestigationCheckpoint {
  const id = generateCheckpointId();

  // Convert hypotheses to snapshots
  const hypotheses: HypothesisSnapshot[] = state.hypotheses.map((h) => ({
    id: h.id,
    statement: h.statement,
    category: h.category,
    status: h.status,
    confidence: h.confidence,
    reasoning: h.reasoning,
    parentId: h.parentId,
  }));

  return {
    id,
    investigationId,
    sessionId,
    createdAt: new Date().toISOString(),
    phase: state.phase,
    query: state.query,
    confidence: state.confidence || 0,
    promptCount: 0,
    toolCallCount: state.toolCallCount || 0,
    hypotheses,
    servicesDiscovered: state.servicesDiscovered || [],
    symptomsIdentified: state.symptomsIdentified || [],
    toolResultIds: [],
    evidence: [],
    rootCause: state.rootCause,
    affectedServices: state.affectedServices,
  };
}

/**
 * Create a checkpoint store instance
 */
export function createCheckpointStore(config?: Partial<CheckpointStoreConfig>): CheckpointStore {
  return new CheckpointStore(config);
}

/**
 * Format checkpoint for display
 */
export function formatCheckpoint(checkpoint: InvestigationCheckpoint): string {
  const lines: string[] = [
    `# Checkpoint: ${checkpoint.id}`,
    '',
    `**Investigation:** ${checkpoint.investigationId}`,
    `**Created:** ${checkpoint.createdAt}`,
    `**Phase:** ${checkpoint.phase}`,
    `**Confidence:** ${checkpoint.confidence}%`,
    '',
    `## Query`,
    checkpoint.query,
    '',
    `## Hypotheses (${checkpoint.hypotheses.length})`,
  ];

  for (const h of checkpoint.hypotheses) {
    const statusIcon =
      h.status === 'confirmed'
        ? '✓'
        : h.status === 'pruned'
          ? '✗'
          : h.status === 'investigating'
            ? '→'
            : '○';
    lines.push(`- ${statusIcon} [${h.status}] ${h.statement} (${h.confidence}%)`);
    if (h.reasoning) {
      lines.push(`  Reasoning: ${h.reasoning}`);
    }
  }

  if (checkpoint.servicesDiscovered.length > 0) {
    lines.push('');
    lines.push(`## Services Discovered`);
    lines.push(checkpoint.servicesDiscovered.join(', '));
  }

  if (checkpoint.rootCause) {
    lines.push('');
    lines.push(`## Root Cause`);
    lines.push(checkpoint.rootCause);
  }

  return lines.join('\n');
}

/**
 * Format checkpoint list for display
 */
export function formatCheckpointList(checkpoints: CheckpointListEntry[]): string {
  if (checkpoints.length === 0) {
    return 'No checkpoints found.';
  }

  const lines: string[] = [
    '| ID | Phase | Confidence | Hypotheses | Created |',
    '|-----|-------|------------|------------|---------|',
  ];

  for (const cp of checkpoints) {
    const date = new Date(cp.createdAt).toLocaleString();
    lines.push(
      `| ${cp.id.slice(0, 8)}... | ${cp.phase} | ${cp.confidence}% | ${cp.hypothesisCount} | ${date} |`
    );
  }

  return lines.join('\n');
}
