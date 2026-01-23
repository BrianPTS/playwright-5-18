import { ProxyService } from "./ProxyService.js";
import { ProxyController } from "../controllers/proxyController.js";
import { Proxy } from "../models/proxyModel.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { HttpsProxyAgent } = require("https-proxy-agent");

/**
 * Manages proxy allocation and enforces usage limits for batches of events
 * Updated to use database-based proxy management with caching and change detection
 */
class ProxyManager {
  constructor(logger) {
    this.logger = logger;
    this.proxyUsage = new Map(); // Maps proxy IP to set of eventIds using it
    this.eventToProxy = new Map(); // Maps eventId to assigned proxy
    this.MAX_EVENTS_PER_PROXY = 999; // Allow unlimited usage - no restrictions
    this.BATCH_SIZE = 50; // Batch size for proxy operations
    
    // Cache-related properties
    this.proxies = []; // Cached proxy list
    this.lastCacheUpdate = null; // Last time cache was updated
    this.proxyCount = 0; // Cached proxy count for change detection
    this.cacheRefreshInterval = 30000; // 30 seconds
    this.forceRefreshInterval = 300000; // 5 minutes force refresh
    this.isInitialized = false;
    this.cacheTimer = null;
    this.forceRefreshTimer = null;
    
    this.lastAssignedProxyIndex = -1;
    this.proxyLastUsed = new Map(); // Track when proxies were last used
    
    this.log("ProxyManager initialized - will load proxies from database with caching");
  }
  
  /**
   * Initialize the proxy manager by loading proxies from database and starting cache management
   */
  async initialize() {
    try {
      this.log("Loading proxies from database...");
      
      // Initial load
      await this.refreshProxyCache();
      
      // Start cache management
      this.startCacheManagement();
      
      this.isInitialized = true;
      return this;
    } catch (error) {
      this.log(`Error initializing ProxyManager: ${error.message}`, "error");
      this.proxies = [];
      return this;
    }
  }

  /**
   * Start cache management timers
   */
  startCacheManagement() {
    // Periodic check for changes every 30 seconds
    this.cacheTimer = setInterval(async () => {
      try {
        await this.checkForChangesAndRefresh();
      } catch (error) {
        this.log(`Error in cache check: ${error.message}`, "warning");
      }
    }, this.cacheRefreshInterval);

    // Force refresh every 5 minutes
    this.forceRefreshTimer = setInterval(async () => {
      try {
        this.log("Performing forced cache refresh...");
        await this.refreshProxyCache(true);
      } catch (error) {
        this.log(`Error in forced refresh: ${error.message}`, "warning");
      }
    }, this.forceRefreshInterval);

    this.log("Cache management started - checking for changes every 30s, forcing refresh every 5min");
  }

  /**
   * Stop cache management timers
   */
  stopCacheManagement() {
    if (this.cacheTimer) {
      clearInterval(this.cacheTimer);
      this.cacheTimer = null;
    }
    if (this.forceRefreshTimer) {
      clearInterval(this.forceRefreshTimer);
      this.forceRefreshTimer = null;
    }
    this.log("Cache management stopped");
  }

