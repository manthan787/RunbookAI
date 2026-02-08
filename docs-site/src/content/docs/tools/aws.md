---
title: AWS Tools
description: AWS service tool reference
---

Runbook provides comprehensive AWS integration through two primary tools.

## aws_query

Natural language to AWS API translation.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | string | Yes | AWS service (ec2, ecs, rds, etc.) |
| `operation` | string | Yes | API operation |
| `parameters` | object | No | Operation-specific parameters |
| `region` | string | No | Override default region |

### Supported Services

**Compute**
- `ec2`: Instances, security groups, volumes
- `ecs`: Clusters, services, tasks
- `eks`: Clusters, node groups
- `lambda`: Functions, invocations

**Database**
- `rds`: Instances, clusters, snapshots
- `dynamodb`: Tables, items
- `elasticache`: Clusters, nodes

**Networking**
- `elb`: Load balancers, target groups
- `route53`: Hosted zones, records
- `cloudfront`: Distributions

**Monitoring**
- `cloudwatch`: Metrics, alarms, logs

**Storage**
- `s3`: Buckets, objects

### Examples

**List EC2 Instances**
```
aws_query:
  service: ec2
  operation: describe-instances
  parameters:
    Filters:
      - Name: instance-state-name
        Values: [running]
```

**Get RDS Metrics**
```
aws_query:
  service: cloudwatch
  operation: get-metric-data
  parameters:
    MetricDataQueries:
      - Id: cpu
        MetricStat:
          Metric:
            Namespace: AWS/RDS
            MetricName: CPUUtilization
            Dimensions:
              - Name: DBInstanceIdentifier
                Value: prod-db
          Period: 300
          Stat: Average
```

**Update ECS Service**
```
aws_query:
  service: ecs
  operation: update-service
  parameters:
    cluster: prod
    service: checkout-api
    desiredCount: 8
```

## aws_cli

Direct AWS CLI execution for complex operations.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | Full AWS CLI command |
| `region` | string | No | Override region |

### Examples

**Cost Explorer Query**
```
aws_cli:
  command: "aws ce get-cost-and-usage --time-period Start=2024-01-01,End=2024-01-31 --granularity MONTHLY --metrics BlendedCost"
```

**Complex Filters**
```
aws_cli:
  command: "aws ec2 describe-instances --filters 'Name=tag:Environment,Values=production' --query 'Reservations[].Instances[].{ID:InstanceId,Type:InstanceType,State:State.Name}'"
```

## Service-Specific Operations

### EC2

| Operation | Description |
|-----------|-------------|
| `describe-instances` | List instances |
| `describe-security-groups` | List security groups |
| `describe-volumes` | List EBS volumes |
| `describe-snapshots` | List snapshots |

### ECS

| Operation | Description |
|-----------|-------------|
| `describe-clusters` | Cluster details |
| `describe-services` | Service details |
| `list-tasks` | Running tasks |
| `describe-task-definition` | Task definition |
| `update-service` | Modify service |

### RDS

| Operation | Description |
|-----------|-------------|
| `describe-db-instances` | Instance details |
| `describe-db-clusters` | Cluster details |
| `describe-db-snapshots` | Snapshots |

### Lambda

| Operation | Description |
|-----------|-------------|
| `list-functions` | All functions |
| `get-function` | Function details |
| `list-event-source-mappings` | Event sources |

### CloudWatch

| Operation | Description |
|-----------|-------------|
| `get-metric-data` | Metric values |
| `describe-alarms` | Alarm status |
| `filter-log-events` | Search logs |

## Error Handling

### Access Denied

```
Error: AccessDenied for operation ecs:DescribeServices

Required permission: ecs:DescribeServices
Add to IAM policy:
{
  "Effect": "Allow",
  "Action": "ecs:DescribeServices",
  "Resource": "*"
}
```

### Invalid Parameters

```
Error: Invalid parameter: cluster 'nonexistent' not found

Available clusters:
- prod-east
- staging
```

## Best Practices

1. **Use aws_query for common operations** - Better error handling
2. **Use aws_cli for complex queries** - JMESPath, complex filters
3. **Specify region when needed** - Don't rely on defaults
4. **Use resource tags** - Filter by Environment, Team, etc.
