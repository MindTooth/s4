/**
 * JSON Schema definitions for request validation
 * Used by Fastify's built-in validation system
 */

import { PAGE_SIZE_PRESETS } from '../utils/paginationPresets';

// ========== Bucket Schemas ==========

export const createBucketSchema = {
  body: {
    type: 'object',
    required: ['bucketName'],
    properties: {
      bucketName: {
        type: 'string',
        minLength: 3,
        maxLength: 63,
        pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
      },
    },
  },
};

// ========== Settings Schemas ==========

export const updateS3ConfigSchema = {
  body: {
    type: 'object',
    required: ['accessKeyId', 'secretAccessKey', 'region', 'endpoint', 'defaultBucket'],
    properties: {
      accessKeyId: { type: 'string', minLength: 1 },
      secretAccessKey: { type: 'string', minLength: 1 },
      region: { type: 'string', minLength: 1 },
      endpoint: { type: 'string', minLength: 1 },
      defaultBucket: { type: 'string' },
    },
  },
};

export const testS3ConfigSchema = {
  body: {
    type: 'object',
    required: ['accessKeyId', 'secretAccessKey', 'region', 'endpoint'],
    properties: {
      accessKeyId: { type: 'string', minLength: 1 },
      secretAccessKey: { type: 'string', minLength: 1 },
      region: { type: 'string', minLength: 1 },
      endpoint: { type: 'string', minLength: 1 },
    },
  },
};

export const updateProxyConfigSchema = {
  body: {
    type: 'object',
    required: ['httpProxy', 'httpsProxy'],
    properties: {
      httpProxy: { type: 'string' },
      httpsProxy: { type: 'string' },
    },
  },
};

export const testProxyConfigSchema = {
  body: {
    type: 'object',
    required: ['httpProxy', 'httpsProxy', 'testUrl'],
    properties: {
      httpProxy: { type: 'string' },
      httpsProxy: { type: 'string' },
      testUrl: { type: 'string', minLength: 1 },
    },
  },
};

export const updateHFConfigSchema = {
  body: {
    type: 'object',
    required: ['hfToken'],
    properties: {
      hfToken: { type: 'string' },
    },
  },
};

export const testHFConfigSchema = {
  body: {
    type: 'object',
    required: ['hfToken'],
    properties: {
      hfToken: { type: 'string', minLength: 1 },
    },
  },
};

export const updateConcurrencyConfigSchema = {
  body: {
    type: 'object',
    required: ['maxConcurrentTransfers'],
    properties: {
      maxConcurrentTransfers: { type: 'number', minimum: 1 },
    },
  },
};

export const updateMaxFilesConfigSchema = {
  body: {
    type: 'object',
    required: ['maxFilesPerPage'],
    properties: {
      maxFilesPerPage: { type: 'number', enum: [...PAGE_SIZE_PRESETS] },
    },
  },
};

// ========== Transfer Schemas ==========

export const transferRequestSchema = {
  body: {
    type: 'object',
    required: ['source', 'destination', 'items', 'conflictResolution'],
    properties: {
      source: {
        type: 'object',
        required: ['type', 'locationId', 'path'],
        properties: {
          type: { type: 'string', enum: ['local', 's3'] },
          locationId: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
      },
      destination: {
        type: 'object',
        required: ['type', 'locationId', 'path'],
        properties: {
          type: { type: 'string', enum: ['local', 's3'] },
          locationId: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
      },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['path', 'type'],
          properties: {
            path: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['file', 'directory'] },
          },
        },
      },
      conflictResolution: {
        type: 'string',
        enum: ['overwrite', 'skip', 'rename'],
      },
    },
  },
};

export const conflictCheckRequestSchema = {
  body: {
    type: 'object',
    required: ['source', 'destination', 'items'],
    properties: {
      source: {
        type: 'object',
        required: ['type', 'locationId', 'path'],
        properties: {
          type: { type: 'string', enum: ['local', 's3'] },
          locationId: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
      },
      destination: {
        type: 'object',
        required: ['type', 'locationId', 'path'],
        properties: {
          type: { type: 'string', enum: ['local', 's3'] },
          locationId: { type: 'string', minLength: 1 },
          path: { type: 'string' },
        },
      },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['path', 'type'],
          properties: {
            path: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['file', 'directory'] },
          },
        },
      },
    },
  },
};

// ========== Notification Schemas ==========

const bucketNameParam = {
  type: 'string',
  minLength: 3,
  maxLength: 63,
  pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
};

export const getNotificationsSchema = {
  params: {
    type: 'object',
    required: ['bucketName'],
    properties: {
      bucketName: bucketNameParam,
    },
  },
};

export const deleteNotificationSchema = {
  params: {
    type: 'object',
    required: ['bucketName', 'notificationId'],
    properties: {
      bucketName: bucketNameParam,
      notificationId: { type: 'string', minLength: 1 },
    },
  },
};

export const putNotificationsSchema = {
  params: {
    type: 'object',
    required: ['bucketName'],
    properties: {
      bucketName: bucketNameParam,
    },
  },
  body: {
    type: 'object',
    required: ['notifications'],
    properties: {
      notifications: {
        type: 'array',
        items: {
          type: 'object',
          required: ['endpoint', 'events'],
          properties: {
            id: { type: 'string' },
            endpoint: {
              type: 'string',
              pattern: '^https?://.+',
              minLength: 1,
            },
            events: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'string',
                enum: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
              },
            },
            prefix: { type: 'string' },
            suffix: { type: 'string' },
          },
        },
      },
    },
  },
};

export const testEndpointSchema = {
  body: {
    type: 'object',
    required: ['endpoint'],
    properties: {
      endpoint: {
        type: 'string',
        pattern: '^https?://.+',
        minLength: 1,
      },
    },
  },
};

// ========== Object Metadata/Tagging Schemas ==========

export const putObjectTagsSchema = {
  body: {
    type: 'object',
    required: ['tags'],
    properties: {
      tags: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          required: ['Key', 'Value'],
          properties: {
            Key: { type: 'string', minLength: 1, maxLength: 128 },
            Value: { type: 'string', maxLength: 256 },
          },
        },
      },
    },
  },
};
