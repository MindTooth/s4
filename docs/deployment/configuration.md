# Configuration Guide

Complete reference for S4 environment variables and configuration options.

## Overview

S4 is configured entirely through environment variables. Configuration can be provided via:

- Container environment variables (`-e` flag)
- Environment files (`--env-file`)
- Kubernetes ConfigMaps and Secrets
- OpenShift ConfigMaps and Secrets

## Complete Environment Variables Reference

### S3 Configuration

| Variable                | Default                 | Required | Description                                   |
| ----------------------- | ----------------------- | -------- | --------------------------------------------- |
| `AWS_S3_ENDPOINT`       | `http://localhost:7480` | No       | S3 endpoint URL (internal RGW or external S3) |
| `AWS_ACCESS_KEY_ID`     | `s4admin`               | No       | S3 access key ID                              |
| `AWS_SECRET_ACCESS_KEY` | `s4secret`              | No       | S3 secret access key                          |
| `AWS_DEFAULT_REGION`    | `us-east-1`             | No       | AWS region for S3 operations                  |
| `AWS_S3_BUCKET`         | (none)                  | No       | Default S3 bucket (if needed)                 |

#### S3 Endpoint Examples

```bash
# Internal Ceph RGW (default)
AWS_S3_ENDPOINT=http://localhost:7480

# AWS S3
AWS_S3_ENDPOINT=https://s3.amazonaws.com

# MinIO
AWS_S3_ENDPOINT=https://minio.example.com

# Ceph RGW (external)
AWS_S3_ENDPOINT=https://rgw.example.com
```

### Authentication Configuration

| Variable                 | Default          | Required | Description                                                            |
| ------------------------ | ---------------- | -------- | ---------------------------------------------------------------------- |
| `UI_USERNAME`            | (none)           | No       | Web UI username (enables auth when both username and password are set) |
| `UI_PASSWORD`            | (none)           | No       | Web UI password (enables auth when both username and password are set) |
| `JWT_SECRET`             | (auto-generated) | No       | JWT signing secret (auto-generated if not provided)                    |
| `JWT_EXPIRATION_HOURS`   | `8`              | No       | JWT token expiration time in hours                                     |
| `SSE_TICKET_TTL_SECONDS` | `60`             | No       | Server-Sent Events one-time ticket TTL in seconds                      |
| `NOTIFICATION_STORE_PATH`| `/var/lib/ceph/radosgw/db/notifications.json` | No | Path to JSON file storing notification configs |
| `BUCKET_DATA_PATH`       | `/var/lib/ceph/radosgw/buckets` | No | Path to Ceph POSIX backend bucket data directory |

#### Authentication Modes

**Disabled (Default)**:

- `UI_USERNAME` and `UI_PASSWORD` not set
- No authentication required
- Suitable for development and trusted environments

**Enabled**:

- Both `UI_USERNAME` and `UI_PASSWORD` must be set
- JWT-based authentication required
- Suitable for production deployments

```bash
# Enable authentication
UI_USERNAME=admin
UI_PASSWORD=your-secure-password
JWT_SECRET=your-random-secret-key  # Optional but recommended for production
```

**Important**: For multi-replica Kubernetes deployments, `JWT_SECRET` **must** be set to a shared secret to ensure tokens are valid across all replicas.

### Application Configuration

| Variable                   | Default      | Required | Description                                       |
| -------------------------- | ------------ | -------- | ------------------------------------------------- |
| `PORT`                     | `5000`       | No       | Web UI and API server port                        |
| `NODE_ENV`                 | `production` | No       | Node.js environment (`development`, `production`) |
| `LOCAL_STORAGE_PATHS`      | (disabled)   | No       | Local storage paths (comma-separated)             |
| `MAX_FILE_SIZE_GB`         | `20`         | No       | Maximum upload file size in GB                    |
| `MAX_CONCURRENT_TRANSFERS` | `2`          | No       | Maximum concurrent file transfers                 |

#### Local Storage Configuration

