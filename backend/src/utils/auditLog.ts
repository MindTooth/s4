import { User } from '../plugins/auth';
import { createLogger } from './logger';

// Module-level logger for audit logging
const logger = createLogger(undefined, '[Audit]');

/**
 * Check if audit logging is enabled (default: true)
 */
export function isAuditLoggingEnabled(): boolean {
  return process.env.AUDIT_LOG_ENABLED !== 'false';
}

/**
 * Audit event types for categorization
 */
export enum AuditEventType {
  // Authentication events
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILURE = 'auth.login.failure',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_TOKEN_EXPIRED = 'auth.token.expired',

  // Bucket operations
  BUCKET_CREATE = 'bucket.create',
  BUCKET_DELETE = 'bucket.delete',
  BUCKET_LIST = 'bucket.list',

  // Object operations
  OBJECT_UPLOAD = 'object.upload',
  OBJECT_DOWNLOAD = 'object.download',
  OBJECT_DELETE = 'object.delete',
  OBJECT_LIST = 'object.list',
  OBJECT_VIEW = 'object.view',

  // Transfer operations
  TRANSFER_START = 'transfer.start',
  TRANSFER_COMPLETE = 'transfer.complete',
  TRANSFER_CANCEL = 'transfer.cancel',
  TRANSFER_FAIL = 'transfer.fail',

  // Configuration changes
  CONFIG_S3_UPDATE = 'config.s3.update',
  CONFIG_PROXY_UPDATE = 'config.proxy.update',
  CONFIG_HF_UPDATE = 'config.huggingface.update',
  CONFIG_CONCURRENCY_UPDATE = 'config.concurrency.update',
  CONFIG_MAX_FILES_UPDATE = 'config.maxfiles.update',

  // Access denied events
  ACCESS_DENIED = 'access.denied',
  RATE_LIMIT_EXCEEDED = 'access.ratelimit',

  // Local storage operations
  LOCAL_UPLOAD = 'local.upload',
  LOCAL_DOWNLOAD = 'local.download',
  LOCAL_DELETE = 'local.delete',
  LOCAL_LIST = 'local.list',
  LOCAL_MKDIR = 'local.mkdir',

  // Notification operations
  NOTIFICATION_CREATE = 'notification.create',
  NOTIFICATION_DELETE = 'notification.delete',
  NOTIFICATION_TEST = 'notification.test',

  // Generic operations (backward compatibility)
  GENERIC = 'generic',
}

/**
 * Audit log entry structure (simplified - console only)
 */
export interface AuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** User information */
  user: {
    id: string;
    username: string;
  };
  /** Event type */
  eventType: AuditEventType;
  /** HTTP method or action type */
  action: string;
  /** Resource being accessed (e.g., "s3:bucket/key", "local:path") */
  resource: string;
  /** Status of the operation */
  status: 'success' | 'failure' | 'denied';
  /** Optional additional details */
  details?: string;
  /** Client IP address if available */
  clientIp?: string;
  /** Request ID for correlation */
  requestId?: string;
}

/**
 * Map action and resource to an appropriate event type
 */
