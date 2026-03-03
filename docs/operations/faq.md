# Frequently Asked Questions

Common questions about S4.

## General Questions

### What is S4?

S4 (Super Simple Storage Service) is a lightweight, self-contained S3-compatible storage solution with a web-based management UI. It combines Ceph RGW with SQLite backend and a Node.js/React web interface for managing S3 buckets and objects.

### What is S4 used for?

S4 is designed for:

- **Development and testing** - Local S3-compatible storage for development
- **POCs and demos** - Quick S3 storage for demonstrations
- **Simple deployments** - Lightweight alternative to full-scale object storage
- **Model storage** - Storing ML models and datasets
- **File transfers** - Moving files between S3 and local storage

### Is S4 production-ready?

S4 is production-ready for single-instance deployments with some limitations:

- ✅ Security hardening complete
- ✅ Type safety and error handling
- ✅ Input validation and sanitization
- ⚠️ Single admin user (no RBAC)
- ⚠️ In-memory rate limiting (resets on restart)
- ⚠️ Ephemeral configuration (not persisted)

See [Production Readiness Guide](../deployment/production-readiness.md) for details.

### What S3 operations does S4 support?

S4 supports core S3 operations:

- **Buckets**: Create, list, delete
- **Objects**: Upload, download, list, delete
- **Folders**: Create, navigate (prefix-based)
- **Transfers**: Copy between S3 and local storage
- **HuggingFace**: Import models directly from HuggingFace

### Does S4 replace MinIO or Ceph?

No. S4 is a lightweight solution for specific use cases. For production object storage with features like versioning, lifecycle policies, replication, and multi-tenancy, use MinIO or full Ceph deployment.

## Deployment Questions

### How do I deploy S4?

Three deployment options:

1. **Container** (Docker/Podman) - See [Docker Deployment](../deployment/docker.md)
2. **Kubernetes** - See [Kubernetes Deployment](../deployment/kubernetes.md)
3. **OpenShift** - See [OpenShift Deployment](../deployment/openshift.md)

Quick start:

```bash
podman run -d --name s4 -p 5000:5000 -p 7480:7480 \
  -v s4-data:/var/lib/ceph/radosgw \
  quay.io/rh-aiservices-bu/s4:latest
```

### What ports does S4 use?

- **5000** - Web UI (HTTP)
- **7480** - S3 API (HTTP)

### Do I need to configure S3 credentials?

Default credentials are provided:

- **Access Key**: `s4admin`
- **Secret Key**: `s4secret`

For production, set custom credentials:

```bash
-e AWS_ACCESS_KEY_ID=your-key \
-e AWS_SECRET_ACCESS_KEY=your-secret
```

### Can I use external S3 instead of internal RGW?

Yes! Set the S3 endpoint to point to external S3:

```bash
-e AWS_S3_ENDPOINT=https://s3.amazonaws.com \
-e AWS_ACCESS_KEY_ID=your-aws-key \
-e AWS_SECRET_ACCESS_KEY=your-aws-secret
```

S4 will use the external S3 service instead of internal RGW.

### How do I enable authentication?

Set both `UI_USERNAME` and `UI_PASSWORD`:

```bash
-e UI_USERNAME=admin \
-e UI_PASSWORD=your-secure-password
```

When both are set, JWT authentication is required.

## Configuration Questions

### How do I change the maximum file upload size?

Set `MAX_FILE_SIZE_GB` environment variable:

```bash
-e MAX_FILE_SIZE_GB=50
```

Default is 20GB.

### Can I configure multiple local storage paths?

Yes! Provide comma-separated paths:

```bash
-e LOCAL_STORAGE_PATHS=/data/models,/data/datasets,/data/artifacts
```

### How do I configure proxy settings?

Set HTTP_PROXY and HTTPS_PROXY:

```bash
-e HTTP_PROXY=http://proxy.example.com:8080 \
-e HTTPS_PROXY=http://proxy.example.com:8080 \
-e NO_PROXY=localhost,127.0.0.1
```

### How long do JWT tokens last?

Default: 8 hours. Configure with:

```bash
-e JWT_EXPIRATION_HOURS=4
```

### Where is data stored?

Two persistent volumes:

1. **S3 Data**: `/var/lib/ceph/radosgw` - S3 bucket metadata and objects
2. **Local Storage**: `/opt/app-root/src/data` - Local filesystem storage

## Operational Questions

### How do I view logs?

**Container**:

```bash
podman logs s4 -f
```

**Kubernetes**:

```bash
kubectl logs -l app=s4 -f
```

### How do I backup S4 data?

**Container** (named volumes):

