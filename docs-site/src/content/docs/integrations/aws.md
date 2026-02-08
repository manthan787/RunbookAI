---
title: AWS Integration
description: Configure and use AWS services with Runbook
---

Runbook provides deep integration with AWS, supporting 40+ services through both SDK and CLI interfaces.

## Configuration

```yaml
# .runbook/config.yaml
providers:
  aws:
    enabled: true
    regions:
      - us-east-1
      - us-west-2
    profile: default  # AWS CLI profile
```

## Authentication

Runbook uses the standard AWS credential chain:

1. **Environment variables**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
2. **Shared credentials file**: `~/.aws/credentials`
3. **AWS CLI profile**: Specified in config or `AWS_PROFILE`
4. **IAM role**: EC2 instance role or ECS task role

### Using Profiles

```yaml
providers:
  aws:
    profile: production  # Uses [production] profile from ~/.aws/credentials
```

### Cross-Account Access

```yaml
providers:
  aws:
    assumeRole: arn:aws:iam::123456789012:role/RunbookRole
    externalId: your-external-id  # Optional
```

## Supported Services

### Compute

| Service | Query Examples |
|---------|----------------|
| **EC2** | Instances, security groups, volumes, snapshots |
| **ECS** | Clusters, services, tasks, task definitions |
| **EKS** | Clusters, node groups |
| **Lambda** | Functions, invocations, layers |
| **Batch** | Jobs, job queues, compute environments |

### Database

| Service | Query Examples |
|---------|----------------|
| **RDS** | Instances, clusters, snapshots, metrics |
| **DynamoDB** | Tables, capacity, streams |
| **ElastiCache** | Clusters, nodes, replication groups |
| **Redshift** | Clusters, snapshots |
| **DocumentDB** | Clusters, instances |

### Networking

| Service | Query Examples |
|---------|----------------|
| **VPC** | VPCs, subnets, route tables, NAT gateways |
| **ELB/ALB/NLB** | Load balancers, target groups, health |
| **Route 53** | Hosted zones, records, health checks |
| **CloudFront** | Distributions, cache statistics |
| **API Gateway** | APIs, stages, usage plans |

### Storage

| Service | Query Examples |
|---------|----------------|
| **S3** | Buckets, objects, lifecycle policies |
| **EFS** | File systems, mount targets |
| **FSx** | File systems |

### Monitoring & Logging

| Service | Query Examples |
|---------|----------------|
| **CloudWatch** | Metrics, alarms, logs, dashboards |
| **X-Ray** | Traces, service maps |

### Security & Identity

| Service | Query Examples |
|---------|----------------|
| **IAM** | Users, roles, policies |
| **Secrets Manager** | Secrets (metadata only) |
| **KMS** | Keys, aliases |
| **Certificate Manager** | Certificates |

### Other Services

| Service | Query Examples |
|---------|----------------|
| **SNS** | Topics, subscriptions |
| **SQS** | Queues, messages |
| **CloudFormation** | Stacks, resources |
| **Cost Explorer** | Cost and usage data |

## Usage Examples

### Natural Language Queries

```bash
# List EC2 instances
runbook ask "What EC2 instances are running in production?"

# Check RDS status
runbook ask "Show me RDS cluster health and recent metrics"

# ECS service info
runbook ask "How many tasks are running for checkout-api?"

# Lambda insights
runbook ask "Which Lambda functions have high error rates?"

# Cost analysis
runbook ask "What are the top 5 most expensive services this month?"
```

### Multi-Region Queries

```bash
# Query across regions
runbook ask "Show EC2 instances across all configured regions"

# Region-specific query
runbook ask "Show RDS instances in eu-west-1" --region eu-west-1
```

## The aws_query Tool

Runbook's primary AWS tool translates natural language to API calls:

```typescript
// Tool definition
{
  name: "aws_query",
  description: "Query AWS services using natural language",
  parameters: {
    service: "AWS service name (ec2, ecs, rds, etc.)",
    operation: "Operation to perform",
    parameters: "Operation-specific parameters"
  }
}
```

### Example Tool Calls

```
Query: "What RDS instances are running?"

Tool Call:
  name: aws_query
  args:
    service: rds
    operation: describe-db-instances
    parameters:
      Filters:
        - Name: db-instance-status
          Values: [available]
```

## The aws_cli Tool

For operations not covered by SDK, Runbook falls back to AWS CLI:

```bash
# Complex queries
runbook ask "Get cost and usage data for January 2024"

# Invokes:
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost
```

## Required IAM Permissions

Minimum permissions for read-only operations:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ecs:Describe*",
        "ecs:List*",
        "rds:Describe*",
        "lambda:List*",
        "lambda:Get*",
        "cloudwatch:GetMetricData",
        "cloudwatch:DescribeAlarms",
        "logs:FilterLogEvents",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "*"
    }
  ]
}
```

For mutation operations (scale, deploy, etc.), add:

```json
{
  "Effect": "Allow",
  "Action": [
    "ecs:UpdateService",
    "ecs:RegisterTaskDefinition",
    "lambda:UpdateFunctionCode",
    "rds:ModifyDBCluster"
  ],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:RequestTag/ManagedBy": "Runbook"
    }
  }
}
```

## Best Practices

1. **Use IAM roles** - Prefer roles over access keys
2. **Limit permissions** - Only grant what's needed
3. **Use resource tags** - Tag resources managed by Runbook
4. **Enable CloudTrail** - Audit all Runbook actions
5. **Configure regions explicitly** - Don't use wildcard regions

## Troubleshooting

### "Access Denied" Errors

```
Error: AccessDenied when calling DescribeInstances

Check:
1. IAM permissions include ec2:DescribeInstances
2. Resource policy allows access
3. Correct AWS profile is configured
```

### "Region not configured"

```
Error: Region us-west-2 not in configured regions

Add region to config:
providers:
  aws:
    regions:
      - us-east-1
      - us-west-2  # Add this
```

## Next Steps

- [Kubernetes Integration](/RunbookAI/integrations/kubernetes/) - Configure Kubernetes
- [AWS Tools](/RunbookAI/tools/aws/) - Detailed tool reference
