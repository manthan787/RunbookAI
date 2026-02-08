---
title: Kubernetes Integration
description: Configure and use Kubernetes with Runbook
---

Runbook provides read-only Kubernetes integration through the `kubernetes_query` tool, enabling cluster status, pod management, and troubleshooting.

## Configuration

```yaml
# .runbook/config.yaml
providers:
  kubernetes:
    enabled: true
    context: production-cluster  # kubectl context
    namespace: default           # Default namespace
    kubeconfig: ~/.kube/config   # Path to kubeconfig
```

## Prerequisites

- `kubectl` installed and in PATH
- Valid kubeconfig with cluster access
- Appropriate RBAC permissions

## Available Actions

The `kubernetes_query` tool supports these actions:

| Action | Description |
|--------|-------------|
| `status` | Cluster overview (nodes, pods, deployments) |
| `contexts` | List available kubectl contexts |
| `namespaces` | List all namespaces |
| `pods` | List/describe pods with filtering |
| `deployments` | Get deployment status |
| `nodes` | Node health and resources |
| `events` | Recent cluster events |
| `top_pods` | Pod resource usage |
| `top_nodes` | Node resource usage |

## Usage Examples

### Cluster Status

```bash
runbook ask "What's the status of my Kubernetes cluster?"
```

Output:
```
Cluster: production-east
Status: Healthy

Nodes: 8/8 Ready
  ├─ node-1: Ready (CPU: 45%, Memory: 62%)
  ├─ node-2: Ready (CPU: 38%, Memory: 55%)
  └─ ... (6 more)

Pods: 142 running, 3 pending, 0 failed
Deployments: 18/18 healthy
```

### Pod Queries

```bash
# List all pods
runbook ask "Show all pods in the production namespace"

# Pods with issues
runbook ask "Which pods are not running?"

# Specific pod details
runbook ask "Show details for checkout-api pods"
```

### Deployment Status

```bash
# All deployments
runbook ask "Show deployment status"

# Specific deployment
runbook ask "Is the payment-service deployment healthy?"

# Recent deployments
runbook ask "What deployed in the last 24 hours?"
```

### Resource Usage

```bash
# Top pods by CPU
runbook ask "Which pods are using the most CPU?"

# Top pods by memory
runbook ask "Show pods with highest memory usage"

# Node resources
runbook ask "Are any nodes under resource pressure?"
```

### Events and Troubleshooting

```bash
# Recent events
runbook ask "Show warning events from the last hour"

# Pod events
runbook ask "What events are there for checkout-api pods?"

# Scheduling issues
runbook ask "Are there any pods stuck pending?"
```

## Tool Reference

### kubernetes_query Parameters

```typescript
{
  name: "kubernetes_query",
  parameters: {
    action: "status | contexts | namespaces | pods | deployments | nodes | events | top_pods | top_nodes",
    namespace: "Namespace to query (optional, uses default)",
    name: "Resource name for specific queries (optional)",
    labelSelector: "Label selector for filtering (optional)",
    fieldSelector: "Field selector for filtering (optional)",
    allNamespaces: "Query all namespaces (optional, default false)"
  }
}
```

### Example Tool Calls

```
Query: "Show pods in CrashLoopBackOff"

Tool Call:
  name: kubernetes_query
  args:
    action: pods
    fieldSelector: status.phase!=Running
    allNamespaces: true

Query: "Top 5 pods by CPU"

Tool Call:
  name: kubernetes_query
  args:
    action: top_pods
    namespace: default
```

## Multi-Context Support

Configure multiple clusters:

```yaml
providers:
  kubernetes:
    enabled: true
    contexts:
      - name: production
        context: prod-east-1
        namespace: prod
      - name: staging
        context: staging
        namespace: staging
      - name: development
        context: dev
        namespace: dev
```

Query specific contexts:

```bash
# Use specific context
runbook ask "Show pods in staging" --context staging

# Compare clusters
runbook ask "Compare pod counts between production and staging"
```

## Required RBAC Permissions

Minimum ClusterRole for read-only access:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: runbook-reader
rules:
  - apiGroups: [""]
    resources:
      - pods
      - pods/log
      - services
      - endpoints
      - nodes
      - namespaces
      - events
      - configmaps
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources:
      - deployments
      - replicasets
      - statefulsets
      - daemonsets
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources:
      - jobs
      - cronjobs
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources:
      - pods
      - nodes
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: runbook-reader-binding
subjects:
  - kind: User
    name: runbook-sa
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: runbook-reader
  apiGroup: rbac.authorization.k8s.io
```

## Limitations

Current Kubernetes integration is **read-only**:

- Cannot create/update/delete resources
- Cannot exec into pods
- Cannot port-forward

For mutation operations, use skills or manual kubectl commands.

## Troubleshooting

### "kubectl not found"

```
Error: kubectl command not found

Ensure kubectl is installed and in PATH:
  brew install kubectl  # macOS
  # or
  apt-get install kubectl  # Linux
```

### "Context not found"

```
Error: context "production" not found in kubeconfig

Check available contexts:
  kubectl config get-contexts

Update config to use valid context:
  providers.kubernetes.context: your-actual-context
```

### "Forbidden" Errors

```
Error: pods is forbidden: User "runbook" cannot list resource "pods"

Grant RBAC permissions:
  kubectl apply -f runbook-rbac.yaml
```

## Next Steps

- [Kubernetes Tools](/RunbookAI/tools/kubernetes/) - Detailed tool reference
- [AWS Integration](/RunbookAI/integrations/aws/) - Configure AWS