```bash
podman stop s4
podman run --rm -v s4-data:/source -v $(pwd):/backup \
  alpine tar czf /backup/s4-backup.tar.gz -C /source .
podman start s4
```

**Kubernetes** (Velero):

```bash
velero backup create s4-backup --include-namespaces s4
```

### How do I upgrade S4?

**Container**:

```bash
podman pull quay.io/rh-aiservices-bu/s4:latest
podman stop s4
podman rm s4
podman run -d --name s4 ... quay.io/rh-aiservices-bu/s4:latest
```

**Kubernetes**:

```bash
kubectl set image deployment/s4 s4=quay.io/rh-aiservices-bu/s4:v1.1.0
kubectl rollout status deployment/s4
```

### Can I run multiple replicas?

S4 is designed for single-replica deployment:

- **Single replica**: Fully supported (recommended)
- **Multiple replicas**: Not recommended. Would require:
  - Shared JWT_SECRET
  - External S3 or ReadWriteMany storage

For single-replica deployment, JWT secret can be set for consistency across restarts:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: s4-credentials
stringData:
  JWT_SECRET: 'shared-secret-for-all-replicas'
```

### How do I reset the admin password?

**Container**:

```bash
podman stop s4
podman rm s4
podman run -d --name s4 -e UI_PASSWORD=new-password ...
```

**Kubernetes**:

```bash
kubectl delete secret s4-credentials
kubectl create secret generic s4-credentials \
  --from-literal=UI_USERNAME=admin \
  --from-literal=UI_PASSWORD=new-password
kubectl rollout restart deployment/s4
```

## Feature Questions

### Does S4 support S3 versioning?

No. S4 uses Ceph RGW with SQLite backend which doesn't support S3 versioning.

### Does S4 support S3 lifecycle policies?

No. Lifecycle policies are not supported.

### Can I use S4 with multiple users?

No. S4 currently supports a single admin user. Multi-user support and RBAC are planned for future releases.

### Does S4 support bucket policies?

No. S4 doesn't support S3 bucket policies.

### Can I import private HuggingFace models?

Yes! Set your HuggingFace token:

```bash
-e HF_TOKEN=hf_your_token
```

Then use the HuggingFace import feature in the UI.

### Does S4 support encryption?

- **At rest**: Use encrypted storage class (Kubernetes) or encrypted volumes (container)
- **In transit**: Deploy behind HTTPS reverse proxy/ingress
- **S3 SSE**: Not currently supported

### Does S4 support bucket notifications?

Yes. S4 supports webhook-based bucket notifications. You can configure one or more HTTP/HTTPS webhook endpoints per bucket, and S4 will send POST requests with S3-compatible event payloads when objects are created, modified, or deleted. Notifications can be configured via the web UI (notification bell icon on each bucket) or via the [Notifications API](../api/notifications.md).

### What webhook payload format does S4 use?

S4 sends a simplified AWS S3 notification format:

```json
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "eventName": "s3:ObjectCreated:Put",
      "eventTime": "2024-02-19T10:30:45.123Z",
      "s3": {
        "bucket": { "name": "my-bucket" },
        "object": { "key": "path/to/file.txt", "size": 1024 }
      }
    }
  ]
}
```

This is a subset of the full AWS S3 notification format, containing the most commonly used fields.

### Are notification webhooks retried if they fail?

No. S4 uses fire-and-forget delivery with a 5-second timeout. If a webhook endpoint is unreachable or returns an error, the notification is not retried. Failed deliveries are logged as warnings in S4's server logs.

### Can I filter which events trigger notifications?

Yes. Each notification configuration supports two types of filters:

- **Event type selection** - Choose `s3:ObjectCreated:*` (object created/modified), `s3:ObjectRemoved:*` (object deleted), or both
- **Prefix filter** - Only trigger for object keys starting with a specified string (e.g., `uploads/`)
- **Suffix filter** - Only trigger for object keys ending with a specified string (e.g., `.json`)

When both prefix and suffix filters are set, an object must match both to trigger the notification.

## Troubleshooting Questions

### S4 container won't start

Check:

1. Ports not already in use: `lsof -i :5000`
2. Sufficient resources: 2GB RAM minimum
3. Volume permissions (rootless podman)
4. Container logs: `podman logs s4`

See [Troubleshooting Guide](./troubleshooting.md) for details.

### Cannot log in

Check:

1. Authentication is enabled: `curl http://localhost:5000/api/auth/info`
2. Credentials are correct
3. JWT_SECRET is set (multi-replica)
4. Browser is not blocking cookies

### Buckets not loading

Check:

1. S3 endpoint is reachable: `curl http://localhost:7480/`
2. S3 credentials are correct
3. RGW is running: `podman exec s4 ps aux | grep radosgw`
4. Backend logs: `kubectl logs <s4-pod>`

