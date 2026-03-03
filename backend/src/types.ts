// ========== Request Parameter Types ==========

export interface BucketParams {
  bucketName: string;
}

export interface ObjectParams extends BucketParams {
  encodedKey: string;
}

export interface ObjectPrefixParams extends BucketParams {
  prefix?: string;
}

export interface TransferJobParams {
  jobId: string;
}

export interface LocalStorageParams {
  locationId: string;
  '*'?: string; // Wildcard path parameter
}

// ========== Request Query Types ==========

export interface ObjectQueryParams {
  prefix?: string;
  continuationToken?: string;
  q?: string;
  mode?: 'startsWith' | 'contains';
  maxKeys?: string;
  autoBroaden?: string;
}

export interface LocalQueryParams {
  limit?: string;
  offset?: string;
}

// ========== Request Body Types ==========

export interface CreateBucketBody {
  bucketName: string;
}

export interface S3ConfigBody {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  defaultBucket: string;
}

export interface TestS3ConfigBody {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
}

export interface ProxyConfigBody {
  httpProxy: string;
  httpsProxy: string;
}

export interface TestProxyConfigBody {
  httpProxy: string;
  httpsProxy: string;
  testUrl: string;
}

export interface HFConfigBody {
  hfToken: string;
}

export interface ConcurrencyConfigBody {
  maxConcurrentTransfers: number;
}

export interface MaxFilesConfigBody {
  maxFilesPerPage: number;
}

// ========== Fastify Route Generics ==========

/**
 * Use Fastify's native generic types in route handlers instead of custom wrappers.
 *
 * @example
 * // Define route with typed params
 * fastify.post<{ Params: BucketParams }>('/:bucketName', async (req, reply) => {
 *   const { bucketName } = req.params; // Fully typed!
 * });
 *
 * @example
 * // Define route with typed params, query, and body
 * fastify.post<{ Params: ObjectParams; Query: ObjectQueryParams; Body: CreateBucketBody }>(
 *   '/:bucketName/:encodedKey',
 *   { schema: mySchema },
 *   async (req, reply) => {
 *     const { bucketName, encodedKey } = req.params;
 *     const { prefix } = req.query;
 *     const { bucketName: bodyBucket } = req.body;
 *   }
 * );
 */
export interface FastifyRouteGeneric {
  Params?: unknown;
  Querystring?: unknown;
  Body?: unknown;
  Headers?: unknown;
  Reply?: unknown;
}

// ========== Response Types ==========

export interface ErrorResponse {
  error: string;
  message: string;
  retryAfter?: number;
}

export interface SuccessResponse<T = unknown> {
  message?: string;
  data?: T;
}

// ========== Object Metadata/Tagging Types ==========

export interface ObjectTag {
  Key: string;
  Value: string;
}

export interface ObjectTagsBody {
  tags: ObjectTag[];
}

// ========== Notification Types ==========

export interface NotificationParams extends BucketParams {
  notificationId: string;
}

export interface NotificationEntry {
  id?: string;
  endpoint: string;
  events: string[];
  prefix?: string;
  suffix?: string;
}

export interface NotificationConfigBody {
  notifications: NotificationEntry[];
}

export interface TestEndpointBody {
  endpoint: string;
}
