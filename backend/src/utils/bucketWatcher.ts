import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';
import { getAllBucketNames } from './notificationStore';
import { dispatchWebhooks } from './webhookDispatcher';

const logger = createLogger(undefined, '[BucketWatcher]');

const BUCKET_DATA_PATH = process.env.BUCKET_DATA_PATH || '/var/lib/ceph/radosgw/buckets';

const watchers = new Map<string, fs.FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

const DEBOUNCE_MS = 200;

function handleFileEvent(bucketName: string, eventType: string, filename: string | null): void {
  if (!filename) return;

  // Skip dotfiles (temp files, NFS artifacts, etc.)
  if (filename.startsWith('.')) return;

  const debounceKey = `${bucketName}/${filename}`;

  const existing = debounceTimers.get(debounceKey);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    debounceKey,
    setTimeout(() => {
      debounceTimers.delete(debounceKey);
      processEvent(bucketName, eventType, filename);
    }, DEBOUNCE_MS),
  );
}

function processEvent(bucketName: string, eventType: string, filename: string): void {
  // Decode %2F-encoded filenames back to S3 object keys
  const objectKey = decodeURIComponent(filename);

  if (eventType === 'rename') {
    // rename = file created or deleted; check existence
    const filePath = path.join(BUCKET_DATA_PATH, bucketName, filename);
    fs.stat(filePath, (err, stats) => {
      if (err) {
        // File doesn't exist → deleted
        void dispatchWebhooks(bucketName, 's3:ObjectRemoved:Delete', objectKey, 0);
      } else {
        // File exists → created
        void dispatchWebhooks(bucketName, 's3:ObjectCreated:Put', objectKey, stats.size);
      }
    });
  } else if (eventType === 'change') {
    // File content modified
    const filePath = path.join(BUCKET_DATA_PATH, bucketName, filename);
    fs.stat(filePath, (err, stats) => {
      const size = err ? 0 : stats.size;
      void dispatchWebhooks(bucketName, 's3:ObjectCreated:Put', objectKey, size);
    });
  }
}

export function startWatching(bucketName: string): void {
  if (watchers.has(bucketName)) {
    return; // Already watching
  }

  const bucketDir = path.join(BUCKET_DATA_PATH, bucketName);

  try {
    fs.accessSync(bucketDir);
  } catch {
    logger.warn({ bucketName, path: bucketDir }, 'Bucket directory does not exist, skipping watcher');
    return;
  }

  try {
    const watcher = fs.watch(bucketDir, (eventType, filename) => {
      handleFileEvent(bucketName, eventType, filename);
    });

    watcher.on('error', (err) => {
      logger.error({ bucketName, error: err.message }, 'Watcher error');
      stopWatching(bucketName);
    });

    watchers.set(bucketName, watcher);
    logger.info({ bucketName }, 'Started watching bucket directory');
  } catch (err) {
    logger.warn({ bucketName, error: (err as Error).message }, 'Failed to start watcher');
  }
}

export function stopWatching(bucketName: string): void {
  const watcher = watchers.get(bucketName);
  if (watcher) {
    watcher.close();
    watchers.delete(bucketName);
    logger.info({ bucketName }, 'Stopped watching bucket directory');
  }

  // Clean up any pending debounce timers for this bucket
  for (const [key, timer] of debounceTimers.entries()) {
    if (key.startsWith(`${bucketName}/`)) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  }
}

export async function initializeWatchers(): Promise<void> {
  const bucketNames = await getAllBucketNames();
  logger.info({ count: bucketNames.length }, 'Initializing bucket watchers');

  for (const bucketName of bucketNames) {
    startWatching(bucketName);
  }
}

export function shutdownWatchers(): void {
  logger.info({ count: watchers.size }, 'Shutting down all bucket watchers');

  for (const bucketName of watchers.keys()) {
    stopWatching(bucketName);
  }
}
