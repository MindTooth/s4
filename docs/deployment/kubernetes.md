# Kubernetes Deployment

Comprehensive guide for deploying S4 on Kubernetes.

## Overview

S4 can be deployed to Kubernetes using **Helm charts** (recommended) or raw manifests. The deployment includes:

- Deployment with single replica
- ClusterIP Service for internal access
- NodePort Service for external access (optional)
- PersistentVolumeClaims for data storage
- ConfigMap for configuration
- Secret for credentials
- Optional Ingress for external HTTPS access (Web UI)
- Optional Ingress for external S3 API access
- Optional OpenShift Route for OpenShift deployments

## Deployment Methods

| Method                 | Best For           | Advantages                              |
| ---------------------- | ------------------ | --------------------------------------- |
| **Helm** (Recommended) | Production, GitOps | Easy configuration, upgrades, rollbacks |
| Raw Manifests          | Simple deployments | No Helm required, direct kubectl apply  |

## Deployment Architecture

S4 is designed for **single-replica deployment only**. The architecture decisions include:

- **SQLite Backend**: Ceph RGW uses SQLite for persistence, which doesn't support concurrent access from multiple pods
- **Attached Volume**: Data is stored on a ReadWriteOnce PVC, not shared storage
- **In-Memory State**: Rate limiting and session management use in-memory storage

This means:

- ✅ No Redis or external state store required
- ✅ JWT secret generation on startup is acceptable
- ✅ In-memory rate limiting works correctly
- ⚠️ Scaling beyond 1 replica requires architecture changes (RWX storage, external session store)

> **⚠️ Security Warning**: The default internal S3 credentials (`s4admin`/`s4secret`) in the example manifests are for development only. Always update the Secret with production credentials before deploying.

## Prerequisites

- Kubernetes 1.20+ cluster
- Helm 3.x (for Helm deployment)
- `kubectl` CLI tool
- At least 2GB RAM per pod
- 10GB persistent storage

---

## Helm Deployment (Recommended)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/rh-aiservices-bu/s4.git
cd s4

# Deploy with authentication (required by default)
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password

# Check deployment status
kubectl get pods -n s4 -l app.kubernetes.io/name=s4

# Port-forward to access locally
kubectl port-forward svc/s4 5000:5000 7480:7480 -n s4

# Access the web UI
open http://localhost:5000
```

### Using Makefile

```bash
# Deploy using Helm
make deploy NAMESPACE=s4

# Remove deployment
make undeploy NAMESPACE=s4
```

### Helm Configuration

Create a `values.yaml` file to customize your deployment:

```yaml
# values.yaml - Production example
image:
  repository: quay.io/rh-aiservices-bu/s4
  tag: latest
  pullPolicy: Always

# Enable authentication
auth:
  enabled: true
  username: admin
  password: your-secure-password
  jwtSecret: your-random-secret-key-min-32-chars

# Storage configuration
storage:
  data:
    size: 100Gi
    # storageClass: ""  # Leave empty to use cluster default
  localStorage:
    size: 500Gi
    # storageClass: ""  # Leave empty to use cluster default

# Resource limits
resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 2000m
    memory: 4Gi
```

Deploy with custom values:

```bash
helm install s4 ./charts/s4 -n s4 --create-namespace -f values.yaml
```

### Common Helm Scenarios

> **Note:** Authentication is enabled by default. All installation examples require `--set auth.username=... --set auth.password=...` unless `--set auth.enabled=false` is specified.

#### Basic Installation

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password
```

#### Without Authentication

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.enabled=false
```

#### With Ingress (Web UI)

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set ingress.enabled=true \
  --set "ingress.hosts[0].host=s4.example.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix"
```

#### With Ingress (Web UI + S3 API)

To also expose the S3 API externally for use with `aws s3`, `mc`, or other S3 clients:

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set ingress.enabled=true \
  --set "ingress.hosts[0].host=s4.example.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix" \
  --set ingress.s3Api.enabled=true \
  --set "ingress.s3Api.hosts[0].host=s3.s4.example.com" \
  --set "ingress.s3Api.hosts[0].paths[0].path=/" \
  --set "ingress.s3Api.hosts[0].paths[0].pathType=Prefix"
```

> **Warning:** Exposing the S3 API externally has security implications. Ensure proper authentication and network policies are in place.

#### With OpenShift Route

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set route.enabled=true \
  --set route.host=s4.apps.example.com
```