S4 can browse and transfer files between local volumes and S3 buckets. To enable this, you must **both** mount volume(s) into the container **and** set `LOCAL_STORAGE_PATHS` to the container-side paths you want exposed in the UI. Without `LOCAL_STORAGE_PATHS`, any mounted volumes are not visible in the web interface.

```bash
# Single path
LOCAL_STORAGE_PATHS=/opt/app-root/src/data

# Multiple paths (comma-separated)
LOCAL_STORAGE_PATHS=/data/models,/data/datasets,/data/artifacts
```

**Docker/Podman example:**

```bash
podman run -d \
  --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -v s4-data:/var/lib/ceph/radosgw \
  -v /host/models:/models \
  -v /host/datasets:/datasets \
  -e LOCAL_STORAGE_PATHS=/models,/datasets \
  quay.io/rh-aiservices-bu/s4:latest
```

**Kubernetes (Helm) example:**

```yaml
storage:
  localPaths: '/models,/datasets'
  localStorage:
    size: 50Gi
```

See [Docker Deployment → Local Filesystem Browsing](./docker.md#local-filesystem-browsing) for more container examples.

### HuggingFace Configuration

| Variable   | Default | Required | Description                             |
| ---------- | ------- | -------- | --------------------------------------- |
| `HF_TOKEN` | (none)  | No       | HuggingFace API token for model imports |

```bash
# HuggingFace token for private model access
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
```

### Proxy Configuration

| Variable      | Default | Required | Description                                            |
| ------------- | ------- | -------- | ------------------------------------------------------ |
| `HTTP_PROXY`  | (none)  | No       | HTTP proxy URL                                         |
| `HTTPS_PROXY` | (none)  | No       | HTTPS proxy URL                                        |
| `NO_PROXY`    | (none)  | No       | Comma-separated list of hosts to exclude from proxying |

```bash
# Corporate proxy configuration
HTTP_PROXY=http://proxy.corp.example.com:8080
HTTPS_PROXY=http://proxy.corp.example.com:8080
NO_PROXY=localhost,127.0.0.1,.cluster.local
```

### CORS Configuration

| Variable          | Default                                                       | Required | Description                                  |
| ----------------- | ------------------------------------------------------------- | -------- | -------------------------------------------- |
| `ALLOWED_ORIGINS` | `localhost:8888,localhost:9000,127.0.0.1:8888,127.0.0.1:9000` | No       | Comma-separated list of allowed CORS origins |

```bash
# Production CORS configuration
ALLOWED_ORIGINS=https://s4.example.com,https://app.example.com
```

### Security Configuration

| Variable               | Default | Required | Description                                                                 |
| ---------------------- | ------- | -------- | --------------------------------------------------------------------------- |
| `COOKIE_REQUIRE_HTTPS` | `true`  | No       | Require HTTPS for secure cookies (set to `false` for HTTP-only deployments) |

**Cookie Security**:

```bash
# Default (HTTPS required) - Production with TLS
COOKIE_REQUIRE_HTTPS=true  # or unset

# HTTP mode - Internal networks, air-gapped environments
COOKIE_REQUIRE_HTTPS=false
```

**Security Impact**:

- `true` (default): Cookies marked `Secure`, only transmitted over HTTPS. Recommended for production.
- `false`: Cookies without `Secure` flag, work over HTTP. Use only for trusted internal networks.

### Pagination Configuration

| Variable             | Default | Required | Description                                        |
| -------------------- | ------- | -------- | -------------------------------------------------- |
| `MAX_FILES_PER_PAGE` | `100`   | No       | Maximum files returned per page in list operations |

**Usage**:

```bash
# Large deployments - increase page size
MAX_FILES_PER_PAGE=200

# Low-memory environments - reduce page size
MAX_FILES_PER_PAGE=50
```

### Rate Limiting

S4 implements in-memory rate limiting for abuse prevention. **Rate limits are hardcoded** and cannot be configured via environment variables.

**Current Rate Limits** (per IP address):

- **Login attempts**: 5 per minute
- **SSE ticket generation**: 20 per minute
- **Object contains search**: 5 per minute
- **Local file uploads**: 20 per minute

**Implementation Details**:

- Rate limit state stored in-memory (Map)
- Resets on container/pod restart
- Cleanup runs every 60 seconds
- Returns HTTP 429 (Too Many Requests) when exceeded

**Production Considerations**:

- In-memory storage is suitable for S4's single-replica deployment model
- Rate limits reset on container restart

**Customization**:

To modify rate limits, edit constants in source files:

- **Login & SSE tickets**: `/backend/src/routes/api/auth/index.ts` (lines ~61-62, ~209-210)
- **Contains search**: `/backend/src/routes/api/objects/index.ts` (line ~99)
- **Local uploads**: `/backend/src/routes/api/local/index.ts` (line ~74)

After modifying, rebuild the container: `make build`

## Configuration Examples

### Development Environment

```bash
# .env
NODE_ENV=development
PORT=5000
AWS_S3_ENDPOINT=http://localhost:7480
AWS_ACCESS_KEY_ID=s4admin
AWS_SECRET_ACCESS_KEY=s4secret
AWS_DEFAULT_REGION=us-east-1
LOCAL_STORAGE_PATHS=/opt/app-root/src/data
MAX_FILE_SIZE_GB=10
MAX_CONCURRENT_TRANSFERS=2
```

### Production Environment (Internal S3)

```bash
# .env.production
NODE_ENV=production
PORT=5000

# S3 Configuration (internal RGW)
AWS_S3_ENDPOINT=http://localhost:7480
AWS_ACCESS_KEY_ID=prod-s3-key
AWS_SECRET_ACCESS_KEY=prod-s3-secret
AWS_DEFAULT_REGION=us-east-1

# Authentication (required for production)
UI_USERNAME=admin
UI_PASSWORD=strong-random-password
JWT_SECRET=random-secret-key-min-32-chars

# Application Settings
LOCAL_STORAGE_PATHS=/opt/app-root/src/data
MAX_FILE_SIZE_GB=50
MAX_CONCURRENT_TRANSFERS=5

# Security
JWT_EXPIRATION_HOURS=8
SSE_TICKET_TTL_SECONDS=60

# CORS
ALLOWED_ORIGINS=https://s4.example.com
```

### Production Environment (External S3)

```bash
# .env.production
NODE_ENV=production
PORT=5000

# S3 Configuration (AWS S3)
AWS_S3_ENDPOINT=https://s3.amazonaws.com
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-west-2

# Authentication
UI_USERNAME=admin
UI_PASSWORD=strong-random-password
JWT_SECRET=random-secret-key-min-32-chars

# Application Settings
LOCAL_STORAGE_PATHS=/data/shared
MAX_FILE_SIZE_GB=100
MAX_CONCURRENT_TRANSFERS=10

# Proxy (if needed)
HTTPS_PROXY=http://proxy.corp.example.com:8080
NO_PROXY=localhost,127.0.0.1
```

### Enterprise Environment with Proxy

```bash
# .env.enterprise
NODE_ENV=production
PORT=5000

# S3 Configuration (Ceph RGW)
AWS_S3_ENDPOINT=https://rgw.corp.example.com
AWS_ACCESS_KEY_ID=enterprise-key
AWS_SECRET_ACCESS_KEY=enterprise-secret
AWS_DEFAULT_REGION=us-east-1

# Authentication
UI_USERNAME=admin
UI_PASSWORD=enterprise-password
JWT_SECRET=enterprise-jwt-secret-min-32-chars

# Proxy Configuration
HTTP_PROXY=http://proxy.corp.example.com:8080
HTTPS_PROXY=http://proxy.corp.example.com:8080
NO_PROXY=localhost,127.0.0.1,.corp.example.com,.svc.cluster.local

# HuggingFace
HF_TOKEN=hf_enterprise_token

# Application Settings
LOCAL_STORAGE_PATHS=/data/models,/data/datasets
MAX_FILE_SIZE_GB=100
MAX_CONCURRENT_TRANSFERS=5

# Security
JWT_EXPIRATION_HOURS=4
SSE_TICKET_TTL_SECONDS=30

# CORS
ALLOWED_ORIGINS=https://s4.corp.example.com,https://ai.corp.example.com
```

## Container Deployment Configuration

### Docker/Podman

```bash
# Using environment variables
podman run -d \
  --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -e AWS_ACCESS_KEY_ID=myadmin \
  -e AWS_SECRET_ACCESS_KEY=mysecret \
  -e UI_USERNAME=admin \
  -e UI_PASSWORD=pass \
  -e JWT_SECRET=your-secret-key \
  -e MAX_FILE_SIZE_GB=20 \
  -v s4-data:/var/lib/ceph/radosgw \
  quay.io/rh-aiservices-bu/s4:latest

# Using environment file
podman run -d \
  --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  --env-file .env.production \
  -v s4-data:/var/lib/ceph/radosgw \
  quay.io/rh-aiservices-bu/s4:latest
```

### Docker Compose

```yaml
version: '3.8'
services:
  s4:
    image: quay.io/rh-aiservices-bu/s4:latest
    ports:
      - '5000:5000'
      - '7480:7480'
    environment:
      AWS_ACCESS_KEY_ID: myadmin
      AWS_SECRET_ACCESS_KEY: mysecret
      UI_USERNAME: admin
      UI_PASSWORD: pass
      JWT_SECRET: your-secret-key
      MAX_FILE_SIZE_GB: '20'
    volumes:
      - s4-data:/var/lib/ceph/radosgw
    restart: unless-stopped

volumes:
  s4-data:
```

## Helm Configuration

When using Helm, configuration is managed through `values.yaml`:

### S3 and Authentication

```yaml
# values.yaml
s3:
  endpoint: 'http://localhost:7480'
  region: 'us-east-1'
  accessKeyId: 'your-access-key'
  secretAccessKey: 'your-secret-key'
  # Or use existing secret:
  # existingSecret: "my-s3-credentials"

auth:
  enabled: true
  username: 'admin'
  password: 'your-secure-password'
  jwtSecret: 'your-jwt-secret-min-32-chars'
  jwtExpirationHours: 8
  cookieRequireHttps: true
```

### Storage Configuration

```yaml
storage:
  # Local filesystem browsing (optional)
  # Set localPaths to enable; omit or leave empty to disable
  localPaths: '/opt/app-root/src/data'
  maxFileSizeGB: 20
  maxConcurrentTransfers: 2
  data:
    size: 10Gi # S3 data PVC (required)
    storageClass: ''
    existingClaim: ''
  localStorage:
    size: 50Gi # Local storage PVC (only created when localPaths is set)
    storageClass: ''
    existingClaim: ''
```

### Server and Resources

```yaml
server:
  port: 5000
  ip: '0.0.0.0'

resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 2Gi
```

### Using Values File

```bash
# Deploy with custom values
helm install s4 ./charts/s4 -n s4 --create-namespace -f values.yaml

# Override specific values (auth credentials required by default)
helm install s4 ./charts/s4 -n s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password
```

See the [Helm chart README](../../charts/s4/README.md) for complete values documentation.

---

## Kubernetes Configuration

### ConfigMap (Non-Sensitive Configuration)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: s4-config
data:
  AWS_DEFAULT_REGION: 'us-east-1'
  AWS_S3_ENDPOINT: 'http://localhost:7480'
  PORT: '5000'
  MAX_FILE_SIZE_GB: '20'
  MAX_CONCURRENT_TRANSFERS: '2'
  LOCAL_STORAGE_PATHS: '/opt/app-root/src/data'
  JWT_EXPIRATION_HOURS: '8'
  SSE_TICKET_TTL_SECONDS: '60'
```

### Secret (Sensitive Configuration)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: s4-credentials
type: Opaque
stringData:
  AWS_ACCESS_KEY_ID: 's4admin'
  AWS_SECRET_ACCESS_KEY: 's4secret'
  UI_USERNAME: 'admin'
  UI_PASSWORD: 'your-secure-password'
  JWT_SECRET: 'your-random-secret-key'
```

### Deployment with Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: s4
spec:
  template:
    spec:
      containers:
        - name: s4
          image: quay.io/rh-aiservices-bu/s4:latest
          envFrom:
            - configMapRef:
                name: s4-config
            - secretRef:
                name: s4-credentials
```

## Runtime Configuration Updates

Some configuration can be updated at runtime via the Settings UI or API:

### Via Web UI

1. Navigate to Settings page
2. Update S3 configuration
3. Click "Save Configuration"

**Note**: Configuration updates are **ephemeral** (not persisted to disk). They reset when the container/pod restarts.

### Via API

```bash
# Update S3 configuration
curl -X PUT http://localhost:5000/api/settings/s3 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "endpoint": "https://s3.amazonaws.com",
    "accessKeyId": "new-key",
    "secretAccessKey": "new-secret",
    "region": "us-west-2"
  }'