function mapActionToEventType(
  action: string,
  resource: string,
  status: 'success' | 'failure' | 'denied',
): AuditEventType {
  const actionLower = action.toLowerCase();
  const resourceLower = resource.toLowerCase();

  // Authentication events
  if (actionLower === 'login' || resourceLower.includes('auth/login')) {
    return status === 'success' ? AuditEventType.AUTH_LOGIN_SUCCESS : AuditEventType.AUTH_LOGIN_FAILURE;
  }
  if (actionLower === 'logout' || resourceLower.includes('auth/logout')) {
    return AuditEventType.AUTH_LOGOUT;
  }

  // Bucket operations
  if (resourceLower.startsWith('bucket:') || resourceLower.includes('/buckets')) {
    if (actionLower === 'post' || actionLower === 'create') {
      return AuditEventType.BUCKET_CREATE;
    }
    if (actionLower === 'delete') {
      return AuditEventType.BUCKET_DELETE;
    }
    return AuditEventType.BUCKET_LIST;
  }

  // Object operations
  if (resourceLower.startsWith('s3:')) {
    if (actionLower === 'post' || actionLower === 'upload') {
      return AuditEventType.OBJECT_UPLOAD;
    }
    if (actionLower === 'get' && resourceLower.includes('download')) {
      return AuditEventType.OBJECT_DOWNLOAD;
    }
    if (actionLower === 'get' && resourceLower.includes('view')) {
      return AuditEventType.OBJECT_VIEW;
    }
    if (actionLower === 'delete') {
      return AuditEventType.OBJECT_DELETE;
    }
    if (actionLower === 'get') {
      return AuditEventType.OBJECT_LIST;
    }
  }

  // Local storage operations
  if (resourceLower.startsWith('local:')) {
    if (actionLower === 'post' && resourceLower.includes('/files/')) {
      return AuditEventType.LOCAL_UPLOAD;
    }
    if (actionLower === 'get' && resourceLower.includes('/download/')) {
      return AuditEventType.LOCAL_DOWNLOAD;
    }
    if (actionLower === 'delete') {
      return AuditEventType.LOCAL_DELETE;
    }
    if (actionLower === 'post' && resourceLower.includes('/directories/')) {
      return AuditEventType.LOCAL_MKDIR;
    }
    if (actionLower === 'get') {
      return AuditEventType.LOCAL_LIST;
    }
  }

  // Transfer operations
  if (resourceLower.startsWith('transfer:')) {
    if (actionLower === 'post') {
      return AuditEventType.TRANSFER_START;
    }
    if (actionLower === 'delete') {
      return AuditEventType.TRANSFER_CANCEL;
    }
    if (status === 'failure') {
      return AuditEventType.TRANSFER_FAIL;
    }
  }

  // Configuration changes
  if (resourceLower.includes('settings/s3')) {
    return AuditEventType.CONFIG_S3_UPDATE;
  }
  if (resourceLower.includes('settings/proxy')) {
    return AuditEventType.CONFIG_PROXY_UPDATE;
  }
  if (resourceLower.includes('settings/huggingface')) {
    return AuditEventType.CONFIG_HF_UPDATE;
  }
  if (resourceLower.includes('settings/max-concurrent')) {
    return AuditEventType.CONFIG_CONCURRENCY_UPDATE;
  }
  if (resourceLower.includes('settings/max-files')) {
    return AuditEventType.CONFIG_MAX_FILES_UPDATE;
  }

  // Access denied
  if (status === 'denied') {
    return AuditEventType.ACCESS_DENIED;
  }

  return AuditEventType.GENERIC;
}

/**
 * Main audit log function - logs to console via structured logger
 *
 * @param user - The authenticated user
 * @param action - The action being performed (e.g., 'list', 'download', 'upload', 'delete', 'transfer')
 * @param resource - The resource being accessed (e.g., 'local:home/file.txt', 's3:bucket/key')
 * @param status - The status of the action ('success' | 'failure' | 'denied')
 * @param details - Optional additional details about the action
 */
export function auditLog(
  user: User,
  action: string,
  resource: string,
  status: 'success' | 'failure' | 'denied',
  details?: string,
): void {
  if (!isAuditLoggingEnabled()) {
    return;
  }

  const eventType = mapActionToEventType(action, resource, status);

  logger.info(
    {
      timestamp: new Date().toISOString(),
      userId: user.id,
      username: user.username,
      eventType,
      action,
      resource,
      status,
      details: details || undefined,
    },
    'Audit event',
  );
}

/**
 * Extended audit log function with additional context
 *
 * @param options - Audit log options
 */
export function auditLogExtended(options: {
  user: User;
  eventType: AuditEventType;
  action: string;
  resource: string;
  status: 'success' | 'failure' | 'denied';
  details?: string;
  clientIp?: string;
  requestId?: string;
}): void {
  if (!isAuditLoggingEnabled()) {
    return;
  }

  const { user, eventType, action, resource, status, details, clientIp, requestId } = options;

  logger.info(
    {
      timestamp: new Date().toISOString(),
      userId: user.id,
      username: user.username,
      eventType,
      action,
      resource,
      status,
      details: details || undefined,
      clientIp,
      requestId,
    },
    'Audit event',
  );
}
