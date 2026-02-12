/**
 * Demo Data for runbook demo command
 *
 * Pre-scripted investigation flow that demonstrates RunbookAI's
 * hypothesis-driven investigation without requiring any API keys.
 */

export interface DemoStep {
  type: 'phase' | 'hypothesis' | 'evidence' | 'tool' | 'message' | 'root_cause' | 'remediation';
  delay: number; // ms to wait before showing
  data: Record<string, unknown>;
}

export const DEMO_INCIDENT = {
  id: 'DEMO-001',
  title: 'High latency on checkout-api',
  description:
    'Multiple alerts fired for checkout-api service. P99 latency increased from 200ms to 2.5s. Error rate spiked to 15%.',
  triggeredAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago
  service: 'checkout-api',
  severity: 'high',
};

export const DEMO_RUNBOOKS = [
  {
    title: 'Redis Connection Exhaustion',
    score: 0.92,
    snippet:
      'This runbook covers diagnosis and remediation when Redis connection pools are exhausted...',
  },
  {
    title: 'Database Connection Pool Issues',
    score: 0.78,
    snippet: 'Steps for diagnosing PostgreSQL connection pool exhaustion and slow queries...',
  },
  {
    title: 'Checkout API Troubleshooting',
    score: 0.71,
    snippet: 'General troubleshooting guide for the checkout-api service...',
  },
];

