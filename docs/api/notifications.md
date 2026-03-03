# Notifications API

S4 supports webhook-based bucket notifications. When objects are created, modified, or deleted in a bucket, S4 sends HTTP POST requests to configured webhook endpoints with S3-compatible event payloads.

## How It Works

1. **Configuration** - You configure one or more webhook endpoints per bucket, specifying which event types to listen for and optional key filters
2. **Filesystem watching** - S4 watches the bucket's data directory on disk using `fs.watch()`
3. **Debounce** - Rapid changes to the same file are debounced (200ms) to prevent duplicate events
4. **Dispatch** - When a matching event occurs, S4 sends a fire-and-forget HTTP POST to each matching webhook endpoint with a 5-second timeout

## Endpoints

### Get Bucket Notifications

Retrieve the current notification configurations for a bucket.

```
GET /api/notifications/:bucketName
```

**Parameters**:

| Parameter    | Location | Description         |
| ------------ | -------- | ------------------- |
| `bucketName` | path     | Name of the bucket  |

**Response** (`200 OK`):

```json
{
  "notifications": [
    {
      "id": "notif-1708345845123-482910",
      "endpoint": "https://example.com/webhook",
      "events": ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"],
      "prefix": "data/",
      "suffix": ".csv"
    }
  ]
}
```

If no notifications are configured, returns an empty array:

```json
{
  "notifications": []
}
```

**Example**:

```bash
curl http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN"
```

---

### Set Bucket Notifications

Create or replace the notification configurations for a bucket. This replaces all existing notifications for the bucket with the provided list.

```
PUT /api/notifications/:bucketName
```

**Parameters**:

| Parameter    | Location | Description         |
| ------------ | -------- | ------------------- |
| `bucketName` | path     | Name of the bucket  |

**Request Body**:

```json
{
  "notifications": [
    {
      "endpoint": "https://example.com/webhook",
      "events": ["s3:ObjectCreated:*"],
      "prefix": "uploads/",
      "suffix": ".json"
    }
  ]
}
```

**Notification Object Fields**:

| Field      | Type     | Required | Description                                                    |
| ---------- | -------- | -------- | -------------------------------------------------------------- |
| `id`       | string   | No       | Notification ID. Auto-generated if not provided.               |
| `endpoint` | string   | Yes      | HTTP or HTTPS URL to receive webhook POST requests.            |
| `events`   | string[] | Yes      | Event types to listen for. At least one required.              |
| `prefix`   | string   | No       | Only trigger for object keys starting with this string.        |
| `suffix`   | string   | No       | Only trigger for object keys ending with this string.          |

**Validation Rules**:

- `endpoint` must match `^https?://.+` (HTTP or HTTPS URL)
- `events` must contain at least one entry
- Valid event values: `s3:ObjectCreated:*`, `s3:ObjectRemoved:*`

**Response** (`200 OK`):

```json
{
  "message": "Notification configuration updated successfully"
}
```

**Example**:

```bash
curl -X PUT http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifications": [
      {
        "endpoint": "https://example.com/webhook",
        "events": ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
      }
    ]
  }'
```

**Behavior Notes**:

- Entries without an `id` field are automatically assigned one (format: `notif-<timestamp>-<random>`)
- The bucket's filesystem watcher is started automatically when notifications are set
- This is a **replace** operation: the entire list of notifications is replaced. To add a notification without removing existing ones, first GET the current list, append your entry, then PUT the combined list.

---

### Delete Notification

Remove a single notification configuration from a bucket.

```
DELETE /api/notifications/:bucketName/:notificationId
```

**Parameters**:

| Parameter        | Location | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `bucketName`     | path     | Name of the bucket                 |
| `notificationId` | path    | ID of the notification to remove   |

**Response** (`200 OK`):

```json
{
  "message": "Notification removed successfully"
}
```

**Example**:

```bash
curl -X DELETE http://localhost:5000/api/notifications/my-bucket/notif-1708345845123-482910 \
  -H "Authorization: Bearer $TOKEN"
```

**Behavior Notes**:

- If the deleted notification was the last one for the bucket, the filesystem watcher is stopped automatically
- Deleting a non-existent notification ID completes without error

---

### Test Webhook Endpoint

Send a sample S3 notification event to a URL to verify it is reachable and responsive.

```
POST /api/notifications/test-endpoint
```

**Request Body**:

```json
{
  "endpoint": "https://example.com/webhook"
}
```

| Field      | Type   | Required | Description                             |
| ---------- | ------ | -------- | --------------------------------------- |
| `endpoint` | string | Yes      | HTTP or HTTPS URL to test               |

**Validation**: `endpoint` must match `^https?://.+`

