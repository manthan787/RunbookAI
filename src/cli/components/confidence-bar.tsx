/**
 * Confidence Bar Component
 *
 * Visual confidence bar for CLI output using Ink.
 * Shows a filled/empty bar with percentage and level label.
 */

import React from 'react';
import { Text, Box } from 'ink';
import {
  getConfidenceLevelFromValue,
  getConfidenceColor,
  type ConfidenceThresholds,
} from '../../agent/confidence';

export interface ConfidenceBarProps {
  /** Confidence value (0-100) */
  value: number;
  /** Width of the bar in characters */
  width?: number;
  /** Show "High/Medium/Low" label */
  showLabel?: boolean;
  /** Show percentage value */
  showPercentage?: boolean;
  /** Custom thresholds for level calculation */
  thresholds?: ConfidenceThresholds;
  /** Compact mode (bar only, no box) */
  compact?: boolean;
}

/**
 * Visual confidence bar component
 */
export function ConfidenceBar({
  value,
  width = 10,
  showLabel = true,
  showPercentage = true,
  thresholds,
  compact = false,
}: ConfidenceBarProps): React.ReactElement {
  // Clamp value between 0 and 100
  const clampedValue = Math.max(0, Math.min(100, value));
  const filled = Math.round((clampedValue / 100) * width);
  const empty = width - filled;

  const color = getConfidenceColor(clampedValue, thresholds);
  const level = getConfidenceLevelFromValue(clampedValue, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

  const barContent = (
    <>
      <Text color={color}>{'\u2588'.repeat(filled)}</Text>
      <Text color="gray">{'\u2591'.repeat(empty)}</Text>
      {showPercentage && <Text> {clampedValue}%</Text>}
      {showLabel && <Text color="gray"> ({levelLabel})</Text>}
    </>
  );

  if (compact) {
    return <Text>{barContent}</Text>;
  }

  return <Box>{barContent}</Box>;
}

/**
 * Inline confidence indicator (just the badge)
 */
export function ConfidenceBadge({
  value,
  thresholds,
}: {
  value: number;
  thresholds?: ConfidenceThresholds;
}): React.ReactElement {
  const clampedValue = Math.max(0, Math.min(100, value));
  const color = getConfidenceColor(clampedValue, thresholds);
  const level = getConfidenceLevelFromValue(clampedValue, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

  return (
    <Text color={color} bold>
      {levelLabel} ({clampedValue}%)
    </Text>
  );
}

/**
 * Confidence with description
 */
export function ConfidenceWithDescription({
  value,
  width = 10,
  thresholds,
}: {
  value: number;
  width?: number;
  thresholds?: ConfidenceThresholds;
}): React.ReactElement {
  const clampedValue = Math.max(0, Math.min(100, value));
  const filled = Math.round((clampedValue / 100) * width);
  const empty = width - filled;

  const color = getConfidenceColor(clampedValue, thresholds);
  const level = getConfidenceLevelFromValue(clampedValue, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

  const descriptions: Record<string, string> = {
    high: 'Strong evidence supports this conclusion',
    medium: 'Evidence supports with some uncertainty',
    low: 'Limited evidence, further investigation needed',
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{'\u2588'.repeat(filled)}</Text>
        <Text color="gray">{'\u2591'.repeat(empty)}</Text>
        <Text> {clampedValue}% </Text>
        <Text color={color} bold>
          ({levelLabel})
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          {descriptions[level]}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Mini confidence indicator (just colored percentage)
 */
export function ConfidenceMini({
  value,
  thresholds,
}: {
  value: number;
  thresholds?: ConfidenceThresholds;
}): React.ReactElement {
  const clampedValue = Math.max(0, Math.min(100, value));
  const color = getConfidenceColor(clampedValue, thresholds);

  return <Text color={color}>{clampedValue}%</Text>;
}
