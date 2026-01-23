import { Proxy } from '../models/proxyModel.js';

/**
 * Proxy Controller - Database operations for proxy management
 * Can be used by both frontend and backend
 */

class ProxyController {
  
  /**
   * Get all proxies with optional filtering
   */
  static async getAllProxies(filters = {}, options = {}) {
    try {
      const {
        status = 'active',
        is_working = true,
        provider,
        region,
        tags,
        limit = 100,
        skip = 0,
        sortBy = 'success_rate',
        sortOrder = 'desc'
      } = options;

      const query = {
        ...(status && { status }),
        ...(is_working !== undefined && { is_working }),
        ...(provider && { provider }),
        ...(region && { region }),
        ...(tags && { tags: { $in: Array.isArray(tags) ? tags : [tags] } }),
        ...filters
      };

      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      const proxies = await Proxy.find(query)
        .sort(sort)
        .limit(limit)
        .skip(skip)
        .lean();

      const total = await Proxy.countDocuments(query);

      return {
        success: true,
        data: proxies,
        total,
        page: Math.floor(skip / limit) + 1,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available proxies for scraping
   */
  static async getAvailableProxies(options = {}) {
    try {
      const {
        maxConcurrentUsage = 1,
        excludeEventId,
        requiredTags,
        limit = 50
      } = options;

      const query = {
        status: 'active',
        is_working: true,
        // Removed current_usage_count filter - proxies should always be available
        $expr: { $lt: ['$requests_this_minute', '$requests_per_minute_limit'] }
      };

      // Exclude proxies assigned to specific event
      if (excludeEventId) {
        query['assigned_events.event_id'] = { $ne: excludeEventId };
      }

      // Filter by required tags
      if (requiredTags && requiredTags.length > 0) {
        query.tags = { $in: requiredTags };
      }

      const proxies = await Proxy.find(query)
        .sort({ 
          success_rate: -1,
          last_used: 1  // Prefer least recently used for better rotation
        })
        .limit(limit);

      return {
        success: true,
        data: proxies,
        count: proxies.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get proxy by ID
   */
  static async getProxyById(proxyId) {
    try {
      const proxy = await Proxy.findOne({ proxy_id: proxyId });
      
      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      return {
        success: true,
        data: proxy
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create new proxy from raw string
   */
  static async createProxy(rawProxyString, metadata = {}) {
    try {
      const proxyData = Proxy.parseRawProxy(rawProxyString);
      
      // Check if proxy already exists
      const existingProxy = await Proxy.findOne({ proxy_id: proxyData.proxy_id });
      if (existingProxy) {
        return {
          success: false,
          error: 'Proxy already exists',
          data: existingProxy
        };
      }

      const proxy = new Proxy({
        ...proxyData,
        ...metadata
      });

      await proxy.save();

      return {
        success: true,
        data: proxy,
        message: 'Proxy created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Bulk create proxies from raw strings array
   */
  static async bulkCreateProxies(rawProxyStrings, metadata = {}) {
    try {
      const results = {
        success: [],
        failed: [],
        existing: []
      };

      for (const rawProxy of rawProxyStrings) {
        try {
          const proxyData = Proxy.parseRawProxy(rawProxy);
          
          // Check if proxy already exists
          const existingProxy = await Proxy.findOne({ proxy_id: proxyData.proxy_id });
          if (existingProxy) {
            results.existing.push({ rawProxy, proxy: existingProxy });
            continue;
          }

          const proxy = new Proxy({
            ...proxyData,
            ...metadata
          });

          await proxy.save();
          results.success.push(proxy);
        } catch (error) {
          results.failed.push({ rawProxy, error: error.message });
        }
      }

      return {
        success: true,
        data: results,
        summary: {
          total: rawProxyStrings.length,
          created: results.success.length,
          failed: results.failed.length,
          existing: results.existing.length
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
   * Update proxy status
   */
  static async updateProxyStatus(proxyId, status, additionalData = {}) {
    try {
      const validStatuses = ['active', 'inactive', 'blacklisted', 'maintenance'];
      if (!validStatuses.includes(status)) {
        return {
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        };
      }

      const proxy = await Proxy.findOneAndUpdate(
        { proxy_id: proxyId },
        { 
          status,
          is_working: status === 'active',
          ...additionalData
        },
        { new: true }
      );

      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      return {
        success: true,
        data: proxy,
        message: `Proxy status updated to ${status}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Assign proxy to event
   */
  static async assignProxyToEvent(proxyId, eventId) {
    try {
      const proxy = await Proxy.findOne({ proxy_id: proxyId });
      
      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      if (proxy.current_usage_count >= proxy.max_concurrent_usage) {
        return {
          success: false,
          error: 'Proxy has reached maximum concurrent usage'
        };
      }

      await proxy.assignToEvent(eventId);

      return {
        success: true,
        data: proxy,
        message: 'Proxy assigned to event successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Release proxy from event
   */
  static async releaseProxyFromEvent(proxyId, eventId) {
    try {
      const proxy = await Proxy.findOne({ proxy_id: proxyId });
      
      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      await proxy.releaseFromEvent(eventId);

      return {
        success: true,
        data: proxy,
        message: 'Proxy released from event successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record proxy usage and result
   */
  static async recordProxyUsage(proxyId, success = true, responseTime = 0, errorInfo = {}) {
    try {
      const proxy = await Proxy.findOne({ proxy_id: proxyId });
      
      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      await proxy.incrementUsage();

      if (success) {
        await proxy.recordSuccess(responseTime);
      } else {
        await proxy.recordFailure(errorInfo);
      }

      return {
        success: true,
        data: proxy,
        message: 'Proxy usage recorded successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get proxy statistics
   */
  static async getProxyStats() {
    try {
      const stats = await Proxy.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
            blacklisted: { $sum: { $cond: [{ $eq: ['$status', 'blacklisted'] }, 1, 0] } },
            working: { $sum: { $cond: ['$is_working', 1, 0] } },
            avgSuccessRate: { $avg: '$success_rate' },
            avgResponseTime: { $avg: '$response_time' },
            totalRequests: { $sum: '$total_requests' },
            totalFailures: { $sum: '$failed_requests' }
          }
        }
      ]);

      const providerStats = await Proxy.aggregate([
        {
          $group: {
            _id: '$provider',
            count: { $sum: 1 },
            avgSuccessRate: { $avg: '$success_rate' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      return {
        success: true,
        data: {
          overview: stats[0] || {},
          byProvider: providerStats
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
   * Clean up stale assignments and reset minute counters
   */
  static async cleanupProxies() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Reset minute counters for proxies older than 1 minute
      const minuteAgo = new Date(now.getTime() - 60 * 1000);
      await Proxy.updateMany(
        { minute_window_start: { $lt: minuteAgo } },
        { 
          $set: { 
            requests_this_minute: 0,
            minute_window_start: now
          }
        }
      );

      // Clean up old assignments (older than 1 hour)
      await Proxy.updateMany(
        { 'assigned_events.assigned_at': { $lt: oneHourAgo } },
        { 
          $pull: { 
            assigned_events: { assigned_at: { $lt: oneHourAgo } }
          }
        }
      );

      // Reset usage counts based on current assignments
      const proxies = await Proxy.find({});
      for (const proxy of proxies) {
        proxy.current_usage_count = proxy.assigned_events.length;
        await proxy.save();
      }

      return {
        success: true,
        message: 'Proxy cleanup completed successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test proxy health
   */
  static async testProxy(proxyId) {
    try {
      const proxy = await Proxy.findOne({ proxy_id: proxyId });
      
      if (!proxy) {
        return {
          success: false,
          error: 'Proxy not found'
        };
      }

      // This is a basic implementation - you might want to add actual HTTP testing
      const startTime = Date.now();
      
      // Simulate testing - replace with actual proxy test
      const isHealthy = Math.random() > 0.1; // 90% success rate for simulation
      const responseTime = Date.now() - startTime;

      if (isHealthy) {
        await proxy.recordSuccess(responseTime);
      } else {
        await proxy.recordFailure({ message: 'Health check failed' });
      }

      return {
        success: true,
        data: {
          proxy_id: proxyId,
          is_healthy: isHealthy,
          response_time: responseTime,
          success_rate: proxy.success_rate
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export { ProxyController };