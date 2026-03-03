import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import axios from 'axios';

import { logAccess } from '../../../utils/logAccess';
import {
  getNotificationsSchema,
  putNotificationsSchema,
  deleteNotificationSchema,
  testEndpointSchema,
} from '../../../schemas';
import { BucketParams, NotificationParams, NotificationConfigBody, TestEndpointBody } from '../../../types';
import { HttpStatus } from '../../../utils/httpStatus';
import { handleError } from '../../../utils/errorHandler';
import { auditLogExtended, AuditEventType } from '../../../utils/auditLog';
import { getNotifications, setNotifications, deleteNotification } from '../../../utils/notificationStore';
import { startWatching, stopWatching, initializeWatchers } from '../../../utils/bucketWatcher';

export default async (fastify: FastifyInstance): Promise<void> => {
  // Initialize watchers after the server is ready
  fastify.addHook('onReady', async () => {
    await initializeWatchers();
  });

  /**
   * GET /:bucketName - Get notification configurations for a bucket
   *
   * Returns the current notification configuration from the local store.
   */
  fastify.get<{ Params: BucketParams }>('/:bucketName', { schema: getNotificationsSchema }, async (req, reply) => {
    logAccess(req);
    const { bucketName } = req.params;

    try {
      const notifications = await getNotifications(bucketName);
      reply.send({ notifications });
    } catch (error) {
      await handleError(error, reply, HttpStatus.INTERNAL_SERVER_ERROR, req.log);
    }
  });

  /**
   * PUT /:bucketName - Set notification configurations for a bucket
   *
   * Saves notification entries to local store and starts filesystem watcher.
   */
  fastify.put<{ Params: BucketParams; Body: NotificationConfigBody }>(
    '/:bucketName',
    { schema: putNotificationsSchema },
    async (req, reply) => {
      logAccess(req);
      const { bucketName } = req.params;
      const { notifications } = req.body;

      try {
        // Assign IDs to entries that don't have one
        const withIds = notifications.map((entry) => ({
          ...entry,
          id: entry.id || randomUUID(),
        }));

        await setNotifications(bucketName, withIds);
        startWatching(bucketName);

        // Audit log
        if (req.user) {
          auditLogExtended({
            user: req.user,
            eventType: AuditEventType.NOTIFICATION_CREATE,
            action: 'create',
            resource: `notification:${bucketName}`,
            status: 'success',
            details: `Set ${notifications.length} notification(s)`,
            clientIp: req.ip || 'unknown',
          });
        }

        reply.send({ message: 'Notification configuration updated successfully' });
      } catch (error) {
        await handleError(error, reply, HttpStatus.INTERNAL_SERVER_ERROR, req.log);
      }
    },
  );

  /**
   * DELETE /:bucketName/:notificationId - Remove a single notification
   *
   * Removes the matching entry from the store and stops the watcher
   * if no notifications remain for this bucket.
   */
  fastify.delete<{ Params: NotificationParams }>(
    '/:bucketName/:notificationId',
    { schema: deleteNotificationSchema },
    async (req, reply) => {
      logAccess(req);
      const { bucketName, notificationId } = req.params;

      try {
        const deleted = await deleteNotification(bucketName, notificationId);

        if (!deleted) {
          reply.code(HttpStatus.NOT_FOUND).send({ error: 'NotFound', message: 'Notification not found' });
          return;
        }

        // Stop watcher if no notifications remain for this bucket
        const remaining = await getNotifications(bucketName);
        if (remaining.length === 0) {
          stopWatching(bucketName);
        }

        // Audit log
        if (req.user) {
          auditLogExtended({
            user: req.user,
            eventType: AuditEventType.NOTIFICATION_DELETE,
            action: 'delete',
            resource: `notification:${bucketName}/${notificationId}`,
            status: 'success',
            clientIp: req.ip || 'unknown',
          });
        }

        reply.send({ message: 'Notification removed successfully' });
      } catch (error) {
        await handleError(error, reply, HttpStatus.INTERNAL_SERVER_ERROR, req.log);
      }
    },
  );

  /**
   * POST /test-endpoint - Test an HTTP endpoint by sending a sample S3 event
   *
   * Sends a sample S3 notification event to the provided URL and reports
   * whether the endpoint is reachable and responsive.
   */
  fastify.post<{ Body: TestEndpointBody }>('/test-endpoint', { schema: testEndpointSchema }, async (req, reply) => {
    logAccess(req);
    const { endpoint } = req.body;

    const sampleEvent = {
      Records: [
        {
          eventVersion: '2.1',
          eventSource: 'aws:s3',
          eventName: 's3:TestEvent',
          eventTime: new Date().toISOString(),
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'test-object.txt', size: 0 },
          },
        },
      ],
    };

    try {
      const response = await axios.post(endpoint, sampleEvent, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true, // Accept any HTTP status
      });

      const isSuccess = response.status >= 200 && response.status < 300;

      // Audit log
      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.NOTIFICATION_TEST,
          action: 'test',
          resource: `notification:endpoint`,
          status: 'success',
          details: `Endpoint ${endpoint} responded with status ${response.status}`,
          clientIp: req.ip || 'unknown',
        });
      }

      reply.send({
        success: true,
        statusCode: response.status,
        message: `Endpoint responded with status ${response.status}`,
        warning: !isSuccess ? `Endpoint returned non-success status ${response.status}` : undefined,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';

      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.NOTIFICATION_TEST,
          action: 'test',
          resource: `notification:endpoint`,
          status: 'failure',
          details: `Endpoint ${endpoint} failed: ${errMsg}`,
          clientIp: req.ip || 'unknown',
        });
      }

      reply.code(HttpStatus.BAD_REQUEST).send({
        success: false,
        message: `Failed to reach endpoint: ${errMsg}`,
      });
    }
  });
};
