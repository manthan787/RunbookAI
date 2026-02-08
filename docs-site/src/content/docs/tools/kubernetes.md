---
title: Kubernetes Tools
description: Kubernetes tool reference
---

The `kubernetes_query` tool provides read-only access to Kubernetes clusters.

## kubernetes_query

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Operation to perform |
| `namespace` | string | No | Target namespace |
| `name` | string | No | Resource name |
| `labelSelector` | string | No | Label filter |
| `fieldSelector` | string | No | Field filter |
| `allNamespaces` | boolean | No | Query all namespaces |

### Actions

#### status

Cluster overview:

```
kubernetes_query:
  action: status
```

Returns:
- Cluster name and version
- Node count and health
- Pod summary
- Deployment health

#### contexts

List kubectl contexts:

```
kubernetes_query:
  action: contexts
```

#### namespaces

List namespaces:

```
kubernetes_query:
  action: namespaces
```

#### pods

List or describe pods:

```
# All pods in namespace
kubernetes_query:
  action: pods
  namespace: production

# Specific pod
kubernetes_query:
  action: pods
  namespace: production
  name: checkout-api-7d9f8b6c5-abc12

# With label selector
kubernetes_query:
  action: pods
  labelSelector: "app=checkout-api"
  allNamespaces: true

# Pods not running
kubernetes_query:
  action: pods
  fieldSelector: "status.phase!=Running"
```

#### deployments

Deployment status:

```
kubernetes_query:
  action: deployments
  namespace: production

# Specific deployment
kubernetes_query:
  action: deployments
  namespace: production
  name: checkout-api
```

#### nodes

Node information:

```
kubernetes_query:
  action: nodes

# Specific node
kubernetes_query:
  action: nodes
  name: node-1
```

#### events

Cluster events:

```
# All events
kubernetes_query:
  action: events
  namespace: production

# Warning events only
kubernetes_query:
  action: events
  fieldSelector: "type=Warning"
```

#### top_pods

Pod resource usage:

```
kubernetes_query:
  action: top_pods
  namespace: production
```

Returns CPU and memory usage per pod.

#### top_nodes

Node resource usage:

```
kubernetes_query:
  action: top_nodes
```

Returns CPU and memory usage per node.

## Example Outputs

### Cluster Status

```
Cluster: production-east
Version: 1.28.3
Status: Healthy

Nodes: 8/8 Ready
  ├─ node-1: Ready (CPU: 45%, Memory: 62%)
  ├─ node-2: Ready (CPU: 38%, Memory: 55%)
  └─ ...

Pods: 142/145
  ├─ Running: 142
  ├─ Pending: 3
  └─ Failed: 0

Deployments: 18/18 Available
```

### Pod List

```
| Name                      | Namespace | Status  | Restarts | Age   |
|---------------------------|-----------|---------|----------|-------|
| checkout-api-7d9f8b6c5    | prod      | Running | 0        | 2d    |
| checkout-api-8e0g9c7d6    | prod      | Running | 0        | 2d    |
| payment-svc-5f6g7h8i9     | prod      | Running | 3        | 5h    |
```

### Events

```
| Type    | Reason           | Object                  | Message                |
|---------|------------------|-------------------------|------------------------|
| Warning | BackOff          | pod/api-xyz             | Back-off restarting    |
| Warning | FailedScheduling | pod/worker-abc          | Insufficient memory    |
| Normal  | Pulled           | pod/cache-123           | Container image pulled |
```

## Limitations

Current Kubernetes integration is **read-only**:

- Cannot create resources
- Cannot update deployments
- Cannot delete pods
- Cannot exec into containers
- Cannot port-forward

For mutations, use skills or manual kubectl commands.

## Prerequisites

- `kubectl` installed and in PATH
- Valid kubeconfig
- RBAC permissions for queries

See [Kubernetes Integration](/RunbookAI/integrations/kubernetes/) for setup details.
