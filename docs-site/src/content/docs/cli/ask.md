---
title: ask
description: Query infrastructure using natural language
---

The `ask` command lets you query your infrastructure using natural language. Runbook translates your question into the appropriate API calls and returns formatted results.

## Usage

```bash
runbook ask "<query>" [options]
```

## Examples

### Basic Queries

```bash
# List EC2 instances
runbook ask "What EC2 instances are running?"

# Check RDS status
runbook ask "Show me the status of all RDS databases"

# Get ECS service info
runbook ask "How many tasks are running for checkout-api?"

# Kubernetes status
runbook ask "What pods are in CrashLoopBackOff?"
```

### Multi-Resource Queries

```bash
# Query multiple resource types
runbook ask "Show cluster status, top pods, and recent events"

# Cross-service queries
runbook ask "Which services depend on the payments database?"

# Aggregated metrics
runbook ask "What's the average CPU across all API servers?"
```

### Troubleshooting Queries

```bash
# Find issues
runbook ask "Why is the checkout API slow?"

# Check recent changes
runbook ask "What deployed in the last 24 hours?"

# Find errors
runbook ask "Show me errors in production logs from the last hour"
```

### Cost Queries

```bash
# Cost breakdown
runbook ask "What are the top 5 most expensive services?"

# Cost trends
runbook ask "How has our EC2 spend changed this month?"
```

## Options

| Option | Description |
|--------|-------------|
| `--verbose, -v` | Show detailed execution (tool calls, timing) |
| `--json` | Output results as JSON |
| `--no-knowledge` | Skip knowledge base search |
| `--region <region>` | Override AWS region |
| `--context <context>` | Override Kubernetes context |

## Output Format

### Standard Output

```
$ runbook ask "What EC2 instances are running?"

→ Querying AWS for EC2 instances...
✓ aws_query (312ms)

Found 12 running EC2 instances:

| Instance ID         | Type      | State   | Name              |
|---------------------|-----------|---------|-------------------|
| i-0abc123def456789  | t3.medium | running | prod-api-1        |
| i-0def789abc012345  | t3.large  | running | prod-api-2        |
| i-0123456789abcdef  | r5.xlarge | running | prod-cache-1      |
...
```

### Verbose Output

```
$ runbook ask "What EC2 instances are running?" --verbose

[14:32:05] Initializing agent...
[14:32:05] Loading configuration from .runbook/config.yaml
[14:32:05] Searching knowledge base...
[14:32:05] No relevant knowledge found

[14:32:05] Generating query plan...
[14:32:05] Tool: aws_query
           Service: ec2
           Operation: describe-instances
           Filters: state=running

[14:32:05] Executing aws_query...
[14:32:06] Response received (312ms)
           Instances: 12

Found 12 running EC2 instances:
...
```

### JSON Output

```bash
$ runbook ask "What EC2 instances are running?" --json
```

```json
{
  "query": "What EC2 instances are running?",
  "duration": 312,
  "tools": [
    {
      "name": "aws_query",
      "args": {
        "service": "ec2",
        "operation": "describe-instances"
      },
      "duration": 312
    }
  ],
  "result": {
    "instances": [
      {
        "instanceId": "i-0abc123def456789",
        "instanceType": "t3.medium",
        "state": "running",
        "name": "prod-api-1"
      }
    ],
    "count": 12
  }
}
```

## Query Patterns

### Resource Listing

```bash
# List resources
"List all Lambda functions"
"Show me all S3 buckets"
"What ECS clusters exist?"

# With filters
"Show EC2 instances tagged with Environment=production"
"List RDS instances larger than db.r5.large"
```

### Status Checks

```bash
# Health checks
"Is the checkout API healthy?"
"Are all nodes in the cluster ready?"
"What's the status of the prod database?"

# Specific metrics
"What's the CPU usage on prod-api-1?"
"How much memory is the cache using?"
```

### Relationship Queries

```bash
# Dependencies
"What services depend on the auth database?"
"Show the network topology for checkout-api"

# Comparisons
"Compare production and staging configurations"
"What's different between v1.2.0 and v1.3.0 deployments?"
```

### Time-Based Queries

```bash
# Recent changes
"What changed in the last hour?"
"Show deployments from today"

# Historical data
"What was the error rate yesterday?"
"Show traffic patterns for the past week"
```

## Knowledge Integration

When asking questions, Runbook automatically searches the knowledge base:

```
$ runbook ask "Why is the database slow?"

→ Searching knowledge base...
Found relevant runbook: "Database Performance Troubleshooting"

→ Querying RDS metrics...
✓ aws_query (234ms)

Based on your runbook "Database Performance Troubleshooting":

Current Issue:
- Connection count: 95% of limit
- Query latency: 2.3s (10x baseline)

Recommended Actions (from runbook):
1. Check for long-running queries
2. Consider adding read replicas
3. Review connection pool settings

See: .runbook/runbooks/database-performance.md
```

Disable with `--no-knowledge`:

```bash
runbook ask "Why is the database slow?" --no-knowledge
```

## Error Handling

### Authentication Errors

```
$ runbook ask "Show EC2 instances"

Error: AWS authentication failed

Please ensure:
1. AWS credentials are configured (aws configure)
2. The profile in config.yaml exists
3. Credentials have necessary permissions

For more info: runbook docs auth
```

### Permission Errors

```
$ runbook ask "Show IAM users"

Error: Access denied for operation iam:ListUsers

The configured AWS credentials don't have permission
to perform this operation.

Required permission: iam:ListUsers
```

### Timeout Errors

```
$ runbook ask "Show all CloudWatch logs"

Error: Query timed out after 30 seconds

The query was too broad. Try:
- Adding filters (time range, log group)
- Being more specific about what you need
```

## Best Practices

1. **Be specific** - "Show EC2 instances in us-east-1" is better than "show instances"
2. **Add context** - "Why is checkout-api slow?" includes service name
3. **Use filters** - "Show errors from the last hour" limits scope
4. **Reference knowledge** - "According to the runbook, what should I check?" leverages organizational knowledge

## Next Steps

- [investigate](/RunbookAI/cli/investigate/) - For incident investigation
- [chat](/RunbookAI/cli/chat/) - For interactive sessions