#### With Existing PVCs

```bash
helm install s4 ./charts/s4 --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set storage.data.existingClaim=my-data-pvc \
  --set storage.localStorage.existingClaim=my-storage-pvc
```

#### With Existing Secret

```bash
# Create secret first (include auth credentials if auth is enabled)
kubectl create secret generic my-s4-credentials \
  --from-literal=AWS_ACCESS_KEY_ID=mykey \
  --from-literal=AWS_SECRET_ACCESS_KEY=mysecret \
  --from-literal=UI_USERNAME=admin \
  --from-literal=UI_PASSWORD=your-secure-password \
  -n s4

# Deploy using existing secret
helm install s4 ./charts/s4 --namespace s4 \
  --set s3.existingSecret=my-s4-credentials \
  --set auth.username=admin \
  --set auth.password=your-secure-password
```

### Helm Values Reference

See the [Helm chart README](../../charts/s4/README.md) for complete values documentation.

Key configuration groups:

| Group             | Description                                     |
| ----------------- | ----------------------------------------------- |
| `image.*`         | Container image settings                        |
| `s3.*`            | S3 backend configuration                        |
| `auth.*`          | Authentication settings                         |
| `storage.*`       | PVC sizes and storage classes                   |
| `resources.*`     | CPU and memory limits                           |
| `service.*`       | Service type and ports                          |
| `ingress.*`       | Web UI Ingress configuration                    |
| `ingress.s3Api.*` | S3 API Ingress configuration (optional)         |
| `route.*`         | Web UI OpenShift Route configuration            |
| `route.s3Api.*`   | S3 API OpenShift Route configuration (optional) |

### Upgrading with Helm

```bash
# Upgrade with new values
helm upgrade s4 ./charts/s4 -n s4 -f values.yaml

# Upgrade with reusing existing values
helm upgrade s4 ./charts/s4 -n s4 --reuse-values

# View release history
helm history s4 -n s4

# Rollback to previous release
helm rollback s4 1 -n s4
```

### Uninstalling

```bash
# Uninstall release
helm uninstall s4 -n s4

# Note: PVCs are not deleted automatically
# To remove all data:
kubectl delete pvc -l app.kubernetes.io/instance=s4 -n s4
```

---

## Raw Manifest Deployment (Legacy)

For users who prefer not to use Helm, raw manifests are available in the `kubernetes/` directory.

### Quick Start

```bash
# Deploy all resources
kubectl apply -f kubernetes/

# Check deployment status
kubectl get pods -l app=s4

# Port-forward to access locally
kubectl port-forward svc/s4 5000:5000 7480:7480

# Access the web UI
open http://localhost:5000
```

### Using Makefile

```bash
# Deploy using raw manifests
make deploy-raw NAMESPACE=default

# Remove deployment
make undeploy-raw NAMESPACE=default
```

### Manifests Overview

The `kubernetes/` directory contains:

```
kubernetes/
├── s4-secret.yaml        # Credentials (S3, UI auth)
├── s4-configmap.yaml     # Configuration (regions, ports)
├── s4-pvc.yaml           # Persistent Volume Claims
├── s4-deployment.yaml    # Deployment specification
├── s4-service.yaml       # Service definitions
├── s4-route.yaml         # OpenShift Route for Web UI (optional)
├── s4-route-s3.yaml      # OpenShift Route for S3 API (optional)
└── s4-ingress-s3.yaml    # Kubernetes Ingress for S3 API (optional)
```

### Step-by-Step Deployment

#### Step 1: Namespace (Optional)

```bash
# Create dedicated namespace
kubectl create namespace s4

# Set as default
kubectl config set-context --current --namespace=s4
```

#### Step 2: Configuration

##### Secret (Credentials)

```yaml
# kubernetes/s4-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: s4-credentials
type: Opaque
stringData:
  AWS_ACCESS_KEY_ID: 's4admin'
  AWS_SECRET_ACCESS_KEY: 's4secret'
  UI_USERNAME: 'admin'
  UI_PASSWORD: 'pass'
  JWT_SECRET: 'your-random-secret-key'
```

**Important**: Update credentials before deployment!

```bash
# Apply secret
kubectl apply -f kubernetes/s4-secret.yaml

# Or create from command line
kubectl create secret generic s4-credentials \
  --from-literal=AWS_ACCESS_KEY_ID=s4admin \
  --from-literal=AWS_SECRET_ACCESS_KEY=s4secret \
  --from-literal=UI_USERNAME=admin \
  --from-literal=UI_PASSWORD=pass \
  --from-literal=JWT_SECRET=your-random-secret-key
```

