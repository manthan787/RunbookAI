/**
 * Approval Flow
 *
 * Handles user confirmation for state-changing operations (mutations).
 * Provides CLI prompts for approval and maintains an audit trail.
 */

import { createInterface } from 'readline';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface MutationRequest {
  id: string;
  operation: string;
  resource: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: Record<string, unknown>;
  rollbackCommand?: string;
  estimatedImpact?: string;
}

export interface ApprovalResult {
  approved: boolean;
  approvedAt?: Date;
  approvedBy?: string;
  reason?: string;
}

export interface ApprovalAuditEntry {
  timestamp: string;
  mutationId: string;
  operation: string;
  resource: string;
  riskLevel: RiskLevel;
  approved: boolean;
  reason?: string;
}

/**
 * Risk level descriptions for user display
 */
export const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  low: 'Low risk - easily reversible, minimal impact',
  medium: 'Medium risk - may affect service briefly',
  high: 'High risk - may cause service disruption',
  critical: 'Critical risk - may cause significant downtime or data loss',
};

/**
 * Risk level colors for CLI display
 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  low: '\x1b[32m',      // green
  medium: '\x1b[33m',   // yellow
  high: '\x1b[91m',     // light red
  critical: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

/**
 * Classify risk level based on operation type
 */
export function classifyRisk(operation: string, resource: string): RiskLevel {
  const op = operation.toLowerCase();
  const res = resource.toLowerCase();

  // Critical operations
  if (op.includes('delete') || op.includes('terminate') || op.includes('destroy')) {
    return 'critical';
  }
  if (op.includes('truncate') || op.includes('drop')) {
    return 'critical';
  }
  if (res.includes('production') || res.includes('prod')) {
    if (op.includes('update') || op.includes('modify')) {
      return 'high';
    }
  }

  // High risk operations
  if (op.includes('restart') || op.includes('reboot') || op.includes('stop')) {
    return 'high';
  }
  if (op.includes('scale') && res.includes('down')) {
    return 'high';
  }
  if (op.includes('deploy') || op.includes('update-service')) {
    return 'high';
  }

  // Medium risk operations
  if (op.includes('update') || op.includes('modify') || op.includes('change')) {
    return 'medium';
  }
  if (op.includes('scale')) {
    return 'medium';
  }

  // Default to low
  return 'low';
}

/**
 * Format mutation request for display
 */
export function formatMutationRequest(request: MutationRequest): string {
  const riskColor = RISK_COLORS[request.riskLevel];
  const lines = [
    '',
    `${BOLD}═══════════════════════════════════════════════════════════════${RESET}`,
    `${BOLD}  MUTATION APPROVAL REQUIRED${RESET}`,
    `${BOLD}═══════════════════════════════════════════════════════════════${RESET}`,
    '',
    `  ${BOLD}Operation:${RESET}    ${request.operation}`,
    `  ${BOLD}Resource:${RESET}     ${request.resource}`,
    `  ${BOLD}Risk Level:${RESET}   ${riskColor}${request.riskLevel.toUpperCase()}${RESET}`,
    `                ${RISK_DESCRIPTIONS[request.riskLevel]}`,
    '',
    `  ${BOLD}Description:${RESET}`,
    `    ${request.description}`,
    '',
  ];

  if (request.estimatedImpact) {
    lines.push(`  ${BOLD}Estimated Impact:${RESET}`);
    lines.push(`    ${request.estimatedImpact}`);
    lines.push('');
  }

  if (Object.keys(request.parameters).length > 0) {
    lines.push(`  ${BOLD}Parameters:${RESET}`);
    for (const [key, value] of Object.entries(request.parameters)) {
      lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
    lines.push('');
  }

  if (request.rollbackCommand) {
    lines.push(`  ${BOLD}Rollback Command:${RESET}`);
    lines.push(`    ${request.rollbackCommand}`);
    lines.push('');
  }

  lines.push(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Request approval via CLI prompt
 */
export async function requestApproval(request: MutationRequest): Promise<ApprovalResult> {
  // Display the request
  console.log(formatMutationRequest(request));

  // For critical operations, require typing 'yes' explicitly
  const promptMessage = request.riskLevel === 'critical'
    ? `Type 'yes' to approve, or 'no' to reject: `
    : `Approve this operation? (y/n): `;

  const response = await prompt(promptMessage);
  const normalizedResponse = response.toLowerCase().trim();

  let approved = false;
  if (request.riskLevel === 'critical') {
    approved = normalizedResponse === 'yes';
  } else {
    approved = normalizedResponse === 'y' || normalizedResponse === 'yes';
  }

  // Log to audit trail
  await logApproval(request, approved);

  return {
    approved,
    approvedAt: approved ? new Date() : undefined,
    approvedBy: process.env.USER || 'unknown',
    reason: approved ? undefined : 'User rejected',
  };
}

/**
 * Simple CLI prompt
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Log approval to audit file
 */
async function logApproval(request: MutationRequest, approved: boolean): Promise<void> {
  const auditDir = join(process.cwd(), '.runbook', 'audit');
  const auditFile = join(auditDir, 'approvals.jsonl');

  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true });
  }

  const entry: ApprovalAuditEntry = {
    timestamp: new Date().toISOString(),
    mutationId: request.id,
    operation: request.operation,
    resource: request.resource,
    riskLevel: request.riskLevel,
    approved,
  };

  appendFileSync(auditFile, JSON.stringify(entry) + '\n');
}

/**
 * Check if auto-approval is allowed for an operation
 */
export function canAutoApprove(riskLevel: RiskLevel, config?: { autoApprove?: RiskLevel[] }): boolean {
  const autoApproveLevels = config?.autoApprove || [];
  return autoApproveLevels.includes(riskLevel);
}

/**
 * Mutation cooldown tracker
 */
const recentMutations: Map<string, Date> = new Map();

/**
 * Check if enough time has passed since the last critical mutation
 */
export function checkCooldown(
  operation: string,
  cooldownMs: number = 60000
): { allowed: boolean; remainingMs: number } {
  const lastMutation = recentMutations.get('critical');

  if (!lastMutation) {
    return { allowed: true, remainingMs: 0 };
  }

  const elapsed = Date.now() - lastMutation.getTime();
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMs: 0 };
  }

  return { allowed: false, remainingMs: cooldownMs - elapsed };
}

/**
 * Record a critical mutation for cooldown tracking
 */
export function recordCriticalMutation(): void {
  recentMutations.set('critical', new Date());
}

/**
 * Generate a unique mutation ID
 */
export function generateMutationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `mut_${timestamp}_${random}`;
}
