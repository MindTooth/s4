# Security Best Practices

Security recommendations for deploying and operating S4.

## Overview

This guide provides security best practices for S4 deployments across different environments.

## Deployment Security

### 1. Authentication

**Always Enable Authentication in Production**

```bash
# ✅ GOOD - Authentication enabled
UI_USERNAME=admin
UI_PASSWORD=strong-random-password-16chars
JWT_SECRET=random-secret-key-min-32-characters

# ❌ BAD - No authentication
# (UI_USERNAME and UI_PASSWORD not set)
```

**Password Requirements**:

- Minimum 16 characters
- Mix of uppercase, lowercase, numbers, symbols
- Randomly generated (use password manager)
- Unique (not reused from other systems)

**Generate Secure Passwords**:

```bash
# Generate random password (16 characters)
openssl rand -base64 16

# Generate random password (32 characters)
openssl rand -base64 32

# Generate alphanumeric password
< /dev/urandom tr -dc 'A-Za-z0-9' | head -c 16
```

### 2. JWT Secrets

**Use Strong, Random JWT Secrets**

```bash
# Generate secure JWT secret
openssl rand -base64 32

# Or hex format
openssl rand -hex 32
```

**Multi-Replica Deployments**:

- JWT_SECRET **MUST** be shared across all replicas
- Store in Kubernetes Secret
- Never auto-generate in multi-replica setup

```yaml
# kubernetes/s4-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: s4-credentials
stringData:
  JWT_SECRET: 'shared-secret-for-all-replicas-min-32-chars'
```

### 3. HTTPS/TLS

**Always Use HTTPS in Production**

**Container Deployment**:

```
User → HTTPS → Nginx/Traefik → HTTP → S4 Container
```

**Nginx Configuration**:

```nginx
server {
    listen 443 ssl http2;
    server_name s4.example.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Kubernetes/OpenShift**:

```yaml
# Use Ingress with TLS
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: s4
  annotations:
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

### 4. Network Security

**Restrict Network Access**

**Firewall Rules** (Container):

```bash
# Allow only necessary ports
firewall-cmd --add-port=443/tcp --permanent  # HTTPS
firewall-cmd --reload

# Block direct access to S4 ports
# Only allow via reverse proxy
```

**Kubernetes Network Policies**:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: s4-network-policy
spec:
  podSelector:
    matchLabels:
      app: s4
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow from ingress controller only
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 5000
  egress:
    # Allow DNS
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
    # Allow S3 (if external)
    - to:
        - podSelector: {}
      ports:
        - protocol: TCP
          port: 443
```

### 5. Secrets Management

**Use External Secrets Manager**

**HashiCorp Vault**:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: s4-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault
    kind: SecretStore
  target:
    name: s4-credentials
  data:
    - secretKey: AWS_ACCESS_KEY_ID
      remoteRef:
        key: s4/credentials
        property: aws_access_key_id
    - secretKey: AWS_SECRET_ACCESS_KEY
      remoteRef:
        key: s4/credentials
        property: aws_secret_access_key
    - secretKey: UI_PASSWORD
      remoteRef:
        key: s4/credentials
        property: ui_password
```

**AWS Secrets Manager**:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: s4-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: SecretStore
  target:
    name: s4-credentials
  data:
    - secretKey: JWT_SECRET
      remoteRef:
        key: s4/jwt-secret
```

## Application Security

### 6. CORS Configuration

**Restrict Allowed Origins**

```bash
# ✅ GOOD - Specific origins
ALLOWED_ORIGINS=https://s4.example.com,https://app.example.com

# ❌ BAD - Wildcard (allows any origin)
ALLOWED_ORIGINS=*
```

### 7. Input Validation

S4 validates input by default, but ensure:

- Bucket names follow AWS naming rules
- Object names don't contain path traversal sequences
- File sizes respect `MAX_FILE_SIZE_GB` limit
- Upload counts respect concurrency limits

### 8. Credential Protection

**Never Log Credentials**

S4 automatically sanitizes credentials in logs, but ensure:

```typescript
// ✅ GOOD - Using sanitization utility
import { sanitizeErrorForLogging } from './utils/errorLogging';
logger.error(sanitizeErrorForLogging(error));

// ❌ BAD - Logging raw error
logger.error(error); // May contain AWS credentials
```

**Environment Variables**:

```bash
# ✅ GOOD - Secrets in environment or external manager
AWS_SECRET_ACCESS_KEY=${AWS_SECRET}

# ❌ BAD - Hardcoded in manifests
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

## Container Security

### 9. Image Scanning

**Scan Images Before Deployment**

```bash
# Trivy scan
trivy image --severity HIGH,CRITICAL quay.io/rh-aiservices-bu/s4:latest

# Fail build on critical vulnerabilities
trivy image --exit-code 1 --severity CRITICAL quay.io/rh-aiservices-bu/s4:latest

# Snyk scan
snyk container test quay.io/rh-aiservices-bu/s4:latest
```

### 10. Run as Non-Root