  /**
   * Check for changes in database and refresh cache if needed
   */
  async checkForChangesAndRefresh() {
    try {
      // Get current proxy count from database
      const stats = await ProxyController.getProxyStats();
      
      if (stats.success) {
        const currentCount = stats.data.overview.total || 0;
        
        // Check if count has changed
        if (currentCount !== this.proxyCount) {
          this.log(`Proxy count changed from ${this.proxyCount} to ${currentCount} - refreshing cache`);
          await this.refreshProxyCache();
          return true;
        }
        
        // Check if cache is older than force refresh interval
        const cacheAge = Date.now() - (this.lastCacheUpdate || 0);
        if (cacheAge > this.forceRefreshInterval) {
          this.log("Cache expired - performing refresh");
          await this.refreshProxyCache();
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.log(`Error checking for changes: ${error.message}`, "warning");
      return false;
    }
  }

  /**
   * Refresh proxy cache from database
   */
  async refreshProxyCache(force = false) {
    try {
      const result = await ProxyController.getAvailableProxies({ limit: 2000 });
      
      if (result.success && result.data.length > 0) {
        const previousCount = this.proxies.length;
        
        // Convert database proxies to legacy format for backward compatibility
        // Only filter out proxies with missing critical fields, NOT usage-based filtering
        this.proxies = result.data
          .filter(proxy => {
            // Validate that proxy has required fields
            const hasServer = proxy.server || (proxy.ip && proxy.port);
            if (!hasServer) {
              this.log(`Skipping proxy ${proxy.proxy_id || 'unknown'} - missing server/ip:port (Server: ${proxy.server}, IP: ${proxy.ip}, Port: ${proxy.port})`, "warning");
              return false;
            }
            if (!proxy.username || !proxy.password) {
              this.log(`Skipping proxy ${proxy.proxy_id || 'unknown'} - missing credentials (User: ${proxy.username}, Pass: ${proxy.password ? '***' : 'missing'})`, "warning");
              return false;
            }
            return true;
          })
          .map(proxy => {
            // Build server string from ip:port if server is not set
            const server = proxy.server || `${proxy.ip}:${proxy.port}`;
            return {
              server: server,
              username: proxy.username,
              password: proxy.password,
              proxy: server, // For backward compatibility
              proxy_id: proxy.proxy_id,
              ip: proxy.ip,
              port: proxy.port,
              success_rate: proxy.success_rate || 100,
              status: proxy.status,
              is_working: proxy.is_working,
              last_tested: proxy.last_tested
            };
          });
        
        // Update cache metadata
        this.lastCacheUpdate = Date.now();
        this.proxyCount = this.proxies.length;
        
        // Reinitialize usage tracking for new proxies
        this.proxies.forEach(proxy => {
          if (!this.proxyUsage.has(proxy.proxy)) {
            this.proxyUsage.set(proxy.proxy, new Set());
          }
        });
        
        // Clean up usage tracking for removed proxies
        const currentProxyServers = new Set(this.proxies.map(p => p.proxy));
        for (const [proxyServer] of this.proxyUsage) {
          if (!currentProxyServers.has(proxyServer)) {
            this.proxyUsage.delete(proxyServer);
            this.proxyLastUsed.delete(proxyServer);
          }
        }
        
        const changeMsg = force ? "Force refreshed" : "Refreshed";
        this.log(`${changeMsg} proxy cache - ${this.proxies.length} proxies available (was ${previousCount})`);
        
        // Emit change event if significant change
        if (Math.abs(this.proxies.length - previousCount) > 5) {
          this.log(`Significant proxy count change detected: ${previousCount} -> ${this.proxies.length}`, "info");
        }
        
      } else {
        this.log("No proxies available in database during cache refresh", "warning");
        // Don't clear existing cache if database query fails
      }
      
    } catch (error) {
      this.log(`Error refreshing proxy cache: ${error.message}`, "error");
      // Don't clear existing cache on error
    }
  }

  /**
   * Manual cache refresh - can be called externally
   */
  async refreshProxyList() {
    this.log("Manual proxy cache refresh requested");
    return await this.refreshProxyCache(true);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cached_proxies: this.proxies.length,
      last_cache_update: this.lastCacheUpdate,
      cache_age_seconds: this.lastCacheUpdate ? Math.floor((Date.now() - this.lastCacheUpdate) / 1000) : null,
      is_initialized: this.isInitialized,
      cache_management_active: this.cacheTimer !== null,
      proxy_count: this.proxyCount,
      refresh_interval_ms: this.cacheRefreshInterval,
      force_refresh_interval_ms: this.forceRefreshInterval
    };
  }

  /**
   * Force immediate cache refresh and restart timers
   */
  async resetCache() {
    this.log("Resetting proxy cache and restarting management");
    
    // Stop existing timers
    this.stopCacheManagement();
    
    // Refresh cache
    await this.refreshProxyCache(true);
    
    // Restart cache management
    this.startCacheManagement();
    
    this.log("Cache reset complete");
  }

  /**
   * Check if cache needs refresh based on various conditions
   */
  shouldRefreshCache() {
    if (!this.lastCacheUpdate) return true;
    
    const cacheAge = Date.now() - this.lastCacheUpdate;
    
    // If cache is older than 10 minutes, needs refresh
    if (cacheAge > 600000) return true;
    
    // If no proxies cached, needs refresh
    if (this.proxies.length === 0) return true;
    
    return false;
  }

  /**
   * Cleanup method - call when shutting down
   */
  cleanup() {
    this.stopCacheManagement();
    this.log("ProxyManager cleanup completed");
  }
  
  /**
   * Simple logging function that uses the provided logger if available
   */
  log(message, level = "info") {
    if (this.logger) {
      if (typeof this.logger.logWithTime === 'function') {
        this.logger.logWithTime(message, level);
      } else if (typeof this.logger.log === 'function') {
        this.logger.log(message, level);
      } else {
        console.log(`[${level.toUpperCase()}] ${message}`);
      }
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Check if a proxy is available
   * @param {Object} proxy - The proxy to check
   * @returns {boolean} Whether the proxy is available
   */
  isProxyHealthy(proxy) {
    // Check database status if available
    if (proxy.status && proxy.status !== 'active') {
      return false;
    }
    
    if (proxy.is_working === false) {
      return false;
    }
    
    // If proxy was used recently, add cooldown (short cooldown to prevent overuse)
    const lastUsed = this.proxyLastUsed.get(proxy.proxy || proxy.server) || 0;
    const cooldownTime = 3000; // 3 seconds cooldown
    if (Date.now() - lastUsed < cooldownTime) {
      return false;
    }
    
    // Check if proxy has capacity - this is critical for ensuring separate proxies
    const currentUsage = this.proxyUsage.get(proxy.proxy || proxy.server)?.size || 0;
    if (currentUsage >= this.MAX_EVENTS_PER_PROXY) {
      return false;
    }
    
    return true;
  }

  /**
   * Count how many available proxies are available
   * @returns {number} The number of available proxies
   */
  getAvailableProxyCount() {
    return this.proxies.filter(proxy => this.isProxyHealthy(proxy)).length;
  }

  /**
   * Record a successful proxy usage (updates both memory and database)
   * @param {string} proxyString - The proxy string
   * @param {number} responseTime - Response time in milliseconds
   */
  async recordProxySuccess(proxyString, responseTime = 0) {
    // Update local tracking
    this.proxyLastUsed.set(proxyString, Date.now());
    
    // Find proxy by server string
    const proxy = this.proxies.find(p => (p.proxy || p.server) === proxyString);
    if (proxy && proxy.proxy_id) {
      try {
        await ProxyController.recordProxyUsage(proxy.proxy_id, true, responseTime);
      } catch (error) {
        this.log(`Failed to record proxy success in database: ${error.message}`, "warning");
      }
    }
  }
  
  /**
   * Record a failed proxy usage (updates both memory and database)
   * @param {string} proxyString - The proxy string 
   * @param {Object} error - The error object
   */
  async recordProxyFailure(proxyString, error) {
    this.log(`Proxy ${proxyString} failed: ${error.message}`, "warning");
    
    // Find proxy by server string
    const proxy = this.proxies.find(p => (p.proxy || p.server) === proxyString);
    if (proxy && proxy.proxy_id) {
      try {
        await ProxyController.recordProxyUsage(proxy.proxy_id, false, 0, {
          message: error.message,
          code: error.code || 'UNKNOWN'
        });
      } catch (dbError) {
        this.log(`Failed to record proxy failure in database: ${dbError.message}`, "warning");
      }
    }
  }

  /**
   * Update the status of a proxy based on successful or failed usage
   * @param {string} proxyString - The proxy string
   * @param {boolean} isHealthy - Whether the proxy is successful or not
   * @param {number} responseTime - Response time in milliseconds
   */
  async updateProxyHealth(proxyString, isHealthy, responseTime = 0) {
    if (isHealthy) {
      await this.recordProxySuccess(proxyString, responseTime);
    } else {
      await this.recordProxyFailure(proxyString, new Error("Proxy marked as failed"));
    }
  }

  /**
   * Assign proxy to event in database
   * @param {string} proxyId - The proxy ID
   * @param {string} eventId - The event ID
   */
  async assignProxyToEvent(proxyId, eventId) {
    try {
      await ProxyController.assignProxyToEvent(proxyId, eventId);
    } catch (error) {
      this.log(`Failed to assign proxy to event in database: ${error.message}`, "warning");
    }
  }

  /**
   * Release proxy from event in database
   * @param {string} proxyId - The proxy ID
   * @param {string} eventId - The event ID
   */
  async releaseProxyFromEvent(proxyId, eventId) {
    try {
      await ProxyController.releaseProxyFromEvent(proxyId, eventId);
    } catch (error) {
      this.log(`Failed to release proxy from event in database: ${error.message}`, "warning");
    }
  }

  /**
   * Refresh proxy list from database
   */
  async refreshProxyList() {
    try {
      const result = await ProxyController.getAvailableProxies({ limit: 1000 });
      
      if (result.success && result.data.length > 0) {
        // Filter out proxies with missing server field to prevent 'undefined' hostname errors
        this.proxies = result.data
          .filter(proxy => {
            const hasServer = proxy.server || (proxy.ip && proxy.port);
            if (!hasServer) {
              this.log(`Skipping proxy ${proxy.proxy_id || 'unknown'} - missing server/ip:port`, "warning");
              return false;
            }
            if (!proxy.username || !proxy.password) {
              this.log(`Skipping proxy ${proxy.proxy_id || 'unknown'} - missing credentials`, "warning");
              return false;
            }
            return true;
          })
          .map(proxy => {
            const server = proxy.server || `${proxy.ip}:${proxy.port}`;
            return {
              server: server,
              username: proxy.username,
              password: proxy.password,
              proxy: server,
              proxy_id: proxy.proxy_id,
              ip: proxy.ip,
              port: proxy.port,
              success_rate: proxy.success_rate || 100,
              status: proxy.status,
              is_working: proxy.is_working
            };
          });
        
        this.log(`Refreshed proxy list - ${this.proxies.length} proxies available`);
      } else if (result.data && result.data.length === 0) {
        this.log(`No proxies found in database - check if proxies are imported`, "warning");
      }
    } catch (error) {
      this.log(`Failed to refresh proxy list: ${error.message}`, "error");
    }
  }

  /**
   * Get proxies for a batch of events
   * @param {string[]} eventIds - The event IDs to get proxies for
   * @returns {Object} Object containing the proxy mappings
   */
  async getProxyForBatch(eventIds) {
    // Check if cache needs refresh
    if (this.shouldRefreshCache()) {
      this.log("Cache needs refresh before batch processing");
      await this.checkForChangesAndRefresh();
    }
    
    // Check if any events were provided
    if (!eventIds || eventIds.length === 0) {
      this.log('No events provided for proxy batch processing', "warning");
      return {
        proxyAgent: null,
        proxy: null,
        eventProxyMap: new Map(),
        firstEventId: null
      };
    }
    
    this.log(`Assigning proxies for batch of ${eventIds.length} events`);
    
    // Create a map to store proxy assignments for each event
    const proxyMap = new Map();
    
    // Get all available proxies and shuffle them to randomize assignment
    const allProxies = [...this.proxies];
    const shuffledProxies = allProxies.sort(() => 0.5 - Math.random());
    
    // If we have no proxies at all, return empty result
    if (shuffledProxies.length === 0) {
      this.log('No proxies available for batch processing', "error");
      return {
        proxyAgent: null,
        proxy: null,
        eventProxyMap: new Map(),
        firstEventId: eventIds[0] || null,
        noHealthyProxies: true
      };
    }
    
    // Assign proxies to events by cycling through the shuffled proxies
    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i];
      const proxyIndex = i % shuffledProxies.length;
      const proxy = shuffledProxies[proxyIndex];
      
      try {
        const proxyAgentData = this.createProxyAgent(proxy);
        proxyMap.set(eventId, { ...proxyAgentData, eventId });
      } catch (error) {
        this.log(`Failed to create proxy agent for event ${eventId}: ${error.message}`, "error");
      }
    }
    
    // Log the number of unique proxies used
    const uniqueProxiesCount = new Set(Array.from(proxyMap.values()).map(p => p.proxy.proxy)).size;
    this.log(`Assigned ${uniqueProxiesCount} unique proxies for ${eventIds.length} events (random assignment)`);
    
    // For backward compatibility, return a single proxy for the first event
    const firstEventId = eventIds[0];
    const firstProxyAgent = proxyMap.get(firstEventId);
    
    return { 
      proxyAgent: firstProxyAgent ? firstProxyAgent.proxyAgent : null,
      proxy: firstProxyAgent ? firstProxyAgent.proxy : null,
      eventProxyMap: proxyMap,
      firstEventId
    };
  }

  /**
   * Get a random proxy for a single event
   * @param {string} eventId - The event ID
   * @returns {Object} The selected proxy object
   */
  async getProxyForEvent(eventId) {
    // Check if cache needs refresh
    if (this.shouldRefreshCache()) {
      this.log("Cache needs refresh - checking for updates");
      await this.checkForChangesAndRefresh();
    }
    
    // Simply pick a random proxy
    if (this.proxies.length === 0) {
      this.log("No proxies available for event " + eventId, "warning");
      return null;
    }
    
    const randomIndex = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[randomIndex];
  }
  
  /**
   * Create a proxy agent from a proxy object
   * @param {Object} proxy - The proxy configuration
   * @returns {Object} The proxy with agent
   */
  createProxyAgent(proxy) {
    try {
      const proxyUrl = new URL(`http://${proxy.proxy}`);
      const proxyURl = `http://${proxy.username}:${proxy.password}@${
        proxyUrl.hostname
      }:${proxyUrl.port || 80}`;
      const proxyAgent = new HttpsProxyAgent(proxyURl, {
        timeout: 30000,        // 30s connection timeout
        keepAlive: true,       // Reuse connections
        keepAliveMsecs: 1000,  // Keep alive interval
        maxSockets: 256,       // Allow more concurrent connections
        maxFreeSockets: 256    // Keep more connections open
      });
      return { proxyAgent, proxy };
    } catch (error) {
      this.log(`Invalid proxy URL format: ${error.message}`, "error");
      throw new Error("Invalid proxy URL format");
    }
  }
  
  /**
   * Assign a proxy to an event and track the usage
   * @param {string} eventId - The event ID
   * @param {string} proxyString - The proxy string (IP:port)
   */
  assignProxyToEvent(eventId, proxyString) {
    // Remove event from previous proxy if it was assigned
    if (this.eventToProxy.has(eventId)) {
      const oldProxy = this.eventToProxy.get(eventId);
      const oldUsageSet = this.proxyUsage.get(oldProxy);
      if (oldUsageSet) {
        oldUsageSet.delete(eventId);
      }
    }
    
    // Assign new proxy
    this.eventToProxy.set(eventId, proxyString);
    
    // Add to usage tracking
    if (!this.proxyUsage.has(proxyString)) {
      this.proxyUsage.set(proxyString, new Set());
    }
    this.proxyUsage.get(proxyString).add(eventId);
  }
  
  /**
   * Release a proxy assignment when an event is done
   * @param {string} eventId - The event ID to release
   * @param {boolean} success - Whether the event was processed successfully
   * @param {Object} error - Optional error object if failed
   */
  releaseProxy(eventId, success = true, error = null) {
    if (this.eventToProxy.has(eventId)) {
      const proxyString = this.eventToProxy.get(eventId);
      const usageSet = this.proxyUsage.get(proxyString);
      
      if (usageSet) {
        usageSet.delete(eventId);
        
        // Record success or failure
        if (success) {
          this.recordProxySuccess(proxyString);
        } else if (error) {
          this.recordProxyFailure(proxyString, error);
        }
        
        this.log(
          `Released proxy ${proxyString} from event ${eventId}. Current usage: ${
            usageSet.size
          }/${this.MAX_EVENTS_PER_PROXY}. Status: ${success ? 'Success' : 'Failed'}`
        );
      }
      
      this.eventToProxy.delete(eventId);
    }
  }
  
  /**
   * Release proxies for a batch of events
   * @param {string[]} eventIds - Array of event IDs to release
   * @param {boolean} success - Whether the batch was processed successfully
   * @param {Object} error - Optional error object if failed
   */
  releaseProxyBatch(eventIds, success = true, error = null) {
    for (const eventId of eventIds) {
      this.releaseProxy(eventId, success, error);
    }
  }
  
  /**
   * Get the current proxy usage statistics
   * @returns {Object} Object with usage statistics
   */
  getUsageStats() {
    const stats = {
      totalProxies: this.proxies.length,
      usedProxies: 0,
      totalAssignments: 0,
      healthyProxies: this.getAvailableProxyCount(),
      proxyDetails: []
    };
    
    for (const [proxyString, usageSet] of this.proxyUsage.entries()) {
      if (usageSet.size > 0) {
        stats.usedProxies++;
      }
      stats.totalAssignments += usageSet.size;
      
      stats.proxyDetails.push({
        proxy: proxyString,
        eventsCount: usageSet.size,
        isHealthy: this.isProxyHealthy({ proxy: proxyString }),
        events: Array.from(usageSet)
      });
    }
    
    return stats;
  }

  /**
   * Get the total number of proxies in the system (healthy or not)
   * @returns {number} The total number of proxies
   */
  getTotalProxies() {
    return this.proxies.length;
  }

  /**
   * Release all proxies from all events
   * @param {boolean} success - Whether to mark releases as successful
   * @param {Object} error - Optional error object if failed
   */
  releaseAllProxies(success = true, error = null) {
    const allEventIds = new Set();
    
    // Collect all event IDs from all proxy usage
    for (const usageSet of this.proxyUsage.values()) {
      for (const eventId of usageSet) {
        allEventIds.add(eventId);
      }
    }
    
    // Release all events
    for (const eventId of allEventIds) {
      this.releaseProxy(eventId, success, error);
    }
    
    this.log(`Released all proxies for ${allEventIds.size} events`);
  }
}

export default ProxyManager;