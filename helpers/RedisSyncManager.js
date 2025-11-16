import Redis from 'ioredis';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Real-time data synchronization manager using Redis pub/sub
 * Ensures immediate data consistency across all Node.js instances
 */
class RedisSyncManager extends EventEmitter {
  constructor() {
    super();
    
    this.instanceId = `scraper-${process.pid}-${Date.now()}`;
    this.isConnected = false;
    
    // Redis connection configuration with high availability
    this.redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4, // IPv4
      // Connection pool settings for high-concurrency
      maxMemoryPolicy: 'allkeys-lru',
    };

    // Initialize Redis clients
    this.publisher = null;
    this.subscriber = null;
    
    // Event channels for real-time synchronization
    this.channels = {
      EVENT_UPDATE: 'realtime:event:update',
      EVENT_DELETE: 'realtime:event:delete',
      INVENTORY_UPDATE: 'realtime:inventory:update',
      INVENTORY_DELETE: 'realtime:inventory:delete',
      SCRAPER_STATUS: 'realtime:scraper:status',
      GLOBAL_NOTIFICATION: 'realtime:global:notification'
    };
    
    // Local event tracking for deduplication
    this.localEventTracker = new Map();
    this.cleanupInterval = null;
    
    this.init();
  }

  async init() {
    try {
      // Create Redis clients
      this.publisher = new Redis(this.redisConfig);
      this.subscriber = new Redis(this.redisConfig);
      
      // Setup connection event handlers
      this.setupConnectionHandlers();
      
      // Connect to Redis
      await Promise.all([
        this.publisher.connect(),
        this.subscriber.connect()
      ]);
      
      // Subscribe to all real-time channels
      await this.setupSubscriptions();
      
      // Setup cleanup interval for local event tracker
      this.cleanupInterval = setInterval(() => {
        this.cleanupLocalEventTracker();
      }, 60000); // Clean every minute
      
      this.isConnected = true;
      console.log(`[REDIS SYNC] Instance ${this.instanceId} connected and ready for real-time sync`);
      
      // Notify other instances of this instance joining
      await this.publishGlobalNotification({
        type: 'INSTANCE_JOIN',
        instanceId: this.instanceId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`[REDIS SYNC ERROR] Failed to initialize:`, error);
      throw error;
    }
  }

  setupConnectionHandlers() {
    // Publisher connection events
    this.publisher.on('connect', () => {
      console.log(`[REDIS SYNC] Publisher connected`);
    });
    
    this.publisher.on('error', (error) => {
      console.error(`[REDIS SYNC ERROR] Publisher error:`, error);
    });
    
    // Subscriber connection events
    this.subscriber.on('connect', () => {
      console.log(`[REDIS SYNC] Subscriber connected`);
    });
    
    this.subscriber.on('error', (error) => {
      console.error(`[REDIS SYNC ERROR] Subscriber error:`, error);
    });
  }

  async setupSubscriptions() {
    // Subscribe to all channels
    const channelNames = Object.values(this.channels);
    await this.subscriber.subscribe(...channelNames);
    
    // Handle incoming messages
    this.subscriber.on('message', (channel, message) => {
      this.handleIncomingMessage(channel, message);
    });
    
    console.log(`[REDIS SYNC] Subscribed to ${channelNames.length} real-time channels`);
  }

  handleIncomingMessage(channel, message) {
    try {
      const data = JSON.parse(message);
      
      // Ignore messages from this instance to prevent loops
      if (data.sourceInstanceId === this.instanceId) {
        return;
      }
      
      // Check for duplicate messages
      const messageId = data.messageId || `${data.timestamp}-${data.type}`;
      if (this.localEventTracker.has(messageId)) {
        return;
      }
      
      // Track this message
      this.localEventTracker.set(messageId, Date.now());
      
      console.log(`[REDIS SYNC] Received real-time update on ${channel}:`, {
        type: data.type,
        source: data.sourceInstanceId,
        timestamp: new Date(data.timestamp).toISOString()
      });
      
      // Emit local events based on channel
      switch (channel) {
        case this.channels.EVENT_UPDATE:
          this.emit('eventUpdate', data);
          break;
        case this.channels.EVENT_DELETE:
          this.emit('eventDelete', data);
          break;
        case this.channels.INVENTORY_UPDATE:
          this.emit('inventoryUpdate', data);
          break;
        case this.channels.INVENTORY_DELETE:
          this.emit('inventoryDelete', data);
          break;
        case this.channels.SCRAPER_STATUS:
          this.emit('scraperStatus', data);
          break;
        case this.channels.GLOBAL_NOTIFICATION:
          this.emit('globalNotification', data);
          break;
      }
      
    } catch (error) {
      console.error(`[REDIS SYNC ERROR] Failed to parse message:`, error);
    }
  }

  // Real-time event update notification
  async publishEventUpdate(eventData) {
    if (!this.isConnected) return;
    
    const message = {
      type: 'EVENT_UPDATE',
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now(),
      eventId: eventData.Event_ID,
      data: eventData
    };
    
    await this.publisher.publish(this.channels.EVENT_UPDATE, JSON.stringify(message));
    console.log(`[REDIS SYNC] Published event update for ${eventData.Event_ID}`);
  }

  // Real-time event deletion notification
  async publishEventDelete(eventId) {
    if (!this.isConnected) return;
    
    const message = {
      type: 'EVENT_DELETE',
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now(),
      eventId: eventId
    };
    
    await this.publisher.publish(this.channels.EVENT_DELETE, JSON.stringify(message));
    console.log(`[REDIS SYNC] Published event deletion for ${eventId}`);
  }

  // Real-time inventory update notification
  async publishInventoryUpdate(inventoryData) {
    if (!this.isConnected) return;
    
    const message = {
      type: 'INVENTORY_UPDATE',
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now(),
      eventId: inventoryData.Event_ID,
      inventoryIds: Array.isArray(inventoryData.inventoryIds) ? inventoryData.inventoryIds : [inventoryData.inventoryId],
      data: inventoryData
    };
    
    await this.publisher.publish(this.channels.INVENTORY_UPDATE, JSON.stringify(message));
    console.log(`[REDIS SYNC] Published inventory update for event ${inventoryData.Event_ID}`);
  }

  // Real-time inventory deletion notification
  async publishInventoryDelete(eventId, inventoryIds) {
    if (!this.isConnected) return;
    
    const message = {
      type: 'INVENTORY_DELETE',
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now(),
      eventId: eventId,
      inventoryIds: Array.isArray(inventoryIds) ? inventoryIds : [inventoryIds]
    };
    
    await this.publisher.publish(this.channels.INVENTORY_DELETE, JSON.stringify(message));
    console.log(`[REDIS SYNC] Published inventory deletion for event ${eventId}, items: ${inventoryIds.length || 1}`);
  }

  // Scraper status updates for coordination
  async publishScraperStatus(status) {
    if (!this.isConnected) return;
    
    const message = {
      type: 'SCRAPER_STATUS',
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now(),
      status: status
    };
    
    await this.publisher.publish(this.channels.SCRAPER_STATUS, JSON.stringify(message));
  }

  // Global notifications
  async publishGlobalNotification(notification) {
    if (!this.isConnected) return;
    
    const message = {
      ...notification,
      messageId: `${Date.now()}-${Math.random()}`,
      sourceInstanceId: this.instanceId,
      timestamp: Date.now()
    };
    
    await this.publisher.publish(this.channels.GLOBAL_NOTIFICATION, JSON.stringify(message));
  }

  // Distributed locking system removed





  // Clean up old event tracker entries
  cleanupLocalEventTracker() {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    for (const [messageId, timestamp] of this.localEventTracker.entries()) {
      if (now - timestamp > maxAge) {
        this.localEventTracker.delete(messageId);
      }
    }
  }

  // Graceful shutdown
  async shutdown() {
    try {
      console.log(`[REDIS SYNC] Shutting down instance ${this.instanceId}`);
      
      // Notify other instances of shutdown
      await this.publishGlobalNotification({
        type: 'INSTANCE_LEAVE',
        instanceId: this.instanceId,
        timestamp: Date.now()
      });
      
      // Clear cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      
      // Close Redis connections
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      
      if (this.publisher) {
        await this.publisher.quit();
      }
      
      this.isConnected = false;
      console.log(`[REDIS SYNC] Shutdown complete`);
      
    } catch (error) {
      console.error(`[REDIS SYNC ERROR] Error during shutdown:`, error);
    }
  }

  // Health check
  async healthCheck() {
    if (!this.isConnected) {
      return { status: 'disconnected' };
    }
    
    try {
      const publisherPing = await this.publisher.ping();
      const subscriberPing = await this.subscriber.ping();
      
      return {
        status: 'connected',
        publisher: publisherPing === 'PONG',
        subscriber: subscriberPing === 'PONG',
        instanceId: this.instanceId
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

export default RedisSyncManager;