### Upload fails

Check:

1. File size within limit (MAX_FILE_SIZE_GB)
2. Disk space available
3. Network timeout settings
4. Backend logs for errors

## Performance Questions

### How many objects can S4 handle?

S4 uses SQLite backend which works well for:

- **Buckets**: Hundreds
- **Objects**: Thousands to tens of thousands per bucket

For millions of objects, use full Ceph or MinIO deployment.

### What is the maximum file size?

Default: 20GB (configurable via `MAX_FILE_SIZE_GB`)

Theoretical maximum: Limited by available disk space and memory.

### How many concurrent transfers are supported?

Default: 2 concurrent transfers (configurable via `MAX_CONCURRENT_TRANSFERS`)

Increase based on available resources:

```bash
-e MAX_CONCURRENT_TRANSFERS=5
```

### Can I improve S4 performance?

Yes:

1. **Use SSD storage** for PVCs
2. **Increase CPU/memory limits**
3. **Reduce concurrent transfers** if memory-limited
4. **Use external S3** for better scalability

## Security Questions

### Is S4 secure?

S4 implements security best practices:

- JWT-based authentication
- Input validation
- Header sanitization
- Credential masking in logs
- Regular dependency audits

For production, also:

- Enable authentication
- Deploy behind HTTPS
- Use strong credentials
- Regular security scanning

See [Security Best Practices](../security/best-practices.md).

### Should I use S4 in production?

S4 is suitable for production with considerations:

- ✅ Single-instance deployments
- ✅ Internal/trusted networks
- ✅ Small to medium datasets
- ⚠️ Limited audit logging
- ⚠️ Single admin user
- ⚠️ No RBAC

For enterprise production, review [Production Readiness](../deployment/production-readiness.md).

### How do I report security vulnerabilities?

Report privately via:

- GitHub Security Advisories
- Email to maintainers

DO NOT open public GitHub issues for security vulnerabilities.

See [Security Policy](../security/README.md).

## Integration Questions

### Can I use S4 with OpenShift AI?

Yes! Create a Data Connection in OpenShift AI:

- **Endpoint**: `http://s4.s4.svc.cluster.local:7480`
- **Access Key**: Your S3 access key
- **Secret Key**: Your S3 secret key
- **Region**: `us-east-1`

See [OpenShift Deployment Guide](../deployment/openshift.md#integration-with-openshift-ai--rhoai).

### Can I use AWS CLI with S4?

Yes!

```bash
export AWS_ACCESS_KEY_ID=s4admin
export AWS_SECRET_ACCESS_KEY=s4secret
export AWS_ENDPOINT_URL=http://localhost:7480

aws s3 ls
aws s3 mb s3://my-bucket
aws s3 cp file.txt s3://my-bucket/
```

### Can I use S3 SDKs with S4?

Yes! S4 is S3-compatible. Use any S3 SDK:

**Python (boto3)**:

```python
import boto3

s3 = boto3.client('s3',
    endpoint_url='http://localhost:7480',
    aws_access_key_id='s4admin',
    aws_secret_access_key='s4secret'
)

s3.list_buckets()
```

**JavaScript**:

```javascript
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:7480',
  credentials: {
    accessKeyId: 's4admin',
    secretAccessKey: 's4secret',
  },
  region: 'us-east-1',
  forcePathStyle: true,
});

await s3.send(new ListBucketsCommand({}));
```

## Development Questions

### How do I contribute to S4?

1. Fork the repository
2. Create feature branch
3. Make changes and add tests
4. Follow [Code Style Guide](../development/code-style.md)
5. Create pull request

See [Contributing Guide](../development/contributing.md).

### How do I run S4 for development?

```bash
# Clone repository
git clone https://github.com/rh-aiservices-bu/s4.git
cd s4

# Install dependencies
npm install

# Start dev servers
npm run dev

# Backend: http://localhost:8888
# Frontend: http://localhost:9000
```

See [Development Guide](../development/README.md).

### How do I build S4 from source?

```bash
# Build container image
make build

# Run locally
make run

# Access at http://localhost:5000
```

## License Questions

### What license is S4 released under?

Apache 2.0 License

### Can I use S4 commercially?

Yes! Apache 2.0 allows commercial use.

### Can I modify S4?

Yes! Apache 2.0 allows modifications. Contributions back to the project are welcome.

## Related Documentation

- [Getting Started](../getting-started/README.md) - Quick start guide
- [Deployment Guides](../deployment/README.md) - Deployment options
- [Troubleshooting](./troubleshooting.md) - Common issues
- [Security](../security/README.md) - Security policy
