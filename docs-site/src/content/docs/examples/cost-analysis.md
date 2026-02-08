---
title: Cost Analysis
description: Example of analyzing infrastructure costs
---

This example demonstrates using Runbook to analyze and optimize cloud costs.

## Scenario

Monthly AWS bill increased 40%. Find the cause and recommend optimizations.

## Investigation

### Query Cost Data

```bash
runbook ask "Why did our AWS bill increase by 40% last month?"
```

### Analysis

```
→ Querying AWS Cost Explorer...
✓ aws_cli (cost-and-usage) (1.2s)

Cost Analysis: December 2023 vs November 2023
═════════════════════════════════════════════

Overview:
  November: $45,234
  December: $63,328
  Increase: $18,094 (+40%)

→ Breaking down by service...
✓ aws_cli (cost-by-service) (0.9s)

Cost by Service:
┌───────────────────────────────────────────────────────────┐
│ Service          November    December    Change           │
├───────────────────────────────────────────────────────────┤
│ EC2              $18,500     $28,750     +$10,250 (+55%)  │
│ RDS              $12,000     $15,500     +$3,500 (+29%)   │
│ S3               $4,200      $6,800      +$2,600 (+62%)   │
│ Lambda           $2,100      $3,400      +$1,300 (+62%)   │
│ CloudFront       $3,500      $3,800      +$300 (+9%)      │
│ Other            $4,934      $5,078      +$144 (+3%)      │
└───────────────────────────────────────────────────────────┘

Top Contributor: EC2 (+$10,250, 57% of increase)

→ Drilling into EC2 costs...
✓ aws_query (EC2 instances) (0.5s)

EC2 Analysis:
┌───────────────────────────────────────────────────────────┐
│ Finding: New r5.4xlarge instances                         │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ 4 new r5.4xlarge instances launched on Dec 5th           │
│                                                           │
│ Instances:                                                │
│   • analytics-worker-1  (running since Dec 5)             │
│   • analytics-worker-2  (running since Dec 5)             │
│   • analytics-worker-3  (running since Dec 5)             │
│   • analytics-worker-4  (running since Dec 5)             │
│                                                           │
│ Cost: $1.008/hour × 4 × 720 hours = $2,903/month         │
│                                                           │
│ Owner: data-team (tag: Team=data)                        │
│                                                           │
└───────────────────────────────────────────────────────────┘

→ Checking instance utilization...
✓ aws_query (CloudWatch metrics) (0.8s)

Utilization Analysis:
┌───────────────────────────────────────────────────────────┐
│ Instance           CPU Avg    CPU Max    Memory Avg       │
├───────────────────────────────────────────────────────────┤
│ analytics-worker-1   12%        45%         35%           │
│ analytics-worker-2   15%        52%         38%           │
│ analytics-worker-3   8%         28%         22%           │
│ analytics-worker-4   5%         15%         18%           │
└───────────────────────────────────────────────────────────┘

Finding: Instances are significantly underutilized
  • Average CPU: 10%
  • Average Memory: 28%

→ Analyzing S3 increase...
✓ aws_cli (s3-cost-breakdown) (1.1s)

S3 Analysis:
┌───────────────────────────────────────────────────────────┐
│ Finding: Large data lake growth                           │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ Bucket: data-lake-prod                                    │
│   November: 45 TB                                         │
│   December: 82 TB (+37 TB, +82%)                         │
│                                                           │
│ Growth source: analytics-worker outputs                   │
│ Storage class: Standard (not optimized)                   │
│                                                           │
│ Cost impact: +$2,150/month                               │
│                                                           │
└───────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════
                    ROOT CAUSES IDENTIFIED
═══════════════════════════════════════════════════════════════

1. New Analytics Infrastructure (+$10,250)
   • 4 r5.4xlarge instances launched Dec 5
   • Instances underutilized (10% CPU avg)
   • Data team initiative for new ML pipeline

2. Data Lake Growth (+$2,600)
   • 37 TB added to S3 Standard
   • Outputs from new analytics workers
   • No lifecycle policy configured

3. RDS Scaling (+$3,500)
   • Read replicas added for analytics queries
   • Connected to same initiative

Total explained: $16,350 of $18,094 (90%)

═══════════════════════════════════════════════════════════════
                    RECOMMENDATIONS
═══════════════════════════════════════════════════════════════

Immediate Savings: ~$5,500/month

1. Right-size analytics instances
   Recommendation: r5.2xlarge instead of r5.4xlarge
   Savings: $1,450/month (50% reduction)
   Action: Resize during off-hours

2. Use Spot instances for analytics
   Current workload is fault-tolerant
   Savings: ~$2,200/month (70% of instance cost)
   Action: Convert to Spot fleet

3. S3 Intelligent-Tiering
   82 TB with varying access patterns
   Savings: ~$800/month
   Action: Enable Intelligent-Tiering

4. Reserved Instances for RDS
   Stable read replica usage
   Savings: ~$1,050/month (30%)
   Action: Purchase 1-year reserved instances

Would you like to implement any of these recommendations?
```

### Implement Recommendations

```bash
runbook ask "Implement the S3 Intelligent-Tiering recommendation"
```

```
→ Implementing S3 Intelligent-Tiering...

╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  Operation: Enable S3 Intelligent-Tiering                   ║
║  Bucket: data-lake-prod                                     ║
║  Size: 82 TB                                                ║
║  Risk Level: LOW                                            ║
║                                                             ║
║  Impact:                                                    ║
║    • Estimated savings: $800/month                          ║
║    • No data loss or downtime                               ║
║    • Automatic tiering based on access                      ║
║                                                             ║
║  Rollback:                                                  ║
║    Revert to Standard storage class                         ║
╚════════════════════════════════════════════════════════════╝

[Approved]

→ Creating lifecycle policy...
✓ Lifecycle policy created

→ Applying to existing objects...
  This will run asynchronously via S3 Batch Operations

Configuration applied successfully!
Savings will begin appearing within 30 days.
```

## Regular Cost Monitoring

Set up automated cost analysis:

```bash
# Weekly cost report
runbook ask "Show me a weekly cost summary with anomalies"
```

```
Weekly Cost Report: Jan 8-14, 2024
══════════════════════════════════

Total Spend: $14,832 (vs $15,105 last week, -2%)

By Service:
  EC2: $6,100 ✓ (expected)
  RDS: $3,500 ✓ (expected)
  S3: $1,800 ↓ (Intelligent-Tiering savings)
  Lambda: $850 ✓ (expected)
  Other: $2,582 ✓ (expected)

Anomalies Detected:
  ⚠️ Lambda cost +15% on Wednesday
     Cause: Retry storm in payment-processor
     Resolved: Yes (fixed in v2.1.1)

  ⚠️ Data Transfer spike on Friday
     Cause: Large backup to different region
     Expected: Yes (scheduled backup)

Budget Status:
  Monthly budget: $60,000
  Current pace: $59,328 (99%)
  Status: On track ✓
```
