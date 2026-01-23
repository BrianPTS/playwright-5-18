/**
 * Shared Proxy Configuration and Schema
 * This file can be used by both frontend and backend applications
 * to ensure consistent proxy handling across your entire system
 */

// Proxy Schema Definition (for validation and documentation)
export const ProxySchema = {
  // Core identification
  proxy_id: {
    type: 'string',
    required: true,
    unique: true,
    description: 'Unique identifier for the proxy (format: ip_port)',
    example: '139.171.128.91_5091'
  },
  
  // Connection details
  server: {
    type: 'string',
    required: true,
    description: 'Proxy server in ip:port format',
    example: '139.171.128.91:5091'
  },
  
  ip: {
    type: 'string',
    required: true,
    description: 'IP address of the proxy server',
    example: '139.171.128.91'
  },
  
  port: {
    type: 'number',
    required: true,
    min: 1,
    max: 65535,
    description: 'Port number of the proxy server',
    example: 5091
  },
  
  // Authentication
  username: {
    type: 'string',
    required: true,
    description: 'Username for proxy authentication',
    example: 'V6t6WYtx0m'
  },
  
  password: {
    type: 'string',
    required: true,
    description: 'Password for proxy authentication',
    example: 'pDdstBA9NM'
  },
  
  // Metadata
  provider: {
    type: 'string',
    default: 'unknown',
    description: 'Proxy provider/source',
    example: 'provider_name'
  },
  
  region: {
    type: 'string',
    default: 'unknown',
    description: 'Geographic region of the proxy',
    example: 'US-EAST'
  },
  
  country_code: {
    type: 'string',
    default: 'unknown',
    description: 'Country code of the proxy location',
    example: 'US'
  },
  
  // Status and health
  status: {
    type: 'string',
    enum: ['active', 'inactive', 'blacklisted', 'maintenance'],
    default: 'active',
    description: 'Current operational status'
  },
  
  is_working: {
    type: 'boolean',
    default: true,
    description: 'Whether the proxy is currently functional'
  },
  
  last_tested: {
    type: 'date',
    description: 'Last time the proxy was tested'
  },
  
  response_time: {
    type: 'number',
    default: 0,
    description: 'Average response time in milliseconds'
  },
  
  success_rate: {
    type: 'number',
    default: 100,
    min: 0,
    max: 100,
    description: 'Success rate percentage'
  },
  
  // Usage tracking
  total_requests: {
    type: 'number',
    default: 0,
    description: 'Total number of requests made through this proxy'
  },
  
  failed_requests: {
    type: 'number',
    default: 0,
    description: 'Number of failed requests'
  },
  
  current_usage_count: {
    type: 'number',
    default: 0,
    description: 'Current concurrent usage count'
  },
  
  max_concurrent_usage: {
    type: 'number',
    default: 1,
    description: 'Maximum allowed concurrent usage'
  },
  
  // Rate limiting
  requests_per_minute_limit: {
    type: 'number',
    default: 60,
    description: 'Maximum requests per minute allowed'
  },
  
  // Tags for categorization
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Tags for categorizing proxies'
  },
  
  // Raw format for compatibility
  raw_proxy_string: {
    type: 'string',
    required: true,
    description: 'Original proxy string in ip:port:username:password format',
    example: '139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM'
  }
};

// Configuration constants
export const ProxyConfig = {
  // Default values
  DEFAULT_MAX_CONCURRENT_USAGE: 1,
  DEFAULT_REQUESTS_PER_MINUTE: 60,
  DEFAULT_SUCCESS_RATE: 100,
  DEFAULT_PROVIDER: 'imported',
  
  // Status values
  STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    BLACKLISTED: 'blacklisted',
    MAINTENANCE: 'maintenance'
  },
  
  // Health check settings
  HEALTH_CHECK: {
    MAX_CONSECUTIVE_FAILURES: 5,
    TEST_TIMEOUT: 10000, // 10 seconds
    MIN_SUCCESS_RATE: 70 // Minimum 70% success rate to stay active
  },
  
  // Rotation settings
  ROTATION: {
    DEFAULT_WEIGHT: 1,
    MAX_WEIGHT: 10,
    MIN_WEIGHT: 0
  },
  
  // Rate limiting
  RATE_LIMITING: {
    MINUTE_WINDOW: 60 * 1000, // 1 minute in milliseconds
    DEFAULT_LIMIT: 60
  }
};

