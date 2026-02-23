import mongoose from "mongoose";
import scraperManager from "../scraperManager.js";
import { isRedisReady, getRedisHealth } from "../config/redis.js";
import redisLiveStore, { INSTANCE_ID } from "../helpers/RedisLiveStore.js";

export const checkHealth = async (req, res) => {
  const redisHealth = await getRedisHealth();
  const stalenessStats = await redisLiveStore.getStalenessStats().catch(() => null);
  const activeInstances = await redisLiveStore.getActiveInstances().catch(() => 0);
  const bufferStats = redisLiveStore.getBufferStats();

  res.json({
    status: "healthy",
    instanceId: INSTANCE_ID,
    scraperRunning: scraperManager.isRunning,
    mongoConnection: mongoose.connection.readyState === 1,
    redis: {
      connected: isRedisReady(),
      ...redisHealth,
    },
    distribution: stalenessStats,
    activeInstances,
    writeBuffer: bufferStats,
  });
};