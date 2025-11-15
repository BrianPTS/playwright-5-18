import mongoose from "mongoose";
import scraperManager from "../scraperManager.js";

// Initialize scraper manager

export const checkHealth = (req, res) => {
  console.log(
    `Scraper running status in checkHealth: ${scraperManager.isRunning}`
  ); // Debug log
  res.json({
    status: "healthy",
    scraperRunning: scraperManager.isRunning,
    mongoConnection: mongoose.connection.readyState === 1,
  });
};

export const checkRedisHealth = async (req, res) => {
  try {
    if (!scraperManager.redisSyncManager) {
      return res.status(503).json({
        status: "redis_disabled",
        message: "Redis sync manager is not initialized"
      });
    }

    const redisHealth = await scraperManager.redisSyncManager.healthCheck();
    
    res.json({
      status: "healthy",
      redis: redisHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error", 
      redis: {
        status: "error",
        error: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};