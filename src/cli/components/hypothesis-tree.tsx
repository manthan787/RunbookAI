/**
 * Hypothesis Tree Component
 *
 * Renders a tree visualization of investigation hypotheses with status icons.
 * Shows the branching investigation path with confirmed, pruned, and pending hypotheses.
 */

import React from 'react';
import { Text, Box } from 'ink';
import type { Hypothesis, EvidenceStrength } from '../../agent/types';
import type { TreeNode } from '../../agent/hypothesis';
import { ConfidenceMini } from './confidence-bar';

// Re-export TreeNode for convenience
export type { TreeNode };

export interface HypothesisTreeProps {
  /** List of root hypotheses to render */
  hypotheses: Hypothesis[];
  /** Whether to show pruned hypotheses */
  showPruned?: boolean;
  /** Whether to show detailed reasoning */
  showReasoning?: boolean;
  /** Maximum depth to render */
  maxDepth?: number;
  /** Compact mode (single line per hypothesis) */
  compact?: boolean;
}

/**
 * Status icons for hypothesis states
 */
const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  confirmed: { icon: '\u2713', color: 'green' }, // ✓
  pruned: { icon: '\u2717', color: 'red' }, // ✗
  active_strong: { icon: '\u25C9', color: 'blue' }, // ◉
  active_weak: { icon: '\u25CB', color: 'yellow' }, // ○
  active_pending: { icon: '\u25CB', color: 'gray' }, // ○
};

/**
 * Get the appropriate icon for a hypothesis
 */
function getStatusIcon(
  status: string,
  evidenceStrength: EvidenceStrength
): { icon: string; color: string } {
  if (status === 'confirmed') {
    return STATUS_ICONS.confirmed;
  }
  if (status === 'pruned') {
    return STATUS_ICONS.pruned;
  }
  // Active hypothesis
  if (evidenceStrength === 'strong') {
    return STATUS_ICONS.active_strong;
  }
  if (evidenceStrength === 'weak') {
    return STATUS_ICONS.active_weak;
  }
  return STATUS_ICONS.active_pending;
}

/**
 * Tree connector characters
 */
const TREE_CHARS = {
  vertical: '\u2502', // │
  branch: '\u251C', // ├
  lastBranch: '\u2514', // └
  horizontal: '\u2500', // ─
  space: ' ',
};

/**
 * Main hypothesis tree component
 */