S4 runs as non-root by default:

```yaml
# Deployment already includes
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
```

### 11. Read-Only Root Filesystem

**Consider Read-Only Filesystem**:

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
  # Mount writable paths as volumes
  - name: tmp
    mountPath: /tmp
  - name: logs
    mountPath: /var/log
```

## Kubernetes/OpenShift Security

### 12. Pod Security Standards

**Apply Restricted Pod Security**:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: s4
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### 13. Service Account

**Use Dedicated Service Account**:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s4
  annotations:
    # For AWS IRSA
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/s4-role
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      serviceAccountName: s4
```

### 14. Resource Limits

**Set Resource Limits**:

```yaml
resources:
  requests:
    memory: '512Mi'
    cpu: '250m'
  limits:
    memory: '2Gi'
    cpu: '2000m'
```

**Prevents**:

- Resource exhaustion attacks
- Noisy neighbor issues
- Cluster instability

### 15. Pod Disruption Budget

**Ensure Availability**:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: s4
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: s4
```

## Monitoring and Auditing

### 16. Logging

**Centralize Logs**:

```bash
# Container logs to external system
podman logs s4 | logstash -f /etc/logstash/conf.d/s4.conf

# Kubernetes logs to ELK/Splunk
kubectl logs -l app=s4 -f | fluentd
```

**Log Retention**:

- Minimum 90 days for audit logs
- Consider regulatory requirements (SOC2: 1 year, HIPAA: 6 years)

### 17. Monitoring

**Monitor Security Events**:

```yaml
# Prometheus alerts
- alert: S4HighFailedLoginRate
  expr: rate(s4_failed_logins_total[5m]) > 10
  annotations:
    summary: 'High rate of failed logins'

- alert: S4UnauthorizedAccess
  expr: rate(s4_unauthorized_requests_total[5m]) > 5
  annotations:
    summary: 'High rate of unauthorized access attempts'
```

### 18. Audit Logging

**Enable Kubernetes Audit Logs**:

```yaml
# kube-apiserver audit policy
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: Metadata
    namespaces: ['s4']
    verbs: ['create', 'update', 'patch', 'delete']
```

## Data Security

### 19. Encryption at Rest

**S3 Data**:

- Use encrypted storage class
- Enable S3 server-side encryption (SSE-S3 or SSE-KMS)

**PVCs**:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: encrypted-storage
provisioner: your-csi-driver # Use your cluster's CSI driver
parameters:
  encrypted: 'true' # Provider-specific encryption parameter
```

> **Note**: The `provisioner` and `parameters` depend on your cluster's storage backend (e.g., AWS EBS, Azure Disk, GCP PD, Ceph, etc.). Consult your provider's documentation for the correct values.

### 20. Encryption in Transit

- ✅ HTTPS for web UI
- ✅ TLS for S3 connections (if external)
- ✅ Encrypted connections between pods (consider service mesh)

## Compliance

### 21. Regular Security Assessments

**Schedule**:

- Vulnerability scans: Weekly
- Dependency audits: Before each release
- Penetration testing: Quarterly
- Security reviews: After major changes

**Tools**:

- `npm audit` - Dependency vulnerabilities
- `trivy` - Container image scanning
- `OWASP ZAP` - Web application scanning
- `kube-bench` - Kubernetes security benchmarking

### 22. Security Checklist

**Pre-Deployment**:

- [ ] Authentication enabled
- [ ] Strong passwords and JWT secrets
- [ ] HTTPS/TLS configured
- [ ] Network policies applied
- [ ] Resource limits set
- [ ] Image scanned for vulnerabilities
- [ ] Secrets stored externally
- [ ] Monitoring and alerting configured
- [ ] Backup strategy in place
- [ ] Incident response plan documented

**Post-Deployment**:

- [ ] Verify HTTPS works
- [ ] Test authentication
- [ ] Check logs are aggregated
- [ ] Verify monitoring alerts
- [ ] Test backup/restore
- [ ] Document configuration
- [ ] Train operators
- [ ] Schedule regular reviews

## Incident Response

### 23. Security Incident Plan

**Detection** → **Analysis** → **Containment** → **Eradication** → **Recovery** → **Lessons Learned**

**Detection**:

- Monitor logs for suspicious activity
- Set up alerts for security events
- Regular security scans

**Containment**:

- Isolate affected systems
- Block malicious IPs
- Disable compromised accounts

**Eradication**:

- Remove malware/backdoors
- Patch vulnerabilities
- Reset credentials

**Recovery**:

- Restore from clean backups
- Verify system integrity
- Resume normal operations

**Lessons Learned**:

- Document incident
- Update procedures
- Improve defenses

## Related Documentation

- [Security Policy](./README.md) - Overall security policy
- [Authentication](./authentication.md) - Authentication system details
- [Vulnerability Management](./vulnerability-management.md) - Audit status
- [Configuration Guide](../deployment/configuration.md) - Secure configuration
- [Production Readiness](../deployment/production-readiness.md) - Production checklist