// Utility functions for proxy handling
export const ProxyUtils = {
  
  /**
   * Parse raw proxy string into components
   */
  parseRawProxy: (rawProxyString) => {
    if (!rawProxyString || typeof rawProxyString !== 'string') {
      throw new Error('Invalid proxy string provided');
    }
    
    const parts = rawProxyString.split(':');
    if (parts.length !== 4) {
      throw new Error(`Invalid proxy format. Expected "ip:port:username:password", got: ${rawProxyString}`);
    }
    
    const [ip, port, username, password] = parts;
    
    // Validate IP format
    if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
      throw new Error(`Invalid IP address format: ${ip}`);
    }
    
    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(`Invalid port number: ${port}`);
    }
    
    return {
      proxy_id: `${ip}_${port}`,
      server: `${ip}:${port}`,
      ip: ip,
      port: portNum,
      username: username,
      password: password,
      raw_proxy_string: rawProxyString
    };
  },
  
  /**
   * Format proxy for HTTP requests
   */
  formatProxyUrl: (proxy) => {
    if (typeof proxy === 'string') {
      const parsed = ProxyUtils.parseRawProxy(proxy);
      return `http://${parsed.username}:${parsed.password}@${parsed.server}`;
    } else if (proxy.username && proxy.password && proxy.server) {
      return `http://${proxy.username}:${proxy.password}@${proxy.server}`;
    } else {
      throw new Error('Invalid proxy object for URL formatting');
    }
  },
  
  /**
   * Convert to legacy format for backward compatibility
   */
  toLegacyFormat: (proxy) => {
    return {
      server: proxy.server || `${proxy.ip}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
      proxy: proxy.server || `${proxy.ip}:${proxy.port}`, // For backward compatibility
      ip: proxy.ip,
      port: proxy.port
    };
  },
  
  /**
   * Validate proxy object against schema
   */
  validateProxy: (proxy) => {
    const errors = [];
    
    // Check required fields
    const required = ['proxy_id', 'server', 'ip', 'port', 'username', 'password'];
    for (const field of required) {
      if (!proxy[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate IP format
    if (proxy.ip && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(proxy.ip)) {
      errors.push(`Invalid IP address: ${proxy.ip}`);
    }
    
    // Validate port range
    if (proxy.port && (proxy.port < 1 || proxy.port > 65535)) {
      errors.push(`Invalid port number: ${proxy.port}`);
    }
    
    // Validate status
    if (proxy.status && !Object.values(ProxyConfig.STATUS).includes(proxy.status)) {
      errors.push(`Invalid status: ${proxy.status}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  },
  
  /**
   * Generate proxy ID from IP and port
   */
  generateProxyId: (ip, port) => {
    return `${ip}_${port}`;
  },
  
  /**
   * Check if proxy is available for use
   */
  isProxyAvailable: (proxy) => {
    return proxy.status === ProxyConfig.STATUS.ACTIVE &&
           proxy.is_working &&
           proxy.current_usage_count < proxy.max_concurrent_usage &&
           proxy.requests_this_minute < proxy.requests_per_minute_limit;
  },
  
  /**
   * Calculate proxy health score
   */
  calculateHealthScore: (proxy) => {
    let score = 0;
    
    // Success rate (40% of score)
    score += (proxy.success_rate || 0) * 0.4;
    
    // Response time (30% of score, inverted - lower is better)
    const maxResponseTime = 10000; // 10 seconds
    const responseScore = Math.max(0, 100 - ((proxy.response_time || 0) / maxResponseTime) * 100);
    score += responseScore * 0.3;
    
    // Usage availability (20% of score)
    const usageScore = proxy.max_concurrent_usage > 0 ? 
      ((proxy.max_concurrent_usage - proxy.current_usage_count) / proxy.max_concurrent_usage) * 100 : 0;
    score += usageScore * 0.2;
    
    // Recent activity (10% of score)
    const lastUsed = proxy.last_used ? new Date(proxy.last_used) : new Date(0);
    const timeSinceLastUse = Date.now() - lastUsed.getTime();
    const daysSinceLastUse = timeSinceLastUse / (1000 * 60 * 60 * 24);
    const activityScore = Math.max(0, 100 - (daysSinceLastUse * 10)); // Penalize 10 points per day
    score += activityScore * 0.1;
    
    return Math.round(Math.max(0, Math.min(100, score)));
  }
};

