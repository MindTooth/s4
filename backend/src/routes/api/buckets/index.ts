import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

import { getS3Config } from '../../../utils/config';
import { logAccess } from '../../../utils/logAccess';
import { createBucketSchema } from '../../../schemas';
import { BucketParams, CreateBucketBody } from '../../../types';
import { handleS3Error } from '../../../utils/errorHandler';
import { auditLogExtended, AuditEventType } from '../../../utils/auditLog';
import { setNotifications } from '../../../utils/notificationStore';
import { stopWatching } from '../../../utils/bucketWatcher';

export default async (fastify: FastifyInstance): Promise<void> => {
  // Note: Authentication is handled by the global auth hook in app.ts

  // Retrieve all accessible buckets
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    logAccess(req);
    const { s3Client, defaultBucket } = getS3Config();
    const command = new ListBucketsCommand({});

    try {
      const { Owner, Buckets } = await s3Client.send(command);

      // Filter buckets to only include those we can access
      const accessibleBuckets = [];
      if (Buckets) {
        for (const bucket of Buckets) {
          try {
            // Try to access bucket metadata - will throw if no access
            await s3Client.send(new HeadBucketCommand({ Bucket: bucket.Name }));
            accessibleBuckets.push(bucket);
          } catch (_bucketError) {
            // Skip buckets we don't have access to
            req.log.info({ bucket: bucket.Name }, 'No access to bucket');
          }
        }
      }

      reply.send({
        owner: Owner,
        defaultBucket: defaultBucket,
        buckets: accessibleBuckets,
      });
    } catch (error) {
      await handleS3Error(error, reply);
    }
  });

  // Create a new bucket
  fastify.post<{ Body: CreateBucketBody }>('/', { schema: createBucketSchema }, async (req, reply) => {
    logAccess(req);
    const { s3Client } = getS3Config();
    const { bucketName } = req.body;
    const createBucketCommand = new CreateBucketCommand({
      Bucket: bucketName,
    });

    try {
      const data = await s3Client.send(createBucketCommand);

      // Audit log: bucket created
      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.BUCKET_CREATE,
          action: 'create',
          resource: `bucket:${bucketName}`,
          status: 'success',
          clientIp: req.ip || 'unknown',
        });
      }

      reply.send({ message: 'Bucket created successfully', data });
    } catch (error) {
      // Audit log: bucket creation failed
      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.BUCKET_CREATE,
          action: 'create',
          resource: `bucket:${bucketName}`,
          status: 'failure',
          details: error instanceof Error ? error.message : 'Unknown error',
          clientIp: req.ip || 'unknown',
        });
      }

      await handleS3Error(error, reply);
    }
  });

  // Delete a bucket
  fastify.delete<{ Params: BucketParams }>('/:bucketName', async (req, reply) => {
    logAccess(req);
    const { s3Client } = getS3Config();
    const { bucketName } = req.params;

    // Clean up notification configs and watcher before deleting the bucket
    stopWatching(bucketName);
    await setNotifications(bucketName, []);

    const deleteBucketCommand = new DeleteBucketCommand({
      Bucket: bucketName,
    });

    try {
      await s3Client.send(deleteBucketCommand);

      // Audit log: bucket deleted
      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.BUCKET_DELETE,
          action: 'delete',
          resource: `bucket:${bucketName}`,
          status: 'success',
          clientIp: req.ip || 'unknown',
        });
      }

      reply.send({ message: 'Bucket deleted successfully' });
    } catch (error) {
      // Audit log: bucket deletion failed
      if (req.user) {
        auditLogExtended({
          user: req.user,
          eventType: AuditEventType.BUCKET_DELETE,
          action: 'delete',
          resource: `bucket:${bucketName}`,
          status: 'failure',
          details: error instanceof Error ? error.message : 'Unknown error',
          clientIp: req.ip || 'unknown',
        });
      }

      await handleS3Error(error, reply);
    }
  });
};