export const DEMO_INVESTIGATION_STEPS: DemoStep[] = [
  // Phase 1: Context Gathering
  {
    type: 'phase',
    delay: 500,
    data: { phase: 'context_gathering', message: 'Gathering incident context...' },
  },
  {
    type: 'tool',
    delay: 800,
    data: {
      name: 'get_incident_details',
      result: `Incident DEMO-001: High latency on checkout-api
Triggered: 15 minutes ago
Severity: High
Affected: checkout-api, cart-service (downstream)
Error rate: 15% (baseline: 0.1%)
P99 latency: 2,500ms (baseline: 200ms)`,
    },
  },
  {
    type: 'tool',
    delay: 600,
    data: {
      name: 'search_knowledge',
      result: `Found 3 relevant runbooks:
• Redis Connection Exhaustion (92% match)
• Database Connection Pool Issues (78% match)
• Checkout API Troubleshooting (71% match)`,
    },
  },
  {
    type: 'tool',
    delay: 500,
    data: {
      name: 'get_recent_deployments',
      result: `Recent deployments:
• checkout-api v2.4.1 → v2.4.2 (2 hours ago) - config change only
• No other deployments in last 24h`,
    },
  },

  // Phase 2: Hypothesis Formation
  {
    type: 'phase',
    delay: 700,
    data: { phase: 'hypothesis_formation', message: 'Forming hypotheses...' },
  },
  {
    type: 'hypothesis',
    delay: 400,
    data: {
      id: 'H1',
      description: 'Redis connection pool exhaustion due to traffic spike',
      confidence: 0.72,
      reasoning:
        'High match with Redis runbook, latency pattern consistent with connection queuing',
    },
  },
  {
    type: 'hypothesis',
    delay: 300,
    data: {
      id: 'H2',
      description: 'Database connection pool exhaustion',
      confidence: 0.54,
      reasoning: 'Secondary hypothesis - similar symptoms but less specific match',
    },
  },
  {
    type: 'hypothesis',
    delay: 300,
    data: {
      id: 'H3',
      description: 'Recent deployment introduced performance regression',
      confidence: 0.31,
      reasoning: 'Config-only change makes this less likely but worth checking',
    },
  },

  // Phase 3: Evidence Gathering for H1
  {
    type: 'phase',
    delay: 600,
    data: { phase: 'evidence_gathering', message: 'Testing H1: Redis connection exhaustion...' },
  },
  {
    type: 'tool',
    delay: 800,
    data: {
      name: 'cloudwatch_get_metrics',
      args: { metric: 'CurrConnections', namespace: 'AWS/ElastiCache' },
      result: `ElastiCache CurrConnections (prod-redis):
Current: 847 connections
Baseline: 250 connections
Max configured: 1000
Status: 340% ABOVE BASELINE ⚠️`,
    },
  },
  {
    type: 'evidence',
    delay: 400,
    data: {
      hypothesis: 'H1',
      strength: 'strong',
      finding: 'Redis connections at 847/1000 (340% above baseline)',
      impact: 'confidence +0.15',
    },
  },
  {
    type: 'tool',
    delay: 600,
    data: {
      name: 'cloudwatch_get_metrics',
      args: { metric: 'RequestCount', namespace: 'AWS/ApplicationELB' },
      result: `ALB Request Count (prod-alb):
Current rate: 12,500 req/min
Baseline: 3,200 req/min
Status: 290% ABOVE BASELINE ⚠️
Spike started: 18 minutes ago`,
    },
  },
  {
    type: 'evidence',
    delay: 400,
    data: {
      hypothesis: 'H1',
      strength: 'strong',
      finding: 'Traffic spike to 290% of baseline correlates with connection exhaustion',
      impact: 'confidence +0.12',
    },
  },

  // Branch deeper on H1
  {
    type: 'message',
    delay: 500,
    data: { text: 'Strong evidence for H1. Branching deeper...' },
  },
  {
    type: 'tool',
    delay: 700,
    data: {
      name: 'cloudwatch_logs_query',
      args: { logGroup: '/ecs/checkout-api', pattern: 'Redis connection' },
      result: `Log matches (last 15 min):
[ERROR] Redis connection timeout after 5000ms (x847)
[WARN] Connection pool exhausted, request queued (x1,203)
[ERROR] ECONNREFUSED to redis:6379 (x124)`,
    },
  },
  {
    type: 'evidence',
    delay: 400,
    data: {
      hypothesis: 'H1',
      strength: 'strong',
      finding: 'Application logs confirm Redis connection timeouts and pool exhaustion',
      impact: 'confidence +0.10',
    },
  },

  // Prune H3
  {
    type: 'phase',
    delay: 500,
    data: { phase: 'evidence_gathering', message: 'Quick check on H3: Deployment regression...' },
  },
  {
    type: 'tool',
    delay: 500,
    data: {
      name: 'get_deployment_diff',
      args: { service: 'checkout-api', version: 'v2.4.2' },
      result: `Deployment v2.4.2 changes:
- Updated LOG_LEVEL from INFO to DEBUG
- No code changes
- No dependency updates`,
    },
  },
  {
    type: 'evidence',
    delay: 300,
    data: {
      hypothesis: 'H3',
      strength: 'weak',
      finding: 'Config-only change, no performance-impacting modifications',
      impact: 'confidence -0.20, pruning hypothesis',
    },
  },

  // Root Cause Identification
  {
    type: 'phase',
    delay: 600,
    data: { phase: 'root_cause_identification', message: 'Identifying root cause...' },
  },
  {
    type: 'root_cause',
    delay: 800,
    data: {
      description: 'Redis connection pool exhaustion due to unexpected traffic spike',
      confidence: 0.94,
      evidence: [
        'Redis connections at 847/1000 (340% above baseline)',
        'Traffic spike to 12,500 req/min (290% above baseline)',
        'Application logs confirm connection timeouts and pool exhaustion',
        'Traffic spike started 18 minutes ago, correlates with incident trigger',
      ],
      affectedServices: ['checkout-api', 'cart-service'],
    },
  },

  // Remediation
  {
    type: 'phase',
    delay: 500,
    data: { phase: 'remediation', message: 'Generating remediation plan...' },
  },
  {
    type: 'remediation',
    delay: 600,
    data: {
      steps: [
        {
          priority: 1,
          action: 'Scale Redis cluster from 3 to 6 nodes',
          command:
            'aws elasticache modify-replication-group --replication-group-id prod-redis --node-group-count 6 --apply-immediately',
          requiresApproval: true,
          rollback:
            'aws elasticache modify-replication-group --replication-group-id prod-redis --node-group-count 3 --apply-immediately',
        },
        {
          priority: 2,
          action: 'Increase connection pool limit to 200 per service instance',
          command: 'kubectl set env deployment/checkout-api REDIS_POOL_SIZE=200 -n prod',
          requiresApproval: true,
          rollback: 'kubectl set env deployment/checkout-api REDIS_POOL_SIZE=100 -n prod',
        },
        {
          priority: 3,
          action: 'Enable connection queuing in application config',
          command: null,
          requiresApproval: false,
          note: 'Update application config and redeploy during next maintenance window',
        },
      ],
      estimatedRecovery: '5-10 minutes after scaling completes',
      preventionNotes: [
        'Set up CloudWatch alarm for CurrConnections > 80% of maxclients',
        'Implement auto-scaling for Redis based on connection count',
        'Review connection pool settings across all services',
      ],
    },
  },
];