// Example usage and documentation
export const ProxyExamples = {
  
  // Raw proxy string format (what you get from provider)
  rawProxy: '139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM',
  
  // Parsed proxy object
  parsedProxy: {
    proxy_id: '139.171.128.91_5091',
    server: '139.171.128.91:5091',
    ip: '139.171.128.91',
    port: 5091,
    username: 'V6t6WYtx0m',
    password: 'pDdstBA9NM',
    raw_proxy_string: '139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM'
  },
  
  // Full proxy object with metadata
  fullProxy: {
    proxy_id: '139.171.128.91_5091',
    server: '139.171.128.91:5091',
    ip: '139.171.128.91',
    port: 5091,
    username: 'V6t6WYtx0m',
    password: 'pDdstBA9NM',
    provider: 'my_provider',
    region: 'US-EAST',
    country_code: 'US',
    status: 'active',
    is_working: true,
    last_tested: new Date(),
    response_time: 1500,
    success_rate: 95,
    total_requests: 1000,
    failed_requests: 50,
    current_usage_count: 0,
    max_concurrent_usage: 1,
    requests_per_minute_limit: 60,
    requests_this_minute: 0,
    tags: ['premium', 'residential'],
    raw_proxy_string: '139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM'
  },
  
  // Legacy format for backward compatibility
  legacyProxy: {
    server: '139.171.128.91:5091',
    username: 'V6t6WYtx0m',
    password: 'pDdstBA9NM',
    proxy: '139.171.128.91:5091',
    ip: '139.171.128.91',
    port: 5091
  }
};

// Instructions for frontend implementation
export const FrontendInstructions = {
  
  // Database operations you can perform directly from frontend
  operations: [
    'Create new proxies from raw strings',
    'Query available proxies with filters',
    'Update proxy status and metadata',
    'Track proxy usage and performance',
    'Get proxy statistics and health metrics',
    'Manage proxy assignments to events/sessions'
  ],
  
  // Example queries for frontend
  queries: {
    
    // Get all active proxies
    getActiveProxies: `
      // MongoDB query
      db.proxies.find({
        status: 'active',
        is_working: true,
        current_usage_count: { $lt: 1 }
      }).sort({ success_rate: -1, response_time: 1 })
    `,
    
    // Get proxy statistics
    getProxyStats: `
      // MongoDB aggregation
      db.proxies.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            avgSuccessRate: { $avg: '$success_rate' },
            avgResponseTime: { $avg: '$response_time' }
          }
        }
      ])
    `,
    
    // Update proxy after use
    updateProxyUsage: `
      // MongoDB update
      db.proxies.updateOne(
        { proxy_id: 'proxy_id_here' },
        {
          $inc: { 
            total_requests: 1,
            current_usage_count: 1
          },
          $set: { last_used: new Date() }
        }
      )
    `
  },
  
  // Frontend implementation steps
  steps: [
    '1. Import this configuration file in your frontend project',
    '2. Use the ProxySchema for form validation and data structure',
    '3. Use ProxyUtils for parsing and validating proxy strings',
    '4. Connect directly to MongoDB using the same database configuration',
    '5. Use the provided example queries for database operations',
    '6. Implement proxy rotation and health checking using the utility functions',
    '7. Use the same model structure for consistent data handling'
  ]
};

export default {
  ProxySchema,
  ProxyConfig,
  ProxyUtils,
  ProxyExamples,
  FrontendInstructions
};