##### ConfigMap (Configuration)

```yaml
# kubernetes/s4-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: s4-config
data:
  AWS_DEFAULT_REGION: 'us-east-1'
  PORT: '5000'
  MAX_FILE_SIZE_GB: '20'
  MAX_CONCURRENT_TRANSFERS: '2'
```

```bash
# Apply ConfigMap
kubectl apply -f kubernetes/s4-configmap.yaml
```

#### Step 3: Persistent Storage

```yaml
# kubernetes/s4-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: s4-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: standard # Adjust for your cluster
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: s4-local-storage
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: standard # Adjust for your cluster
```

```bash
# Apply PVCs
kubectl apply -f kubernetes/s4-pvc.yaml

# Check PVC status
kubectl get pvc
```

**Storage Class**: Adjust `storageClassName` for your cluster:

- AWS EKS: `gp2`, `gp3`
- Azure AKS: `managed-premium`
- GCP GKE: `standard`, `premium-rwo`
- OpenShift: `gp2-csi`, `ocs-storagecluster-ceph-rbd`

#### Step 4: Deployment

```bash
# Apply deployment
kubectl apply -f kubernetes/s4-deployment.yaml

# Watch pod creation
kubectl get pods -l app=s4 -w

# Check pod logs
kubectl logs -l app=s4 -f
```

#### Step 5: Service

```bash
# Apply service
kubectl apply -f kubernetes/s4-service.yaml

# Check service
kubectl get svc s4
```

---

## Accessing S4

### Port Forwarding (Development)

```bash
# Forward both ports
kubectl port-forward svc/s4 5000:5000 7480:7480

# Access Web UI
open http://localhost:5000

# Test S3 API
aws s3 ls --endpoint-url http://localhost:7480
```

### NodePort (Testing)

With Helm:

```bash
helm install s4 ./charts/s4 -n s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set service.nodePort.enabled=true
```

With raw manifests, the NodePort service is included in `s4-service.yaml`:

```bash
# Get NodePort
kubectl get svc s4-nodeport

# Access via node IP and port
# http://<node-ip>:<node-port>
```

### Ingress (Production)

By default, Ingress exposes only the **Web UI** (port 5000). The **S3 API** (port 7480) remains cluster-internal unless explicitly enabled.

#### Web UI Ingress

With Helm:

```bash
helm install s4 ./charts/s4 -n s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set "ingress.hosts[0].host=s4.example.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix" \
  --set "ingress.tls[0].secretName=s4-tls" \
  --set "ingress.tls[0].hosts[0]=s4.example.com"
```

With raw manifests, create an Ingress manually:

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: s4
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - s4.example.com
      secretName: s4-tls
  rules:
    - host: s4.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: s4
                port:
                  number: 5000
```

#### S3 API Ingress (Optional)

To also expose the S3 API externally, enable a separate Ingress with its own hostname:

With Helm:

```bash
helm install s4 ./charts/s4 -n s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password \
  --set ingress.enabled=true \
  --set "ingress.hosts[0].host=s4.example.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix" \
  --set ingress.s3Api.enabled=true \
  --set "ingress.s3Api.hosts[0].host=s3.s4.example.com" \
  --set "ingress.s3Api.hosts[0].paths[0].path=/" \
  --set "ingress.s3Api.hosts[0].paths[0].pathType=Prefix"
```

With raw manifests, apply the provided S3 API Ingress:

```bash
kubectl apply -f kubernetes/s4-ingress-s3.yaml
```

> **Warning:** Exposing the S3 API externally has security implications. Ensure proper network policies are in place.

---

## Configuration Updates

### Update Credentials

```bash
# Helm: Update and upgrade
helm upgrade s4 ./charts/s4 -n s4 \
  --set s3.accessKeyId=newkey \
  --set s3.secretAccessKey=newsecret

# Raw manifests: Update secret and restart
kubectl create secret generic s4-credentials \
  --from-literal=AWS_ACCESS_KEY_ID=newadmin \
  --from-literal=AWS_SECRET_ACCESS_KEY=newsecret \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/s4
```

### Update Configuration

```bash
# Helm: Upgrade with new values
helm upgrade s4 ./charts/s4 -n s4 --set storage.maxFileSizeGB=50

