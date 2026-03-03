# API Reference

S4 provides a comprehensive RESTful API for storage operations, configuration management, and file transfers. All API endpoints are prefixed with `/api`.

## Base URL

**Development**: `http://localhost:5000/api`
**Production**: `https://your-domain/api`

## Authentication

### Authentication Modes

S4 supports two authentication modes:

**Disabled** (default for development):

- No authentication required
- All endpoints accessible without credentials

**Enabled** (production):

- JWT token-based authentication
- Enabled when both `UI_USERNAME` and `UI_PASSWORD` environment variables are set

### Obtaining a Token

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-password"
  }'
```

**Response**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "admin",
    "username": "admin",
    "roles": ["admin"]
  },
  "expiresIn": 28800
}
```

### Using Tokens

**Option 1: Authorization Header** (recommended for API clients):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5000/api/buckets
```

**Option 2: HttpOnly Cookie** (automatic for browser):

- Token automatically set as `s4_auth_token` cookie
- Sent automatically with requests from browser
- Cleared on logout

### SSE (Server-Sent Events) Authentication

EventSource API cannot set custom headers, so S4 uses **one-time tickets** for SSE endpoints to avoid exposing JWT tokens in URLs.

**Generate Ticket**:

```bash
curl -X POST http://localhost:5000/api/auth/sse-ticket \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "transfer-job-id",
    "resourceType": "transfer"
  }'
```

**Response**:

```json
{
  "ticket": "abc123...",
  "sseUrl": "/transfer/progress/transfer-job-id?ticket=abc123...",
  "expiresAt": 1234567890000,
  "expiresIn": 60
}
```

**Use Ticket**:

```javascript
const eventSource = new EventSource(`/api/transfer/progress/job-123?ticket=${ticket}`);
```

**Security**:

- 60-second TTL (configurable)
- Single-use (deleted after validation)
- Resource-scoped (tied to specific transfer/upload)
- Rate-limited (20 tickets per minute)

## Base64 URL Encoding

S4 uses Base64 encoding for object keys and file paths in URLs to handle special characters safely.

### When to Encode

**Encode** (Base64):

- Object keys (S3): `models/llama/config.json`
- File paths (local): `/data/datasets/training.csv`

**Don't Encode**:

- Bucket names (validated to URL-safe characters)
- Location IDs (`local-0`, `my-bucket`)

### Encoding Format

**URL-safe Base64**:

```javascript
// Encode
const encoded = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

// Decode
const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
```

**Example**:

```
Original: models/llama-2-7b/config.json
Base64:   bW9kZWxzL2xsYW1hLTItN2IvY29uZmlnLmpzb24
URL:      /api/objects/my-bucket/bW9kZWxzL2xsYW1hLTItN2IvY29uZmlnLmpzb24
```

## Common Patterns

### Pagination

List operations support pagination using continuation tokens:

```bash
# First page
GET /api/objects/my-bucket?maxKeys=100

# Next page
GET /api/objects/my-bucket?maxKeys=100&continuationToken=PREVIOUS_TOKEN
```

**Response**:

```json
{
  "objects": [...],
  "isTruncated": true,
  "nextContinuationToken": "TOKEN_FOR_NEXT_PAGE"
}
```

### Filtering

Object listing supports search filtering:

```bash
# Starts with search (fast)
GET /api/objects/my-bucket?q=model&mode=startsWith

# Contains search (slower, scans multiple pages)
GET /api/objects/my-bucket?q=config&mode=contains
```

**Rate Limiting**: Contains search is limited to 5 requests per minute.

### Streaming

Upload and download operations use streaming for memory efficiency:

**Upload**:

```bash
curl -X POST http://localhost:5000/api/objects/upload/my-bucket/ZmlsZS50eHQ \
  -H "Content-Type: multipart/form-data" \
  -F "file=@largefile.bin"
```

**Download**:

```bash
curl http://localhost:5000/api/objects/download/my-bucket/ZmlsZS50eHQ \
  -o downloaded.bin
```

### Server-Sent Events (SSE)

Transfer and upload progress is streamed via SSE:

**Example**:

```javascript
const eventSource = new EventSource(`/api/transfer/progress/job-123?ticket=${ticket}`);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Progress: ${data.completed}/${data.total}`);
};

eventSource.onerror = () => {
  eventSource.close();
};
```

**Event Format**:

```json
{
  "type": "progress",
  "job": {
    "id": "job-123",
    "status": "in_progress",
    "filesCompleted": 5,
    "totalFiles": 10,
    "bytesTransferred": 1048576,
    "totalBytes": 10485760
  },
  "currentFile": {
    "path": "models/config.json",
    "loaded": 512000,
    "total": 1048576
  }
}
```

## Error Handling

### Standard Error Response

```json
{
  "error": "ErrorName",
  "message": "Human-readable error description"
}
```

### Common Status Codes

