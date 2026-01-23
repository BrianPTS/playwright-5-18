import { ProxyController } from '../controllers/proxyController.js';
import { Proxy } from '../models/proxyModel.js';

/**
 * Proxy Service - High-level proxy management utilities
 * Provides simplified interface for common proxy operations
 */

class ProxyService {
  
  /**
   * Initialize proxy service with raw proxy strings
   */
  static async initialize(rawProxyStrings, metadata = {}) {
    try {
      console.log(`Initializing proxy service with ${rawProxyStrings.length} proxies...`);
      
      const result = await ProxyController.bulkCreateProxies(rawProxyStrings, {
        provider: 'initialization',
        tags: ['auto-imported'],
        ...metadata
      });

      if (result.success) {
        console.log(`Proxy initialization complete:`, result.data.summary);
        return result;
      } else {
        console.error('Failed to initialize proxies:', result.error);
        return result;
      }
    } catch (error) {
      console.error('Proxy service initialization error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get next available proxy for rotation
   */
  static async getNextProxy(options = {}) {
    try {
      const {
        eventId,
        excludeProxies = [],
        requiredTags,
        preferredRegion
      } = options;

      // Build filters
      const filters = {};
      if (excludeProxies.length > 0) {
        filters.proxy_id = { $nin: excludeProxies };
      }
      if (preferredRegion) {
        filters.region = preferredRegion;
      }

      const result = await ProxyController.getAvailableProxies({
        ...filters,
        excludeEventId: eventId,
        requiredTags,
        limit: 1
      });

      if (result.success && result.data.length > 0) {
        const proxy = result.data[0];
        
        // Optionally assign to event
        if (eventId) {
          await ProxyController.assignProxyToEvent(proxy.proxy_id, eventId);
        }

        return {
          success: true,
          data: proxy
        };
      } else {
        return {
          success: false,
          error: 'No available proxies found'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get multiple proxies for batch operations
   */
  static async getProxyBatch(count = 10, options = {}) {
    try {
      const result = await ProxyController.getAvailableProxies({
        ...options,
        limit: count
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create proxy pool for specific event/session
   */
  static async createProxyPool(eventId, poolSize = 5) {
    try {
      const result = await this.getProxyBatch(poolSize, { excludeEventId: eventId });
      
      if (result.success && result.data.length > 0) {
        // Assign all proxies to the event
        const assignments = await Promise.all(
          result.data.map(proxy => 
            ProxyController.assignProxyToEvent(proxy.proxy_id, eventId)
          )
        );

        const successfulAssignments = assignments.filter(a => a.success);

        return {
          success: true,
          data: {
            eventId,
            poolSize: successfulAssignments.length,
            proxies: successfulAssignments.map(a => a.data)
          }
        };
      } else {
        return {
          success: false,
          error: `Could not create proxy pool. Available proxies: ${result.data?.length || 0}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Release all proxies for a specific event
   */
  static async releaseProxyPool(eventId) {
    try {
      const proxies = await Proxy.find({ 'assigned_events.event_id': eventId });
      
      const releases = await Promise.all(
        proxies.map(proxy => 
          ProxyController.releaseProxyFromEvent(proxy.proxy_id, eventId)
        )
      );

      const successfulReleases = releases.filter(r => r.success);

      return {
        success: true,
        data: {
          eventId,
          releasedCount: successfulReleases.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Rotate proxy for specific event (release current, get new one)
   */
  static async rotateProxy(currentProxyId, eventId) {
    try {
      // Release current proxy
      await ProxyController.releaseProxyFromEvent(currentProxyId, eventId);
      
      // Get new proxy
      const newProxyResult = await this.getNextProxy({ 
        eventId, 
        excludeProxies: [currentProxyId] 
      });

      return newProxyResult;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Health check and cleanup service
   */
  static async healthCheck() {
    try {
      console.log('Starting proxy health check...');
      
      // Get all active proxies
      const result = await ProxyController.getAllProxies({}, { 
        status: 'active', 
        limit: 1000 
      });

      if (!result.success) {
        return result;
      }

      const healthResults = [];
      
      // Test first 10 proxies (to avoid overwhelming the system)
      const testProxies = result.data.slice(0, 10);
      
      for (const proxy of testProxies) {
        const testResult = await ProxyController.testProxy(proxy.proxy_id);
        healthResults.push(testResult);
      }

      // Cleanup stale data
      const cleanupResult = await ProxyController.cleanupProxies();

      return {
        success: true,
        data: {
          tested: healthResults.length,
          healthy: healthResults.filter(r => r.success && r.data?.is_healthy).length,
          cleanup: cleanupResult.success
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Convert legacy proxy objects to new format
   */
  static convertLegacyProxy(legacyProxy) {
    try {
      if (typeof legacyProxy === 'string') {
        // Raw format: "ip:port:username:password"
        return Proxy.parseRawProxy(legacyProxy);
      } else if (legacyProxy.server && legacyProxy.username && legacyProxy.password) {
        // Object format: {server: "ip:port", username: "user", password: "pass"}
        const [ip, port] = legacyProxy.server.split(':');
        return {
          proxy_id: `${ip}_${port}`,
          server: legacyProxy.server,
          ip: ip,
          port: parseInt(port),
          username: legacyProxy.username,
          password: legacyProxy.password,
          raw_proxy_string: `${ip}:${port}:${legacyProxy.username}:${legacyProxy.password}`,
          // Convert legacy proxy object
          proxy_object: {
            server: legacyProxy.server,
            username: legacyProxy.username,
            password: legacyProxy.password,
            proxy: legacyProxy.server,
            ip: ip,
            port: parseInt(port)
          }
        };
      } else {
        throw new Error(`Invalid legacy proxy format: ${JSON.stringify(legacyProxy)}`);
      }
    } catch (error) {
      throw new Error(`Failed to convert legacy proxy: ${error.message}`);
    }
  }

  /**
   * Get proxy statistics dashboard data
   */
  static async getDashboardStats() {
    try {
      const stats = await ProxyController.getProxyStats();
      
      if (stats.success) {
        const overview = stats.data.overview;
        const byProvider = stats.data.byProvider;

        return {
          success: true,
          data: {
            summary: {
              total: overview.total || 0,
              active: overview.active || 0,
              inactive: overview.inactive || 0,
              blacklisted: overview.blacklisted || 0,
              workingPercentage: overview.total > 0 ? 
                Math.round((overview.working / overview.total) * 100) : 0,
              avgSuccessRate: Math.round(overview.avgSuccessRate || 0),
              avgResponseTime: Math.round(overview.avgResponseTime || 0)
            },
            providers: byProvider,
            usage: {
              totalRequests: overview.totalRequests || 0,
              totalFailures: overview.totalFailures || 0,
              successRate: overview.totalRequests > 0 ?
                Math.round(((overview.totalRequests - overview.totalFailures) / overview.totalRequests) * 100) : 0
            }
          }
        };
      } else {
        return stats;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Load balancing - distribute requests across available proxies
   */
  static async getLoadBalancedProxy(sessionId) {
    try {
      // Use session ID to consistently assign same proxy for session persistence
      const sessionHash = this.hashString(sessionId) % 1000;
      
      const result = await ProxyController.getAvailableProxies({ limit: 50 });
      
      if (result.success && result.data.length > 0) {
        const proxyIndex = sessionHash % result.data.length;
        const selectedProxy = result.data[proxyIndex];

        return {
          success: true,
          data: selectedProxy
        };
      } else {
        return {
          success: false,
          error: 'No available proxies for load balancing'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Simple hash function for string
   */
  static hashString(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

export { ProxyService };