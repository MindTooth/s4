import { FastifyInstance } from 'fastify';
import notificationsRoutes from '../../../../routes/api/notifications';

// Mock logAccess
jest.mock('../../../../utils/logAccess', () => ({
  logAccess: jest.fn(),
}));

// Mock error handler
jest.mock('../../../../utils/errorHandler', () => ({
  handleError: jest.fn(
    async (_error: unknown, reply: { code: (n: number) => { send: (body: unknown) => void } }, statusCode: number) => {
      reply.code(statusCode).send({ error: 'InternalServerError', message: 'An error occurred' });
    },
  ),
}));

// Mock notification store (async functions)
jest.mock('../../../../utils/notificationStore', () => ({
  getNotifications: jest.fn().mockResolvedValue([]),
  setNotifications: jest.fn().mockResolvedValue(undefined),
  deleteNotification: jest.fn().mockResolvedValue(true),
  getAllBucketNames: jest.fn().mockResolvedValue([]),
}));

// Mock bucket watcher
jest.mock('../../../../utils/bucketWatcher', () => ({
  startWatching: jest.fn(),
  stopWatching: jest.fn(),
  initializeWatchers: jest.fn().mockResolvedValue(undefined),
  shutdownWatchers: jest.fn(),
}));

// Mock axios for test-endpoint
jest.mock('axios', () => ({
  post: jest.fn(),
}));

import { getNotifications, setNotifications, deleteNotification } from '../../../../utils/notificationStore';
import { startWatching, stopWatching } from '../../../../utils/bucketWatcher';
import axios from 'axios';

describe('Notification Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Fastify = require('fastify');
    fastify = Fastify();
    fastify.register(notificationsRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    jest.clearAllMocks();
  });

  describe('GET /:bucketName', () => {
    it('should return empty notifications when none configured', async () => {
      (getNotifications as jest.Mock).mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/test-bucket',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.notifications).toEqual([]);
      expect(getNotifications).toHaveBeenCalledWith('test-bucket');
    });

    it('should return notification list from store', async () => {
      (getNotifications as jest.Mock).mockResolvedValue([
        {
          id: 'notif-1',
          endpoint: 'http://example.com/webhook',
          events: ['s3:ObjectCreated:*'],
          prefix: 'uploads/',
          suffix: '.jpg',
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/test-bucket',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.notifications).toHaveLength(1);
      expect(payload.notifications[0]).toEqual({
        id: 'notif-1',
        endpoint: 'http://example.com/webhook',
        events: ['s3:ObjectCreated:*'],
        prefix: 'uploads/',
        suffix: '.jpg',
      });
    });

    it('should reject invalid bucket names', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/INVALID_BUCKET',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /:bucketName', () => {
    it('should save notifications and start watcher', async () => {
      const response = await fastify.inject({
        method: 'PUT',
        url: '/test-bucket',
        payload: {
          notifications: [
            {
              id: 'notif-1',
              endpoint: 'http://example.com/webhook',
              events: ['s3:ObjectCreated:*'],
              prefix: 'uploads/',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe('Notification configuration updated successfully');
      expect(setNotifications).toHaveBeenCalledWith('test-bucket', [
        expect.objectContaining({
          id: 'notif-1',
          endpoint: 'http://example.com/webhook',
          events: ['s3:ObjectCreated:*'],
          prefix: 'uploads/',
        }),
      ]);
      expect(startWatching).toHaveBeenCalledWith('test-bucket');
    });

    it('should validate endpoint URL format', async () => {
      const response = await fastify.inject({
        method: 'PUT',
        url: '/test-bucket',
        payload: {
          notifications: [
            {
              endpoint: 'ftp://invalid.com',
              events: ['s3:ObjectCreated:*'],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate event types', async () => {
      const response = await fastify.inject({
        method: 'PUT',
        url: '/test-bucket',
        payload: {
          notifications: [
            {
              endpoint: 'http://example.com/webhook',
              events: ['s3:InvalidEvent'],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /:bucketName/:notificationId', () => {
    it('should remove notification from store', async () => {
      (deleteNotification as jest.Mock).mockResolvedValue(true);
      (getNotifications as jest.Mock).mockResolvedValue([
        {
          id: 'notif-2',
          endpoint: 'http://example.com/webhook2',
          events: ['s3:ObjectRemoved:*'],
        },
      ]);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/test-bucket/notif-1',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe('Notification removed successfully');
      expect(deleteNotification).toHaveBeenCalledWith('test-bucket', 'notif-1');
    });

    it('should stop watcher when no notifications remain', async () => {
      (deleteNotification as jest.Mock).mockResolvedValue(true);
      (getNotifications as jest.Mock).mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/test-bucket/notif-1',
      });

      expect(response.statusCode).toBe(200);
      expect(deleteNotification).toHaveBeenCalledWith('test-bucket', 'notif-1');
      expect(stopWatching).toHaveBeenCalledWith('test-bucket');
    });

    it('should return 404 when notification does not exist', async () => {
      (deleteNotification as jest.Mock).mockResolvedValue(false);

      const response = await fastify.inject({
        method: 'DELETE',
        url: '/test-bucket/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toBe('NotFound');
    });
  });

  describe('POST /test-endpoint', () => {
    it('should return success for reachable endpoint', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        status: 200,
        data: 'OK',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/test-endpoint',
        payload: {
          endpoint: 'http://example.com/webhook',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.statusCode).toBe(200);
      expect(payload.warning).toBeUndefined();
    });

    it('should include warning for non-2xx status', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        status: 500,
        data: 'Internal Server Error',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/test-endpoint',
        payload: {
          endpoint: 'http://example.com/webhook',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.statusCode).toBe(500);
      expect(payload.warning).toContain('non-success status');
    });

    it('should return failure for unreachable endpoint', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/test-endpoint',
        payload: {
          endpoint: 'http://unreachable.example.com/webhook',
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.message).toContain('ECONNREFUSED');
    });

    it('should validate endpoint URL format', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/test-endpoint',
        payload: {
          endpoint: 'not-a-url',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
