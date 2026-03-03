# API Examples

Complete workflow examples using curl and aws-cli.

## Complete Upload Workflow

```bash
#!/bin/bash
TOKEN="your-jwt-token"

# 1. Create bucket
curl -X POST http://localhost:5000/api/buckets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bucketName": "my-data"}'

# 2. Upload file
key=$(echo -n "datasets/train.csv" | base64 | tr '+/' '-_' | tr -d '=')
curl -X POST "http://localhost:5000/api/objects/upload/my-data/$key" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@train.csv"

# 3. List objects
curl "http://localhost:5000/api/objects/my-data" \
  -H "Authorization: Bearer $TOKEN"

# 4. Download file
curl "http://localhost:5000/api/objects/download/my-data/$key" \
  -H "Authorization: Bearer $TOKEN" \
  -o downloaded.csv
```

## Transfer with Progress Tracking

```javascript
// 1. Check for conflicts
const conflictResp = await fetch('/api/transfer/check-conflicts', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    source: { type: 's3', locationId: 'my-bucket', path: 'models/' },
    destination: { type: 'local', locationId: 'local-0', path: '/backup' },
    items: [{ path: '', type: 'directory' }],
  }),
});
const { conflicts } = await conflictResp.json();

if (conflicts.length > 0) {
  console.log(`Warning: ${conflicts.length} conflicts found`);
}

// 2. Create transfer
const createResp = await fetch('/api/transfer', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    source: { type: 's3', locationId: 'my-bucket', path: 'models/' },
    destination: { type: 'local', locationId: 'local-0', path: '/backup' },
    items: [{ path: '', type: 'directory' }],
    conflictResolution: 'skip',
  }),
});
const { jobId } = await createResp.json();

// 3. Get SSE ticket
const ticketResp = await fetch('/api/auth/sse-ticket', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    resource: jobId,
    resourceType: 'transfer',
  }),
});
const { ticket } = await ticketResp.json();

// 4. Track progress
const eventSource = new EventSource(`/api/transfer/progress/${jobId}?ticket=${ticket}`);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'complete') {
    console.log('Transfer completed!');
    eventSource.close();
  } else if (data.type === 'progress') {
    const percent = ((data.job.bytesTransferred / data.job.totalBytes) * 100).toFixed(2);
    console.log(`${percent}%: ${data.currentFile.path}`);
  }
};
```

## Using AWS CLI with S4

```bash
# Configure
export AWS_ACCESS_KEY_ID=s4admin
export AWS_SECRET_ACCESS_KEY=s4secret
export AWS_ENDPOINT_URL=http://localhost:7480

# Create bucket
aws s3 mb s3://data

# Upload file
aws s3 cp largefile.bin s3://data/models/

# Download file
aws s3 cp s3://data/models/largefile.bin ./

# Sync directory
aws s3 sync ./local-dir s3://data/backup/

# List objects
aws s3 ls s3://data/models/ --recursive

# Delete bucket (must be empty)
aws s3 rb s3://data --force
```

## HuggingFace Model Import

```bash
# 1. Configure HF token
curl -X PUT http://localhost:5000/api/settings/huggingface \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hfToken": "hf_..."}'

# 2. Import model
curl -X POST http://localhost:5000/api/objects/huggingface-import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bucketName": "models",
    "hfRepoId": "meta-llama/Llama-2-7b-hf",
    "s3Prefix": "llama-2-7b"
  }'
```

## Notification Webhook Configuration

```bash
#!/bin/bash
TOKEN="your-jwt-token"
BUCKET="my-bucket"

# 1. Test endpoint reachability
curl -X POST http://localhost:5000/api/notifications/test-endpoint \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "https://example.com/webhook"}'

# 2. Configure notifications
curl -X PUT "http://localhost:5000/api/notifications/$BUCKET" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifications": [
      {
        "endpoint": "https://example.com/webhook",
        "events": ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"],
        "prefix": "data/",
        "suffix": ".csv"
      }
    ]
  }'

# 3. View current configuration
curl "http://localhost:5000/api/notifications/$BUCKET" \
  -H "Authorization: Bearer $TOKEN"

# 4. Add a second notification without removing existing ones
CURRENT=$(curl -s "http://localhost:5000/api/notifications/$BUCKET" \
  -H "Authorization: Bearer $TOKEN")
echo "$CURRENT" | jq '.notifications += [{
  "endpoint": "https://example.com/audit",
  "events": ["s3:ObjectRemoved:*"]
}]' | curl -X PUT "http://localhost:5000/api/notifications/$BUCKET" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @-

# 5. Delete a specific notification by ID
NOTIF_ID=$(curl -s "http://localhost:5000/api/notifications/$BUCKET" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.notifications[0].id')
curl -X DELETE "http://localhost:5000/api/notifications/$BUCKET/$NOTIF_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## Batch Operations

```bash
#!/bin/bash
# Delete multiple files

BUCKET="my-bucket"
FILES=("file1.txt" "file2.txt" "file3.txt")

for file in "${FILES[@]}"; do
  key=$(echo -n "$file" | base64 | tr '+/' '-_' | tr -d '=')
  curl -X DELETE "http://localhost:5000/api/objects/$BUCKET/$key" \
    -H "Authorization: Bearer $TOKEN"
done
```