# Raw manifests: Edit ConfigMap and restart
kubectl edit configmap s4-config
kubectl rollout restart deployment/s4
```

---

## Monitoring and Health Checks

### Pod Status

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=s4

# Describe pod
kubectl describe pod -l app.kubernetes.io/name=s4

# View pod logs
kubectl logs -l app.kubernetes.io/name=s4 -f

# Previous container logs (if restarted)
kubectl logs -l app.kubernetes.io/name=s4 --previous
```

### Health Checks

S4 includes readiness and liveness probes:

**Readiness Probe**:

- Endpoint: `GET /api/disclaimer`
- Initial Delay: 15s
- Period: 10s
- Purpose: Determines if pod is ready to receive traffic

**Liveness Probe**:

- Endpoint: `GET /api/disclaimer`
- Initial Delay: 60s
- Period: 30s
- Purpose: Restarts pod if unresponsive

---

## Backup and Restore

### Backup PVCs

```bash
# Create backup job
kubectl create job s4-backup-$(date +%Y%m%d) \
  --image=alpine \
  -- sh -c 'tar czf /backup/s4-data.tar.gz -C /data .'

# Copy backup from pod
kubectl cp <pod-name>:/backup/s4-data.tar.gz ./s4-data-backup.tar.gz
```

### Velero Backup

```bash
# Install Velero
# https://velero.io/docs/

# Backup S4 namespace
velero backup create s4-backup --include-namespaces s4

# Restore from backup
velero restore create --from-backup s4-backup
```

---

## Upgrading

### Helm Upgrade

```bash
# Update image version
helm upgrade s4 ./charts/s4 -n s4 --set image.tag=v1.2.0

# Watch rollout
kubectl rollout status deployment/s4 -n s4

# Rollback if needed
helm rollback s4 1 -n s4
```

### Raw Manifest Upgrade

```bash
# Update image version
kubectl set image deployment/s4 s4=quay.io/rh-aiservices-bu/s4:v1.2.0

# Watch rollout
kubectl rollout status deployment/s4

# Rollback if needed
kubectl rollout undo deployment/s4
```

---

## Troubleshooting

### Pod Not Starting

```bash
# Check pod status
kubectl describe pod -l app.kubernetes.io/name=s4

# Common issues:
# - ImagePullBackOff: Check image name and registry access
# - Pending: Check PVC status and node resources
# - CrashLoopBackOff: Check logs for errors
```

### PVC Not Binding

```bash
# Check PVC status
kubectl get pvc

# Check storage class
kubectl get storageclass

# Describe PVC for events
kubectl describe pvc s4-data
```

### Service Not Reachable

```bash
# Check service endpoints
kubectl get endpoints s4

# Test service from pod
kubectl run -it --rm debug --image=alpine --restart=Never -- sh
# Inside pod:
wget -O- http://s4:5000/
```

### Logs

```bash
# All logs
kubectl logs -l app.kubernetes.io/name=s4

# Follow logs
kubectl logs -l app.kubernetes.io/name=s4 -f

# Previous container logs
kubectl logs <pod-name> --previous
```

---

## Security

### Network Policies

```yaml
# network-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: s4-network-policy
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: s4
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: allowed-client
      ports:
        - protocol: TCP
          port: 5000
        - protocol: TCP
          port: 7480
```

### Pod Security

The deployment includes security context:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- Capabilities dropped
- Seccomp profile: RuntimeDefault

---

## Production Recommendations

### Resource Limits

Adjust based on workload:

```yaml
# Helm values
resources:
  requests:
    memory: '1Gi'
    cpu: '500m'
  limits:
    memory: '4Gi'
    cpu: '2000m'
```

### Pod Disruption Budget

```yaml
# pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: s4
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: s4
```

### Monitoring

See [Monitoring Guide](../operations/monitoring.md) for:

- Prometheus metrics
- Grafana dashboards
- Alerting rules

---

## Related Documentation

- [Helm Chart README](../../charts/s4/README.md) - Complete Helm values reference
- [Configuration Guide](./configuration.md) - Environment variables
- [OpenShift Deployment](./openshift.md) - OpenShift-specific deployment
- [Production Readiness](./production-readiness.md) - Production checklist
- [Monitoring](../operations/monitoring.md) - Monitoring setup
- [Troubleshooting](../operations/troubleshooting.md) - Common issues
