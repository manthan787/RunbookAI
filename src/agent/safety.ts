/**
 * Safety layer for cloud operations
 *
 * Classifies operation risk, enforces approval flows,
 * and tracks mutation limits.
 */

export type OperationRisk = 'read' | 'low_risk' | 'high_risk' | 'critical';

export interface SafetyConfig {
  requireApproval: OperationRisk[];
  maxMutationsPerSession: number;
  cooldownBetweenCriticalMs: number;
}

export interface ApprovalRequest {
  id: string;
  operation: string;
  resource: string;
  risk: OperationRisk;
  description: string;
  command: string;
  rollbackCommand?: string;
  estimatedImpact?: string;
  createdAt: string;
}

export interface ApprovalResult {
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

/**
 * Risk classification for AWS operations
 */
export const AWS_RISK_CLASSIFICATION: Record<string, OperationRisk> = {
  // Read operations - always safe
  'ec2:DescribeInstances': 'read',
  'ec2:DescribeSecurityGroups': 'read',
  'ecs:DescribeServices': 'read',
  'ecs:DescribeTasks': 'read',
  'ecs:ListServices': 'read',
  'lambda:ListFunctions': 'read',
  'lambda:GetFunctionConfiguration': 'read',
  'rds:DescribeDBInstances': 'read',
  'rds:DescribeDBClusters': 'read',
  'elasticache:DescribeCacheClusters': 'read',
  'cloudwatch:GetMetricStatistics': 'read',
  'logs:FilterLogEvents': 'read',
  'iam:ListRoles': 'read',
  'iam:SimulatePrincipalPolicy': 'read',

  // Low risk mutations - reversible, limited blast radius
  'ecs:UpdateService': 'low_risk', // Rolling deploy
  'lambda:UpdateFunctionCode': 'low_risk',
  'lambda:UpdateFunctionConfiguration': 'low_risk',
  'elasticache:ModifyReplicationGroup': 'low_risk',
  'rds:ModifyDBInstance': 'low_risk', // Some changes need reboot

  // High risk - significant impact, may cause downtime
  'ec2:StopInstances': 'high_risk',
  'ec2:TerminateInstances': 'high_risk',
  'ecs:DeleteService': 'high_risk',
  'rds:StopDBInstance': 'high_risk',
  'rds:RebootDBInstance': 'high_risk',
  'elasticache:DeleteCacheCluster': 'high_risk',

  // Critical - potentially destructive, hard to reverse
  'rds:DeleteDBInstance': 'critical',
  'rds:DeleteDBCluster': 'critical',
  's3:DeleteBucket': 'critical',
  'iam:DeleteRole': 'critical',
  'iam:DeletePolicy': 'critical',
  'iam:UpdateAssumeRolePolicy': 'critical',
  'organizations:*': 'critical',
};

/**
 * Default safety configuration
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  requireApproval: ['low_risk', 'high_risk', 'critical'],
  maxMutationsPerSession: 10,
  cooldownBetweenCriticalMs: 60000, // 1 minute
};

export class SafetyManager {
  private mutationCount = 0;
  private lastCriticalTime: number | null = null;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  constructor(private readonly config: SafetyConfig = DEFAULT_SAFETY_CONFIG) {}

  /**
   * Classify the risk level of an operation
   */
  classifyRisk(operation: string): OperationRisk {
    // Check exact match
    if (operation in AWS_RISK_CLASSIFICATION) {
      return AWS_RISK_CLASSIFICATION[operation];
    }

    // Check prefix match (e.g., organizations:*)
    const service = operation.split(':')[0];
    const wildcardKey = `${service}:*`;
    if (wildcardKey in AWS_RISK_CLASSIFICATION) {
      return AWS_RISK_CLASSIFICATION[wildcardKey];
    }

    // Default: assume mutations are low_risk, reads are safe
    if (
      operation.toLowerCase().includes('describe') ||
      operation.toLowerCase().includes('list') ||
      operation.toLowerCase().includes('get')
    ) {
      return 'read';
    }

    return 'low_risk';
  }

  /**
   * Check if an operation requires approval
   */
  requiresApproval(operation: string): boolean {
    const risk = this.classifyRisk(operation);
    return this.config.requireApproval.includes(risk);
  }

  /**
   * Check if operation can proceed (respects limits and cooldowns)
   */
  canProceed(operation: string): { allowed: boolean; reason?: string } {
    const risk = this.classifyRisk(operation);

    // Read operations always allowed
    if (risk === 'read') {
      return { allowed: true };
    }

    // Check mutation limit
    if (this.mutationCount >= this.config.maxMutationsPerSession) {
      return {
        allowed: false,
        reason: `Session mutation limit reached (${this.config.maxMutationsPerSession}). Start a new session for additional changes.`,
      };
    }

    // Check critical cooldown
    if (risk === 'critical' && this.lastCriticalTime) {
      const elapsed = Date.now() - this.lastCriticalTime;
      if (elapsed < this.config.cooldownBetweenCriticalMs) {
        const remaining = Math.ceil((this.config.cooldownBetweenCriticalMs - elapsed) / 1000);
        return {
          allowed: false,
          reason: `Cooldown period for critical operations. Please wait ${remaining} seconds.`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Create an approval request
   */
  createApprovalRequest(
    operation: string,
    resource: string,
    description: string,
    command: string,
    rollbackCommand?: string,
    estimatedImpact?: string
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operation,
      resource,
      risk: this.classifyRisk(operation),
      description,
      command,
      rollbackCommand,
      estimatedImpact,
      createdAt: new Date().toISOString(),
    };

    this.pendingApprovals.set(request.id, request);
    return request;
  }

  /**
   * Record an approval decision
   */
  recordApproval(requestId: string, result: ApprovalResult): void {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    if (result.approved) {
      this.mutationCount++;

      if (request.risk === 'critical') {
        this.lastCriticalTime = Date.now();
      }
    }

    this.pendingApprovals.delete(requestId);
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Format approval request for display
   */
  formatApprovalRequest(request: ApprovalRequest): string {
    const riskEmoji =
      request.risk === 'critical'
        ? '🔴'
        : request.risk === 'high_risk'
          ? '🟠'
          : '🟡';

    let output = `
${riskEmoji} **Approval Required** (${request.risk.replace('_', ' ').toUpperCase()})

**Operation:** ${request.operation}
**Resource:** ${request.resource}

${request.description}

**Command:**
\`\`\`bash
${request.command}
\`\`\`
`;

    if (request.rollbackCommand) {
      output += `
**Rollback:**
\`\`\`bash
${request.rollbackCommand}
\`\`\`
`;
    }

    if (request.estimatedImpact) {
      output += `
**Estimated Impact:** ${request.estimatedImpact}
`;
    }

    return output;
  }

  /**
   * Get current session stats
   */
  getSessionStats(): { mutationCount: number; maxMutations: number; lastCriticalTime: number | null } {
    return {
      mutationCount: this.mutationCount,
      maxMutations: this.config.maxMutationsPerSession,
      lastCriticalTime: this.lastCriticalTime,
    };
  }

  /**
   * Reset session (for new investigation)
   */
  resetSession(): void {
    this.mutationCount = 0;
    this.lastCriticalTime = null;
    this.pendingApprovals.clear();
  }
}