**Success Response** (`200 OK`):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Endpoint responded with status 200"
}
```

**Failure Response** (`400 Bad Request`):

```json
{
  "success": false,
  "message": "Failed to reach endpoint: connect ECONNREFUSED 127.0.0.1:9999"
}
```

**Test Event Payload**:

The test sends this payload to the endpoint:

```json
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "eventName": "s3:TestEvent",
      "eventTime": "2024-02-19T10:30:45.123Z",
      "s3": {
        "bucket": { "name": "test-bucket" },
        "object": { "key": "test-object.txt", "size": 0 }
      }
    }
  ]
}
```

**Example**:

```bash
curl -X POST http://localhost:5000/api/notifications/test-endpoint \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "https://example.com/webhook"}'
```

**Behavior Notes**:

- The test accepts any HTTP status code from the endpoint (it uses `validateStatus: () => true`)
- A successful test means the endpoint is reachable; the `statusCode` field tells you what the endpoint returned
- The test uses the same 5-second timeout as production webhooks

---

## Webhook Payload Format

All webhook payloads follow the AWS S3 notification event format:

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

### Event Types

| Event Name                | Trigger                                       |
| ------------------------- | --------------------------------------------- |
| `s3:ObjectCreated:Put`    | Object was created or overwritten             |
| `s3:ObjectRemoved:Delete` | Object was deleted                            |
| `s3:TestEvent`            | Sent by the Test Endpoint feature             |

### Wildcard Patterns

| Pattern                | Matches                                        |
| ---------------------- | ---------------------------------------------- |
| `s3:ObjectCreated:*`   | `s3:ObjectCreated:Put` and all created events  |
| `s3:ObjectRemoved:*`   | `s3:ObjectRemoved:Delete` and all removed events |

---

## Configuration

### Environment Variables

| Variable                  | Default                                          | Description                                      |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `NOTIFICATION_STORE_PATH` | `/var/lib/ceph/radosgw/db/notifications.json`    | Path to the JSON file storing notification configs |
| `BUCKET_DATA_PATH`        | `/var/lib/ceph/radosgw/buckets`                  | Path to the Ceph POSIX backend bucket data directory |

### Storage Format

Notification configurations are stored as a JSON file:

```json
{
  "buckets": {
    "my-bucket": [
      {
        "id": "notif-1708345845123-482910",
        "endpoint": "https://example.com/webhook",
        "events": ["s3:ObjectCreated:*"],
        "prefix": "data/",
        "suffix": ".csv"
      }
    ]
  }
}
```

The store uses an in-memory cache for performance. Changes are written to disk immediately.

---

## Technical Details

- **Debounce**: Filesystem events for the same file are debounced with a 200ms delay to handle rapid changes (e.g., editors that write-delete-rename)
- **Timeout**: Webhook HTTP requests have a 5-second timeout
- **Fire-and-forget**: Webhook dispatch is asynchronous. S4 does not wait for webhook responses and does not retry failed deliveries
- **Dotfile filtering**: Changes to files starting with `.` (hidden files, editor temp files, NFS artifacts) are ignored
- **Filename decoding**: Ceph POSIX backend encodes `/` in object keys as `%2F` in filenames. S4 decodes these back to the original object key before dispatching
- **Auto-initialization**: On startup, S4 automatically starts filesystem watchers for all buckets that have existing notification configurations
- **Cleanup**: When all notifications for a bucket are deleted, the filesystem watcher for that bucket is stopped. Pending debounce timers are also cleaned up

---

## Common Use Cases

### Monitor All Changes in a Bucket

```bash
curl -X PUT http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifications": [
      {
        "endpoint": "https://example.com/webhook",
        "events": ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
      }
    ]
  }'
```

### Filter by Prefix and Suffix

Only trigger for CSV files uploaded to the `data/` path:

```bash
curl -X PUT http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifications": [
      {
        "endpoint": "https://example.com/csv-processor",
        "events": ["s3:ObjectCreated:*"],
        "prefix": "data/",
        "suffix": ".csv"
      }
    ]
  }'
```

### Add a Notification Without Replacing Existing Ones

Since PUT replaces the entire list, you need to fetch existing notifications first:

```bash
# 1. Get current notifications
CURRENT=$(curl -s http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN")

# 2. Add new entry and PUT the combined list
echo "$CURRENT" | jq '.notifications += [{
  "endpoint": "https://example.com/new-hook",
  "events": ["s3:ObjectRemoved:*"]
}]' | curl -X PUT http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @-
```

### Delete a Specific Notification

```bash
# 1. Find the notification ID
curl -s http://localhost:5000/api/notifications/my-bucket \
  -H "Authorization: Bearer $TOKEN" | jq '.notifications[].id'

# 2. Delete by ID
curl -X DELETE http://localhost:5000/api/notifications/my-bucket/notif-1708345845123-482910 \
  -H "Authorization: Bearer $TOKEN"
```