```

## Security Best Practices

### Credential Management

- ✅ **Never hardcode credentials** in manifests or code
- ✅ **Use Kubernetes Secrets** for sensitive data
- ✅ **Use strong, random passwords** (minimum 16 characters)
- ✅ **Generate JWT secrets** with sufficient entropy (32+ characters)
- ✅ **Rotate credentials regularly** (quarterly or as required)
- ✅ **Use external secret management** (Vault, AWS Secrets Manager) in production

### Generating Secure Secrets

```bash
# Generate random password (16 characters)
openssl rand -base64 16

# Generate JWT secret (32 characters)
openssl rand -base64 32

# Generate hex secret (64 characters)
openssl rand -hex 32
```

### Multi-Replica Deployments

S4 is designed for single-replica deployment. If deploying multiple replicas:

1. **JWT_SECRET** must be set to a shared secret
2. All replicas must use the same Secret

```yaml
# Shared JWT secret for multi-replica
apiVersion: v1
kind: Secret
metadata:
  name: s4-credentials
stringData:
  JWT_SECRET: 'shared-secret-across-all-replicas'
```

## Environment Variable Precedence

Configuration is loaded in this order (later overrides earlier):

1. **Default values** (hardcoded in application)
2. **Environment variables**
3. **Runtime updates** (via API/UI, ephemeral)

## Configuration Validation

S4 validates configuration on startup:

- Required environment variables present
- S3 endpoint reachable (warning if not)
- Storage paths writable
- Port availability

Check startup logs for validation warnings:

```bash
# Docker/Podman
podman logs s4 | grep -i warning

# Kubernetes
kubectl logs -l app=s4 | grep -i warning
```

## Troubleshooting Configuration

### Configuration Not Applied

```bash
# Verify environment variables
# Docker/Podman
podman exec s4 env | grep AWS

# Kubernetes
kubectl exec -it <s4-pod> -- env | grep AWS
```

### S3 Connection Failed

```bash
# Test S3 endpoint
curl -v $AWS_S3_ENDPOINT

# Check credentials
aws s3 ls --endpoint-url $AWS_S3_ENDPOINT \
  --access-key $AWS_ACCESS_KEY_ID \
  --secret-key $AWS_SECRET_ACCESS_KEY
```

### Authentication Not Working

```bash
# Verify auth is enabled
curl http://localhost:5000/api/auth/info

# Expected response when auth enabled:
# {"authMode":"simple","authRequired":true}

# Check JWT secret is set
kubectl get secret s4-credentials -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

## Related Documentation

- [Docker Deployment](./docker.md) - Container deployment guide
- [Kubernetes Deployment](./kubernetes.md) - Kubernetes deployment guide
- [Production Readiness](./production-readiness.md) - Production checklist
- [Security Best Practices](../security/best-practices.md) - Security recommendations
