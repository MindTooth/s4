import * as fs from 'fs/promises';
import * as path from 'path';
import { NotificationEntry } from '../types';
import { createLogger } from './logger';

const logger = createLogger(undefined, '[NotificationStore]');

const STORE_PATH = process.env.NOTIFICATION_STORE_PATH || '/var/lib/ceph/radosgw/db/notifications.json';

interface NotificationStoreData {
  buckets: Record<string, NotificationEntry[]>;
}

let cache: NotificationStoreData | null = null;

// Promise-based mutex to serialize write operations
let writeLock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prevLock = writeLock;
  writeLock = nextLock;

  await prevLock;
  try {
    return await fn();
  } finally {
    release!();
  }
}

async function readStore(): Promise<NotificationStoreData> {
  if (cache) {
    return cache;
  }

  try {
    const data = await fs.readFile(STORE_PATH, 'utf-8');
    cache = JSON.parse(data) as NotificationStoreData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = { buckets: {} };
    } else {
      logger.error(err, 'Failed to read notification store');
      cache = { buckets: {} };
    }
  }

  return cache!;
}

async function writeStore(data: NotificationStoreData): Promise<void> {
  cache = data;

  try {
    const dir = path.dirname(STORE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.error(err, 'Failed to write notification store');
  }
}

export async function getNotifications(bucketName: string): Promise<NotificationEntry[]> {
  const store = await readStore();
  return store.buckets[bucketName] || [];
}

export async function setNotifications(bucketName: string, notifications: NotificationEntry[]): Promise<void> {
  await withLock(async () => {
    const store = await readStore();

    if (notifications.length === 0) {
      delete store.buckets[bucketName];
    } else {
      store.buckets[bucketName] = notifications;
    }

    await writeStore(store);
  });
}

/**
 * Delete a notification by ID. Returns true if the notification was found and removed.
 */
export async function deleteNotification(bucketName: string, notificationId: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const current = store.buckets[bucketName] || [];
    const remaining = current.filter((n) => n.id !== notificationId);

    if (remaining.length === current.length) {
      return false; // Nothing was deleted
    }

    if (remaining.length === 0) {
      delete store.buckets[bucketName];
    } else {
      store.buckets[bucketName] = remaining;
    }

    await writeStore(store);
    return true;
  });
}

export async function getAllBucketNames(): Promise<string[]> {
  const store = await readStore();
  return Object.keys(store.buckets);
}
