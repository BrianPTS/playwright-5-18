import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

/**
 * Centralized Redis Connection Manager
 * 
 * Redis is used as a LIVE data store (NOT a cache).
 * - No TTLs, no expiration — data is always explicitly managed
 * - Write-back: writes go to Redis FIRST (instant), then batch-synced to MongoDB periodically
 * - ALL reads come from Redis (sub-ms), MongoDB is the persistent fallback
 * - On startup, Redis is hydrated from MongoDB for fresh data
 */

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD?.trim() || undefined,
  db: parseInt(process.env.REDIS_DB, 10) || 0,
  
  // Connection resilience — tuned for 200+ concurrent instances
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 15) {
      console.error(`[Redis] Max reconnection attempts (15) reached. Falling back to MongoDB-only.`);
      return null;
    }
    const delay = Math.min(times * 300, 5000);
    console.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times})...`);
    return delay;
  },

  // Performance — 200+ instances connect simultaneously
  enableReadyCheck: true,
  lazyConnect: false,
  keepAlive: 30000,
  connectTimeout: 15000,
  commandTimeout: 30000,
  enableOfflineQueue: false,
};

let redisClient = null;
let isRedisConnected = false;

/**
 * Create and connect the Redis client
 */
const connectRedis = async () => {
  try {
    redisClient = new Redis(REDIS_CONFIG);

    redisClient.on("connect", () => {
      console.log(`[Redis] Connected to ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`);
    });

    redisClient.on("ready", () => {
      isRedisConnected = true;
      console.log("[Redis] Ready — live data mode");
    });

    redisClient.on("error", (err) => {
      console.error(`[Redis] Error: ${err.message}`);
      isRedisConnected = false;
    });

    redisClient.on("close", () => {
      isRedisConnected = false;
      console.warn("[Redis] Connection closed");
    });

    redisClient.on("reconnecting", () => {
      console.warn("[Redis] Reconnecting...");
    });

    // Wait for initial connection
    await new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        reject(new Error("Redis connection timeout (15s)"));
      }, 15000);

      redisClient.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      redisClient.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return redisClient;
  } catch (error) {
    console.error(`[Redis] Failed to connect: ${error.message}`);
    console.warn("[Redis] Application will continue with MongoDB-only mode");
    isRedisConnected = false;
    return null;
  }
};

/**
 * Get the Redis client instance
 */
const getRedisClient = () => redisClient;

/**
 * Check if Redis is currently connected and operational
 */
const isRedisReady = () => isRedisConnected && redisClient && redisClient.status === "ready";

/**
 * Close Redis connection gracefully
 */
const closeRedis = async () => {
  if (redisClient) {
    try {
      await redisClient.quit();
      isRedisConnected = false;
      console.log("[Redis] Connection closed gracefully");
    } catch (error) {
      console.error(`[Redis] Error closing connection: ${error.message}`);
      try {
        redisClient.disconnect();
      } catch {
        // Best effort
      }
    }
  }
};

/**
 * Get Redis connection health info
 */
const getRedisHealth = () => ({
  connected: isRedisConnected,
  status: redisClient ? redisClient.status : "not-initialized",
  host: REDIS_CONFIG.host,
  port: REDIS_CONFIG.port,
  db: REDIS_CONFIG.db,
});

export { connectRedis, getRedisClient, isRedisReady, closeRedis, getRedisHealth };
export default connectRedis;