| Code | Meaning               | Description                              |
| ---- | --------------------- | ---------------------------------------- |
| 200  | OK                    | Request successful                       |
| 201  | Created               | Resource created successfully            |
| 400  | Bad Request           | Invalid request parameters               |
| 401  | Unauthorized          | Authentication required or invalid token |
| 403  | Forbidden             | Insufficient permissions                 |
| 404  | Not Found             | Resource not found                       |
| 409  | Conflict              | Resource already exists                  |
| 413  | Payload Too Large     | File exceeds size limit                  |
| 429  | Too Many Requests     | Rate limit exceeded                      |
| 500  | Internal Server Error | Server error                             |
| 507  | Insufficient Storage  | Disk full                                |

### Rate Limiting

When rate limited, response includes `retryAfter`:

```json
{
  "error": "RateLimitExceeded",
  "message": "Too many requests. Maximum 5 per minute.",
  "retryAfter": 1234567890
}
```

**Rate Limits** (per IP address):

- **Login**: 5 attempts per minute
- **SSE ticket generation**: 20 requests per minute
- **Object contains search**: 5 requests per minute
- **Local file uploads**: 20 requests per minute

Rate limits are hardcoded and stored in-memory. Exceeded limits return HTTP 429 with `retryAfter` timestamp. See [Configuration Reference](../deployment/configuration.md#rate-limiting) for customization.

## API Endpoints

### Authentication

- [Authentication API](authentication.md)
  - `GET /auth/info` - Check auth status
  - `POST /auth/login` - Login
  - `POST /auth/logout` - Logout
  - `GET /auth/me` - Get current user
  - `POST /auth/sse-ticket` - Generate SSE ticket

### Buckets

- [Buckets API](buckets.md)
  - `GET /buckets` - List buckets
  - `POST /buckets` - Create bucket
  - `DELETE /buckets/:bucketName` - Delete bucket

### Objects

- [Objects API](objects.md)
  - `GET /objects/:bucketName` - List objects
  - `POST /objects/upload/:bucketName/:encodedKey` - Upload object
  - `GET /objects/download/:bucketName/:encodedKey` - Download object
  - `DELETE /objects/:bucketName/:encodedKey` - Delete object
  - `GET /objects/view/:bucketName/:encodedKey` - View object metadata
  - `POST /objects/huggingface-import` - Import HuggingFace model
  - `GET /objects/upload-progress/:encodedKey` - Upload progress (SSE)

### Notifications

- [Notifications API](notifications.md)
  - `GET /notifications/:bucketName` - Get bucket notification configurations
  - `PUT /notifications/:bucketName` - Set bucket notification configurations
  - `DELETE /notifications/:bucketName/:notificationId` - Remove a notification
  - `POST /notifications/test-endpoint` - Test a webhook endpoint

### Transfers

- [Transfer API](transfer.md)
  - `POST /transfer` - Create transfer job
  - `GET /transfer/progress/:jobId` - Transfer progress (SSE)
  - `POST /transfer/cancel/:jobId` - Cancel transfer
  - `POST /transfer/cleanup/:jobId` - Clean up transfer
  - `POST /transfer/check-conflicts` - Check for conflicts

### Settings

- [Settings API](settings.md)
  - `GET /settings/s3` - Get S3 settings
  - `PUT /settings/s3` - Update S3 settings
  - `POST /settings/test-s3` - Test S3 connection
  - `GET /settings/huggingface` - Get HuggingFace token
  - `PUT /settings/huggingface` - Update HuggingFace token
  - `POST /settings/test-huggingface` - Test HuggingFace connection
  - `GET /settings/proxy` - Get proxy settings
  - `PUT /settings/proxy` - Update proxy settings
  - `POST /settings/test-proxy` - Test proxy connection
  - `GET /settings/max-concurrent-transfers` - Get concurrency limit
  - `PUT /settings/max-concurrent-transfers` - Update concurrency limit
  - `GET /settings/max-files-per-page` - Get pagination limit
  - `PUT /settings/max-files-per-page` - Update pagination limit
  - `GET /settings/disclaimer` - Get disclaimer status
  - `PUT /settings/disclaimer` - Update disclaimer status

### Local Storage

- [Local Storage API](local.md)
  - `GET /local/locations` - List storage locations
  - `GET /local/files/:locationId/*` - List files
  - `POST /local/upload/:locationId/*` - Upload file
  - `GET /local/download/:locationId/*` - Download file
  - `DELETE /local/:locationId/*` - Delete file/directory
  - `GET /local/view/:locationId/*` - View file metadata
  - `POST /local/create-directory/:locationId/*` - Create directory

## Code Examples

See [API Examples](examples.md) for complete workflow examples using curl and aws-cli.

## CORS

**Development Origins** (default):

- `http://localhost:5000`
- `http://localhost:8888`
- `http://localhost:9000`
- `http://127.0.0.1:5000`
- `http://127.0.0.1:8888`
- `http://127.0.0.1:9000`

**Production**: Override via `ALLOWED_ORIGINS` environment variable (comma-separated).

**Credentials**: CORS configured with `credentials: true` for cookie support.

## Versioning

**Current Version**: v1 (implicit, no version prefix in URL)

**Future**: API versioning will be added as `/api/v2/...` when breaking changes are introduced.

## Further Reading

- **[API Examples](examples.md)** - Complete workflow examples
- **[Backend Architecture](../architecture/backend.md)** - Implementation details
- **[Authentication Security](../security/authentication.md)** - Security considerations
