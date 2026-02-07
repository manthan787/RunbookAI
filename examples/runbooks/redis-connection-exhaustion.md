---
type: runbook
services:
  - checkout-api
  - cart-service
  - session-service
symptoms:
  - Redis connection timeout
  - Connection pool exhausted
  - ECONNREFUSED redis
severity: sev2
tags:
  - redis
  - elasticache
  - connections
author: platform-team
lastValidated: 2024-01-10
---

# Redis Connection Exhaustion

## Overview

This runbook covers diagnosis and remediation when Redis connection pools are exhausted, typically manifesting as connection timeouts or refused connections.

## Symptoms

- Error logs showing "Redis connection timeout" or "pool exhausted"
- Elevated 5xx error rates on services using Redis
- CloudWatch: `ElastiCache.CurrConnections` approaching `Maxclients`
- Slow response times across multiple services

## Quick Diagnosis

### Check Current Connections

```bash
# Check current connections via AWS CLI
aws elasticache describe-cache-clusters \
  --cache-cluster-id prod-redis \
  --show-cache-node-info
```

### Check Connection Metrics

```bash
# Get connection metrics from CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/ElastiCache \
  --metric-name CurrConnections \
  --dimensions Name=CacheClusterId,Value=prod-redis \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Maximum
```

### Check for Connection Rejections

```bash
# Look for rejected connection logs
aws logs filter-log-events \
  --log-group-name /ecs/checkout-api \
  --filter-pattern "Redis connection" \
  --start-time $(date -d '15 minutes ago' +%s)000
```

## Root Cause Analysis

### Traffic Spike (Most Common)

**Indicators:**
- Request rate significantly above baseline
- All services affected simultaneously
- No recent deployments

**Verification:**
```bash
# Check ALB request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name RequestCount \
  --dimensions Name=LoadBalancer,Value=app/prod-alb/1234567890 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

### Connection Leak

**Indicators:**
- Gradual connection increase over hours/days
- Single service has disproportionate connections
- Memory usage stable (not OOM)

**Verification:**
```bash
# Check per-service connection counts if instrumented
# Look for services not releasing connections properly
```

### Maxclients Too Low

**Indicators:**
- Connections at exactly maxclients limit
- Traffic is within normal range
- Recently added new services

## Mitigation Steps

### For Traffic Spike (Immediate)

1. **Scale Redis cluster:**
   ```bash
   aws elasticache modify-replication-group \
     --replication-group-id prod-redis \
     --node-group-count 6 \
     --apply-immediately
   ```

2. **Monitor recovery** (5-10 min for new nodes to come online)

3. **Consider rate limiting** if traffic is from a single source

### For Connection Leak

1. **Identify leaking service:**
   - Check application metrics for connection counts per service
   - Look for services without proper connection pooling

2. **Restart affected service pods:**
   ```bash
   kubectl rollout restart deployment/<service> -n prod
   ```

3. **File bug** for connection leak fix with details

### For Maxclients Too Low

1. **Update parameter group:**
   ```bash
   aws elasticache modify-cache-parameter-group \
     --cache-parameter-group-name prod-redis-params \
     --parameter-name-values "ParameterName=maxclients,ParameterValue=1000"
   ```

2. **Reboot cluster to apply** (schedule during low-traffic period if possible)

## Escalation

- **Primary:** #platform-oncall in Slack
- **Secondary:** @redis-team in Slack
- **If data loss suspected:** Page Database Team via PagerDuty

## Prevention

- Set up CloudWatch alarms for `CurrConnections` > 80% of maxclients
- Implement connection pooling with proper max pool size
- Use connection timeouts to prevent hanging connections
- Regular capacity reviews based on traffic growth

## Related Post-mortems

- 2024-01-15: Checkout outage due to Redis exhaustion during flash sale
- 2023-11-02: Black Friday traffic spike exceeded connection limits
