import axios from 'axios';
import { createLogger } from './logger';
import { getNotifications } from './notificationStore';
import { NotificationEntry } from '../types';

const logger = createLogger(undefined, '[WebhookDispatcher]');

function matchesEvent(notification: NotificationEntry, eventName: string): boolean {
  return notification.events.some((pattern) => {
    if (pattern === eventName) return true;
    // Wildcard matching: "s3:ObjectCreated:*" matches "s3:ObjectCreated:Put"
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // "s3:ObjectCreated:"
      return eventName.startsWith(prefix) || eventName === pattern;
    }
    return false;
  });
}

function matchesFilters(notification: NotificationEntry, objectKey: string): boolean {
  if (notification.prefix && !objectKey.startsWith(notification.prefix)) {
    return false;
  }
  if (notification.suffix && !objectKey.endsWith(notification.suffix)) {
    return false;
  }
  return true;
}

export async function dispatchWebhooks(
  bucketName: string,
  eventName: string,
  objectKey: string,
  objectSize: number,
): Promise<void> {
  const notifications = await getNotifications(bucketName);

  for (const notification of notifications) {
    if (!matchesEvent(notification, eventName)) continue;
    if (!matchesFilters(notification, objectKey)) continue;

    const payload = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          eventName,
          eventTime: new Date().toISOString(),
          s3: {
            bucket: { name: bucketName },
            object: { key: objectKey, size: objectSize },
          },
        },
      ],
    };

    // Fire-and-forget
    axios
      .post(notification.endpoint, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      })
      .then(() => {
        logger.info(
          { bucket: bucketName, event: eventName, key: objectKey, endpoint: notification.endpoint },
          'Webhook dispatched',
        );
      })
      .catch((err) => {
        logger.warn(
          { bucket: bucketName, event: eventName, key: objectKey, endpoint: notification.endpoint, error: err.message },
          'Webhook dispatch failed',
        );
      });
  }
}
