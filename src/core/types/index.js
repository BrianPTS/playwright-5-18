/**
 * Core domain types and interfaces
 * Following nodejs-backend patterns for type-safe development
 */

/**
 * Base domain entity interface
 */
export const BaseEntity = {
  id: String,
  createdAt: Date,
  updatedAt: Date
};

/**
 * Event domain types
 */
export const EventEntity = {
  ...BaseEntity,
  Event_ID: String,
  Event_Name: String,
  Event_Date: Date,
  Venue: String,
  Location: String,
  Status: String, // 'pending', 'active', 'completed', 'stopped'
  mapping_id: String,
  lastInventoryUpdate: Date,
  inventoryCount: Number,
  isStale: Boolean
};

/**
 * Proxy domain types
 */
export const ProxyEntity = {
  ...BaseEntity,
  ip: String,
  port: Number,
  username: String,
  password: String,
  status: String, // 'healthy', 'banned', 'slow', 'error'
  lastUsed: Date,
  successCount: Number,
  errorCount: Number,
  banCount: Number,
  avgResponseTime: Number
};

/**
 * Session domain types
 */
export const SessionEntity = {
  ...BaseEntity,
  sessionId: String,
  eventId: String,
  cookies: Array,
  proxyId: String,
  userAgent: String,
  isValid: Boolean,
  lastValidation: Date,
  expiresAt: Date,
  metadata: Object
};

/**
 * Seat domain types
 */
export const SeatEntity = {
  ...BaseEntity,
  eventId: String,
  section: String,
  row: String,
  seatNumber: String,
  price: Number,
  status: String, // 'available', 'unavailable', 'reserved'
  coordinates: Object,
  lastChecked: Date
};

/**
 * Request/Response types
 */
export const ApiResponse = {
  success: Boolean,
  data: Object,
  error: Object,
  timestamp: String,
  meta: Object
};

export const PaginationMeta = {
  page: Number,
  limit: Number,
  total: Number,
  totalPages: Number,
  hasNext: Boolean,
  hasPrev: Boolean
};

/**
 * Scraper operation types
 */
export const ScrapingJobEntity = {
  ...BaseEntity,
  eventId: String,
  status: String, // 'pending', 'running', 'completed', 'failed', 'cancelled'
  startedAt: Date,
  completedAt: Date,
  seatsFound: Number,
  errors: Array,
  metadata: Object
};

/**
 * Cookie refresh types
 */
export const CookieRefreshEntity = {
  ...BaseEntity,
  sessionId: String,
  eventId: String,
  status: String, // 'success', 'failed', 'pending'
  refreshedAt: Date,
  errorMessage: String,
  cookieCount: Number,
  duration: Number
};

/**
 * Statistics types
 */
export const StatsEntity = {
  timestamp: Date,
  uptime: Number,
  totalRequests: Number,
  successfulRequests: Number,
  failedRequests: Number,
  avgResponseTime: Number,
  activeEvents: Number,
  activeSessions: Number,
  healthyProxies: Number,
  errors: Object
};

/**
 * Common enums
 */
export const EventStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  STOPPED: 'stopped',
  ERROR: 'error'
};

export const ProxyStatus = {
  HEALTHY: 'healthy',
  BANNED: 'banned',
  SLOW: 'slow',
  ERROR: 'error',
  UNTESTED: 'untested'
};

export const SessionStatus = {
  VALID: 'valid',
  INVALID: 'invalid',
  EXPIRED: 'expired',
  PENDING: 'pending'
};

export const SeatStatus = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  RESERVED: 'reserved'
};

export const ScrapingJobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Repository interfaces
 */
export const IEventRepository = {
  findById: Function,
  findAll: Function,
  create: Function,
  update: Function,
  delete: Function,
  findByStatus: Function,
  findStaleEvents: Function
};

export const IProxyRepository = {
  findById: Function,
  findAll: Function,
  create: Function,
  update: Function,
  delete: Function,
  findHealthy: Function,
  updateStatus: Function,
  incrementUsage: Function
};

export const ISessionRepository = {
  findById: Function,
  findAll: Function,
  create: Function,
  update: Function,
  delete: Function,
  findByEventId: Function,
  findExpired: Function,
  validateSession: Function
};

/**
 * Service interfaces
 */
export const IScrapingService = {
  startScraping: Function,
  stopScraping: Function,
  getStatus: Function,
  pauseScraping: Function,
  resumeScraping: Function
};

export const IProxyService = {
  getHealthyProxy: Function,
  markProxyStatus: Function,
  rotateProxy: Function,
  validateProxy: Function
};

export const ISessionService = {
  createSession: Function,
  validateSession: Function,
  refreshCookies: Function,
  cleanupExpired: Function
};

/**
 * Input validation schemas (to be used with Zod)
 */
export const CreateEventInput = {
  Event_ID: String,
  Event_Name: String,
  Event_Date: String, // ISO date string
  Venue: String,
  Location: String,
  mapping_id: String
};

export const UpdateEventInput = {
  Event_Name: String, // optional
  Event_Date: String, // optional, ISO date string
  Venue: String, // optional
  Location: String, // optional
  Status: String // optional
};

export const CreateProxyInput = {
  ip: String,
  port: Number,
  username: String, // optional
  password: String // optional
};

/**
 * Query parameters types
 */
export const EventQueryParams = {
  page: Number, // optional, default 1
  limit: Number, // optional, default 10
  status: String, // optional
  venue: String, // optional
  dateFrom: String, // optional, ISO date
  dateTo: String, // optional, ISO date
  search: String // optional
};

export const ProxyQueryParams = {
  page: Number, // optional
  limit: Number, // optional
  status: String, // optional
  sortBy: String, // optional: 'lastUsed', 'successCount', 'errorCount'
  sortOrder: String // optional: 'asc', 'desc'
};