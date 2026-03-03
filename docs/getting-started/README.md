# Quick Start Guide

Get S4 up and running in 5 minutes.

## What is S4?

S4 (Super Simple Storage Service) is a lightweight, self-contained S3-compatible storage solution with a web-based management UI. It combines:

- **Ceph RGW** with SQLite backend - A lightweight S3 server
- **Storage Management UI** - Web interface for S3 operations

Perfect for POCs, development environments, demos, and simple deployments where a full-scale object storage solution is overkill.

## Features

- ✅ S3-compatible API on port 7480
- ✅ Web UI for storage management on port 5000
- ✅ Bucket management (create, list, delete)
- ✅ Object operations (upload, download, delete, browse)
- ✅ Local filesystem/PVC browsing
- ✅ Cross-storage file transfers (S3 ↔ Local)
- ✅ Bucket notifications via webhooks
- ✅ HuggingFace model import
- ✅ Single container deployment
- ✅ Persistent storage with SQLite
- ✅ Optional JWT-based authentication

## Storage Volumes

S4 requires one persistent volume for the S3 engine. Additional volumes for local filesystem browsing are optional.

### Required Volume

| Volume      | Mount Path              | Purpose                                                                         |
| ----------- | ----------------------- | ------------------------------------------------------------------------------- |
| **s4-data** | `/var/lib/ceph/radosgw` | RGW database and S3 object storage. All S3 buckets and objects are stored here. |

This is the only volume required to run S4. Without it, all S3 data is lost when the container restarts.

### Local Filesystem Browsing (Optional)

S4 can browse and manage files on mounted volumes, enabling transfers between local storage and S3 buckets. This is useful for:

- Importing existing files into S3
- Exporting S3 objects to local storage
- Managing PVC contents in Kubernetes

**How it works:**

1. Mount any volume(s) to the container at paths of your choice
2. Set the `LOCAL_STORAGE_PATHS` environment variable to tell S4 which paths to display

**Example with one local storage path:**

```bash
podman run -d --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -v s4-data:/var/lib/ceph/radosgw \
  -v /home/user/models:/models \
  -e LOCAL_STORAGE_PATHS=/models \
  quay.io/rh-aiservices-bu/s4:latest
```

**Example with multiple local storage paths:**

```bash
podman run -d --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -v s4-data:/var/lib/ceph/radosgw \
  -v /home/user/models:/models \
  -v /home/user/datasets:/datasets \
  -e LOCAL_STORAGE_PATHS=/models,/datasets \
  quay.io/rh-aiservices-bu/s4:latest
```

> **Note**: If `LOCAL_STORAGE_PATHS` is not set, local filesystem browsing is disabled (S3-only mode). If you don't need local filesystem browsing, you can ignore this entirely.

---

## Run S4

### Option 1: Local (Docker/Podman)

**Basic deployment**:

```bash
podman run -d --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -v s4-data:/var/lib/ceph/radosgw \
  quay.io/rh-aiservices-bu/s4:latest
```

> **Tip**: To add local filesystem browsing, see the [Local Filesystem Browsing](#local-filesystem-browsing-optional) section above.

**With UI authentication**:

```bash
podman run -d --name s4 \
  -p 5000:5000 \
  -p 7480:7480 \
  -e UI_USERNAME=admin \
  -e UI_PASSWORD=your-secure-password \
  -v s4-data:/var/lib/ceph/radosgw \
  quay.io/rh-aiservices-bu/s4:latest
```

Access the web UI at http://localhost:5000

### Option 2: OpenShift/Kubernetes

> **Note:** Authentication is enabled by default. You must provide credentials with `--set auth.username=... --set auth.password=...` or disable auth with `--set auth.enabled=false`.

First, clone the repository:

```bash
git clone https://github.com/rh-aiservices-bu/s4.git
cd s4
```

**OpenShift** (with Route):

```bash
helm install s4 ./charts/s4 \
  --namespace s4 --create-namespace \
  --set route.enabled=true \
  --set auth.username=admin \
  --set auth.password=your-secure-password
```

**Kubernetes**:

```bash
helm install s4 ./charts/s4 \
  --namespace s4 --create-namespace \
  --set auth.username=admin \
  --set auth.password=your-secure-password
```

**Access the deployment**:

```bash
# OpenShift: Get Route URL
oc get route s4 -n s4 -o jsonpath='{.spec.host}'

# Kubernetes: Port-forward
kubectl port-forward svc/s4 5000:5000 7480:7480 -n s4
```

For detailed Kubernetes/OpenShift configuration, see:

- [Kubernetes Deployment](../deployment/kubernetes.md)
- [OpenShift Deployment](../deployment/openshift.md)

---

## Using S4

### Web UI

1. **Open browser**: Navigate to http://localhost:5000 (or your Route URL)
2. **Login** (if authentication enabled): Enter your credentials
3. **Browse storage**: View S3 buckets and local storage
4. **Manage buckets**: Create, delete, and browse buckets
5. **Upload/download**: Drag & drop files or use the upload dialog

### S3 API

Configure the AWS CLI with default credentials:

```bash
export AWS_ACCESS_KEY_ID=s4admin
export AWS_SECRET_ACCESS_KEY=s4secret
export AWS_ENDPOINT_URL=http://localhost:7480

# Create a bucket
aws s3 mb s3://my-bucket

# Upload a file
aws s3 cp myfile.txt s3://my-bucket/

# List buckets
aws s3 ls
```

---

## What's Next?

- **[User Guide](../user-guide/README.md)** - Complete usage guide with common tasks
- **[Configuration](configuration.md)** - Environment variables and settings
- **[API Reference](../api/README.md)** - Complete API documentation
- **[Troubleshooting](../operations/troubleshooting.md)** - Common issues and solutions

---

## Quick Reference

### Ports

| Port     | Service | Description            |
| -------- | ------- | ---------------------- |
| **5000** | Web UI  | Node.js/Fastify server |
| **7480** | S3 API  | Ceph RGW endpoint      |

### Default Credentials

| Type   | Username/Key        | Password/Secret                         |
| ------ | ------------------- | --------------------------------------- |
| S3 API | `s4admin`           | `s4secret`                              |
| Web UI | (required for Helm) | Set `auth.username` and `auth.password` |

### Volumes

| Volume         | Mount Path              | Purpose                                    |
| -------------- | ----------------------- | ------------------------------------------ |
| `s4-data`      | `/var/lib/ceph/radosgw` | S3 data (required)                         |
| Custom volumes | Your choice             | Local browsing (set `LOCAL_STORAGE_PATHS`) |