export function HypothesisTree({
  hypotheses,
  showPruned = false,
  showReasoning = false,
  maxDepth = 10,
  compact = false,
}: HypothesisTreeProps): React.ReactElement {
  if (hypotheses.length === 0) {
    return (
      <Box>
        <Text color="gray">No hypotheses formed yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Investigation Hypotheses
        </Text>
      </Box>
      <Box flexDirection="column">
        {hypotheses.map((hypothesis, index) => (
          <HypothesisNode
            key={hypothesis.id}
            hypothesis={hypothesis}
            isLast={index === hypotheses.length - 1}
            prefix=""
            showPruned={showPruned}
            showReasoning={showReasoning}
            maxDepth={maxDepth}
            currentDepth={0}
            compact={compact}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Legend: {STATUS_ICONS.confirmed.icon} confirmed {STATUS_ICONS.pruned.icon} pruned{' '}
          {STATUS_ICONS.active_strong.icon} investigating {STATUS_ICONS.active_pending.icon} pending
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Single hypothesis node with children
 */
function HypothesisNode({
  hypothesis,
  isLast,
  prefix,
  showPruned,
  showReasoning,
  maxDepth,
  currentDepth,
  compact,
}: {
  hypothesis: Hypothesis;
  isLast: boolean;
  prefix: string;
  showPruned: boolean;
  showReasoning: boolean;
  maxDepth: number;
  currentDepth: number;
  compact: boolean;
}): React.ReactElement | null {
  // Skip pruned hypotheses if not showing them
  if (!showPruned && hypothesis.status === 'pruned') {
    return null;
  }

  // Skip if beyond max depth
  if (currentDepth > maxDepth) {
    return null;
  }

  const { icon, color } = getStatusIcon(hypothesis.status, hypothesis.evidenceStrength);
  const connector = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;
  const childPrefix = prefix + (isLast ? '   ' : `${TREE_CHARS.vertical}  `);

  // Filter children based on showPruned
  const visibleChildren = showPruned
    ? hypothesis.children
    : hypothesis.children.filter((c) => c.status !== 'pruned');

  // Calculate confidence percentage (mock for display - would come from engine)
  const confidencePercent =
    hypothesis.status === 'confirmed'
      ? 85
      : hypothesis.evidenceStrength === 'strong'
        ? 70
        : hypothesis.evidenceStrength === 'weak'
          ? 40
          : undefined;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">
          {prefix}
          {connector}
          {TREE_CHARS.horizontal}{' '}
        </Text>
        <Text color={color}>{icon}</Text>
        <Text> {hypothesis.statement}</Text>
        {confidencePercent !== undefined && (
          <Text>
            {' '}
            <ConfidenceMini value={confidencePercent} />
          </Text>
        )}
      </Box>

      {!compact && showReasoning && hypothesis.reasoning && (
        <Box>
          <Text color="gray">{childPrefix}</Text>
          <Text color="gray" italic>
            {hypothesis.reasoning}
          </Text>
        </Box>
      )}

      {visibleChildren.map((child, index) => (
        <HypothesisNode
          key={child.id}
          hypothesis={child}
          isLast={index === visibleChildren.length - 1}
          prefix={childPrefix}
          showPruned={showPruned}
          showReasoning={showReasoning}
          maxDepth={maxDepth}
          currentDepth={currentDepth + 1}
          compact={compact}
        />
      ))}
    </Box>
  );
}

/**
 * Compact single-line hypothesis view
 */
export function HypothesisCompact({ hypothesis }: { hypothesis: Hypothesis }): React.ReactElement {
  const { icon, color } = getStatusIcon(hypothesis.status, hypothesis.evidenceStrength);

  return (
    <Box>
      <Text color={color}>{icon}</Text>
      <Text> {hypothesis.statement}</Text>
      {hypothesis.evidenceStrength !== 'pending' && (
        <Text color="gray"> [{hypothesis.evidenceStrength}]</Text>
      )}
    </Box>
  );
}

/**
 * Summary view showing only confirmed and key hypotheses
 */
export function HypothesisSummary({
  hypotheses,
}: {
  hypotheses: Hypothesis[];
}): React.ReactElement {
  // Find confirmed hypothesis
  const confirmed = findConfirmed(hypotheses);

  // Count statistics
  const stats = countHypotheses(hypotheses);

  return (
    <Box flexDirection="column">
      {confirmed ? (
        <Box>
          <Text color="green" bold>
            {STATUS_ICONS.confirmed.icon} Root Cause:
          </Text>
          <Text> {confirmed.statement}</Text>
        </Box>
      ) : (
        <Box>
          <Text color="yellow">Investigation in progress...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">
          Hypotheses: {stats.total} total, {stats.confirmed} confirmed, {stats.pruned} pruned,{' '}
          {stats.active} active
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Find confirmed hypothesis in tree
 */
function findConfirmed(hypotheses: Hypothesis[]): Hypothesis | null {
  for (const h of hypotheses) {
    if (h.status === 'confirmed') {
      return h;
    }
    const inChildren = findConfirmed(h.children);
    if (inChildren) {
      return inChildren;
    }
  }
  return null;
}

/**
 * Count hypotheses by status
 */
function countHypotheses(hypotheses: Hypothesis[]): {
  total: number;
  confirmed: number;
  pruned: number;
  active: number;
} {
  let total = 0;
  let confirmed = 0;
  let pruned = 0;
  let active = 0;

  const count = (list: Hypothesis[]) => {
    for (const h of list) {
      total++;
      if (h.status === 'confirmed') confirmed++;
      else if (h.status === 'pruned') pruned++;
      else active++;
      count(h.children);
    }
  };

  count(hypotheses);
  return { total, confirmed, pruned, active };
}

/**
 * Convert HypothesisEngine tree to TreeNode format for external use
 */
export function hypothesisToTreeNode(hypothesis: Hypothesis): TreeNode {
  return {
    id: hypothesis.id,
    statement: hypothesis.statement,
    status: hypothesis.status,
    evidenceStrength: hypothesis.evidenceStrength,
    reasoning: hypothesis.reasoning,
    depth: hypothesis.depth,
    children: hypothesis.children.map(hypothesisToTreeNode),
  };
}
